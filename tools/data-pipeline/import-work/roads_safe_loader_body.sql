-- =============================================================================
-- Roads set-based safe loader — body (no BEGIN/COMMIT).
-- Requires temp params: roads_loader_params(batch_code, dry_run, sample_limit)
--
-- Target: core.core_streets (+ core.core_street_names).
-- Writes only classification IN ('safe_new','safe_update').
-- Version history: core.trg_fn_core_streets_save_version_before_update.
--
-- Safe-update allowlist (initial):
--   mechanical road_class_id/FK alignment (same class code),
--   is_oneway, bridge, tunnel, layer, surface,
--   source_refs / normalized_data metadata,
--   fill missing non-manual admin_area_id when work has a clear id,
--   real OSM name when core name is generated/synthetic (unless protected).
--
-- Import Review (conflict_ir):
--   large/any geometry change, real name replacement, road class code change,
--   manual override, verified meaningful change, ambiguous admin change,
--   conflicting source identity.
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('pg_temp.roads_loader_params') IS NULL THEN
        RAISE EXCEPTION 'roads loader body: params missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roads_loader_params WHERE batch_code IS NOT NULL) THEN
        RAISE EXCEPTION 'roads loader: batch_code is required';
    END IF;
    IF to_regclass('import_work.road_rows') IS NULL THEN
        RAISE EXCEPTION 'roads loader: import_work.road_rows missing — apply migration 144';
    END IF;
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'roads loader: system.pipeline_osm_identity_key missing — apply migration 137';
    END IF;
    IF to_regclass('core.core_streets') IS NULL THEN
        RAISE EXCEPTION 'roads loader: core.core_streets missing';
    END IF;
END $$;

-- Local synthetic-name helper (mirrors repaired F2; safe if F2 SQL not applied remotely)
CREATE OR REPLACE FUNCTION pg_temp.roads_loader_is_synthetic_name(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_text, '')), '') IS NULL THEN true
        WHEN btrim(p_text) ~* '^osm:(node|way|relation):[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^osm:[nwr]:[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^road-[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^street-[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^unnamed([ _]|$)' THEN true
        ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.roads_loader_line_geom(p_geom geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL OR ST_IsEmpty(p_geom) THEN NULL::geometry
        WHEN GeometryType(p_geom) = 'LINESTRING'
            THEN ST_Force2D(p_geom)::geometry(LineString, 4326)
        WHEN GeometryType(p_geom) = 'MULTILINESTRING' THEN (
            SELECT ST_Force2D((ST_Dump(p_geom)).geom)::geometry(LineString, 4326)
            ORDER BY ST_Length(((ST_Dump(p_geom)).geom)::geography) DESC
            LIMIT 1
        )
        ELSE NULL::geometry
    END;
$$;

DROP TABLE IF EXISTS roads_loader_batch;
CREATE TEMP TABLE roads_loader_batch (
    import_batch_id bigint PRIMARY KEY,
    batch_code text NOT NULL,
    source_snapshot_id bigint,
    source_snapshot_version text NOT NULL,
    status text NOT NULL,
    expected_row_count bigint,
    loaded_row_count bigint
) ON COMMIT DROP;

INSERT INTO roads_loader_batch
SELECT b.id, b.batch_code, b.source_snapshot_id, b.source_snapshot_version,
       b.status, b.expected_row_count, b.loaded_row_count
FROM import_work.import_batches AS b
JOIN roads_loader_params AS p ON p.batch_code = b.batch_code
WHERE b.entity_family = 'roads';

DO $$
DECLARE
    b roads_loader_batch%ROWTYPE;
    v_actual bigint; v_safe_new bigint; v_safe_update bigint; v_other bigint;
    v_dry boolean; v_start timestamptz := clock_timestamp();
BEGIN
    SELECT * INTO b FROM roads_loader_batch;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'roads loader: batch not found or wrong entity_family';
    END IF;
    SELECT dry_run INTO v_dry FROM roads_loader_params;
    IF b.status NOT IN ('loaded', 'validated', 'applied', 'failed') THEN
        RAISE EXCEPTION 'roads loader: batch status % not loadable', b.status;
    END IF;
    IF b.source_snapshot_id IS NULL OR nullif(btrim(b.source_snapshot_version), '') IS NULL THEN
        RAISE EXCEPTION 'roads loader: batch missing snapshot identity';
    END IF;

    SELECT count(*),
           count(*) FILTER (WHERE r.classification = 'safe_new'),
           count(*) FILTER (WHERE r.classification = 'safe_update'),
           count(*) FILTER (WHERE r.classification NOT IN ('safe_new', 'safe_update'))
    INTO v_actual, v_safe_new, v_safe_update, v_other
    FROM import_work.road_rows AS r
    WHERE r.import_batch_id = b.import_batch_id;

    IF b.loaded_row_count IS NOT NULL AND b.loaded_row_count <> v_actual THEN
        RAISE EXCEPTION 'roads loader: loaded_row_count (%) <> actual (%)',
            b.loaded_row_count, v_actual;
    END IF;
    IF b.expected_row_count IS NOT NULL AND b.expected_row_count <> v_actual THEN
        RAISE EXCEPTION 'roads loader: expected_row_count (%) <> actual (%)',
            b.expected_row_count, v_actual;
    END IF;
    IF EXISTS (
        SELECT 1 FROM import_work.road_rows AS r
        WHERE r.import_batch_id = b.import_batch_id
          AND r.source_snapshot_version IS DISTINCT FROM b.source_snapshot_version
    ) THEN
        RAISE EXCEPTION 'roads loader: work-row snapshot_version mismatch vs batch';
    END IF;

    RAISE NOTICE 'roads_loader [5%%] precheck ok batch=% dry_run=% actual=% safe_new=% safe_update=% other_ignored=% elapsed_ms=%',
        b.batch_code, v_dry, v_actual, v_safe_new, v_safe_update, v_other,
        round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);
END $$;

DROP TABLE IF EXISTS roads_loader_work;
CREATE TEMP TABLE roads_loader_work AS
SELECT
    r.id,
    r.external_id,
    r.classification,
    r.target_core_id,
    r.local_staging_id,
    system.pipeline_osm_identity_key(r.external_id) AS identity_key,
    nullif(btrim(r.canonical_name), '') AS canonical_name,
    nullif(btrim(r.name_en), '') AS name_en,
    nullif(btrim(r.name_mm), '') AS name_mm,
    coalesce(
        r.road_class_id,
        (
            SELECT rc.id FROM ref.ref_road_classes AS rc
            WHERE lower(btrim(rc.code)) = lower(btrim(coalesce(r.class_code, '')))
            ORDER BY rc.id LIMIT 1
        )
    ) AS road_class_id,
    nullif(btrim(coalesce(
        r.class_code,
        (
            SELECT rc.code FROM ref.ref_road_classes AS rc
            WHERE rc.id = r.road_class_id
            LIMIT 1
        )
    )), '') AS class_code,
    r.admin_area_id,
    pg_temp.roads_loader_line_geom(r.geom) AS geom_ready,
    coalesce(r.is_oneway, false) AS is_oneway,
    coalesce(r.bridge, false) AS bridge,
    coalesce(r.tunnel, false) AS tunnel,
    coalesce(r.layer, 0) AS layer,
    nullif(btrim(r.surface), '') AS surface,
    r.confidence_score,
    coalesce(r.source_refs, '{}'::jsonb) AS source_refs,
    coalesce(r.normalized_data, '{}'::jsonb) AS normalized_data,
    pg_temp.roads_loader_is_synthetic_name(r.canonical_name) AS name_is_synthetic
FROM import_work.road_rows AS r
JOIN roads_loader_batch AS b ON b.import_batch_id = r.import_batch_id
WHERE r.classification IN ('safe_new', 'safe_update')
ORDER BY r.id
LIMIT greatest(
    (SELECT sample_limit FROM roads_loader_params),
    CASE WHEN (SELECT sample_limit FROM roads_loader_params) = 0 THEN 1000000000 ELSE 0 END
);

CREATE INDEX ON roads_loader_work (id);
CREATE INDEX ON roads_loader_work (identity_key);

DO $$ BEGIN
    RAISE NOTICE 'roads_loader [15%%] work rows ready n=%',
        (SELECT count(*) FROM roads_loader_work);
END $$;

UPDATE import_work.road_rows AS r
SET validation_status = 'ready',
    validation_result = jsonb_build_object(
        'identity_key', w.identity_key,
        'geom_ok', w.geom_ready IS NOT NULL,
        'road_class_id', w.road_class_id,
        'class_code', w.class_code
    )
FROM roads_loader_work AS w
WHERE r.id = w.id;

DROP TABLE IF EXISTS roads_loader_ext_candidates;
CREATE TEMP TABLE roads_loader_ext_candidates AS
SELECT DISTINCT x.external_id
FROM roads_loader_work AS w
CROSS JOIN LATERAL (
    VALUES
        (w.external_id),
        (w.identity_key),
        (
            CASE
                WHEN w.identity_key LIKE 'osm:way:%'
                    THEN 'osm:W:' || split_part(w.identity_key, ':', 3)
                WHEN w.identity_key LIKE 'osm:node:%'
                    THEN 'osm:N:' || split_part(w.identity_key, ':', 3)
                WHEN w.identity_key LIKE 'osm:relation:%'
                    THEN 'osm:R:' || split_part(w.identity_key, ':', 3)
                ELSE NULL
            END
        )
) AS x(external_id)
WHERE nullif(btrim(x.external_id), '') IS NOT NULL;

CREATE INDEX ON roads_loader_ext_candidates (external_id);

DROP TABLE IF EXISTS roads_loader_core;
CREATE TEMP TABLE roads_loader_core AS
WITH matched AS (
    SELECT c.*
    FROM core.core_streets AS c
    WHERE c.deleted_at IS NULL
      AND coalesce(c.is_active, true)
      AND c.id IN (
            SELECT w.target_core_id
            FROM roads_loader_work AS w
            WHERE w.target_core_id IS NOT NULL
      )
    UNION
    SELECT c.*
    FROM core.core_streets AS c
    JOIN roads_loader_ext_candidates AS e ON e.external_id = c.external_id
    WHERE c.deleted_at IS NULL
      AND coalesce(c.is_active, true)
)
SELECT
    m.id,
    system.pipeline_osm_identity_key(m.external_id) AS identity_key,
    m.external_id,
    m.canonical_name,
    m.road_class_id,
    m.road_class,
    m.geom,
    m.admin_area_id,
    m.is_oneway,
    m.bridge,
    m.tunnel,
    m.layer,
    m.surface,
    m.is_verified,
    m.verification_status,
    m.manual_override,
    m.source_refs,
    m.normalized_data,
    m.source_type_id,
    (
        pg_temp.roads_loader_is_synthetic_name(m.canonical_name)
        OR coalesce((m.normalized_data->>'name_is_generated')::boolean, false)
        OR (
            nullif(btrim(m.normalized_data->>'generated_label'), '') IS NOT NULL
            AND pg_temp.roads_loader_is_synthetic_name(m.normalized_data->>'generated_label')
        )
    ) AS name_is_placeholder
FROM matched AS m;

CREATE INDEX ON roads_loader_core (id);
CREATE INDEX ON roads_loader_core (identity_key);

DO $$ BEGIN
    RAISE NOTICE 'roads_loader [30%%] building plan...';
END $$;

DROP TABLE IF EXISTS roads_loader_plan;
CREATE TEMP TABLE roads_loader_plan (
    work_id bigint PRIMARY KEY,
    classification text NOT NULL,
    identity_key text,
    external_id text NOT NULL,
    action text NOT NULL,
    skip_reason text,
    fail_reason text,
    conflict_reason text,
    target_core_id bigint,
    core_is_verified boolean,
    core_manual_protected boolean,
    apply_name boolean NOT NULL DEFAULT false,
    apply_admin boolean NOT NULL DEFAULT false
);

WITH dup AS (
    SELECT identity_key
    FROM roads_loader_work
    WHERE identity_key IS NOT NULL
    GROUP BY identity_key
    HAVING count(*) > 1
),
matched AS (
    SELECT
        w.id AS work_id,
        w.classification,
        w.identity_key,
        w.external_id,
        w.canonical_name,
        w.name_is_synthetic,
        w.road_class_id,
        w.class_code,
        w.admin_area_id,
        w.geom_ready,
        w.is_oneway,
        w.bridge,
        w.tunnel,
        w.layer,
        w.surface,
        w.source_refs,
        w.normalized_data,
        w.target_core_id AS declared_target_id,
        coalesce(c_by_id.id, c_by_key.id) AS matched_core_id,
        coalesce(c_by_id.is_verified, c_by_key.is_verified, false)
            OR lower(coalesce(c_by_id.verification_status, c_by_key.verification_status, '')) = 'verified'
            AS core_is_verified,
        coalesce(c_by_id.manual_override, c_by_key.manual_override, false)
            OR coalesce((coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'manual_override') IN ('true','t','1'), false)
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"dashboard"}'::jsonb
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"manual"}'::jsonb
            AS core_manual_protected,
        coalesce(c_by_id.canonical_name, c_by_key.canonical_name) AS core_name,
        coalesce(c_by_id.name_is_placeholder, c_by_key.name_is_placeholder, false) AS core_name_placeholder,
        coalesce(c_by_id.road_class_id, c_by_key.road_class_id) AS core_road_class_id,
        lower(btrim(coalesce(
            c_by_id.road_class, c_by_key.road_class,
            (SELECT rc.code FROM ref.ref_road_classes rc
             WHERE rc.id = coalesce(c_by_id.road_class_id, c_by_key.road_class_id) LIMIT 1),
            ''
        ))) AS core_class_code,
        lower(btrim(coalesce(w.class_code, ''))) AS work_class_code,
        coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) AS core_admin_area_id,
        coalesce(c_by_id.geom, c_by_key.geom) AS core_geom,
        coalesce(c_by_id.is_oneway, c_by_key.is_oneway, false) AS core_is_oneway,
        coalesce(c_by_id.bridge, c_by_key.bridge, false) AS core_bridge,
        coalesce(c_by_id.tunnel, c_by_key.tunnel, false) AS core_tunnel,
        coalesce(c_by_id.layer, c_by_key.layer, 0) AS core_layer,
        nullif(btrim(coalesce(c_by_id.surface, c_by_key.surface, '')), '') AS core_surface,
        EXISTS (SELECT 1 FROM dup d WHERE d.identity_key = w.identity_key) AS dup_identity,
        EXISTS (
            SELECT 1 FROM ref.ref_road_classes rc
            WHERE rc.id = w.road_class_id
        ) AS class_ok,
        -- geometry change beyond tiny serialization noise (~1.1cm snap / hausdorff 1e-7°)
        CASE
            WHEN coalesce(c_by_id.geom, c_by_key.geom) IS NULL OR w.geom_ready IS NULL THEN true
            WHEN ST_Equals(
                    ST_SnapToGrid(ST_Force2D(coalesce(c_by_id.geom, c_by_key.geom)), 0.0000001),
                    ST_SnapToGrid(ST_Force2D(w.geom_ready), 0.0000001)
                 ) THEN false
            WHEN ST_HausdorffDistance(
                    ST_SnapToGrid(ST_Force2D(coalesce(c_by_id.geom, c_by_key.geom)), 0.0000001),
                    ST_SnapToGrid(ST_Force2D(w.geom_ready), 0.0000001)
                 ) < 0.0000001 THEN false
            ELSE true
        END AS geom_changed,
        -- name: allow only placeholder → real
        (
            coalesce(c_by_id.name_is_placeholder, c_by_key.name_is_placeholder, false)
            AND NOT w.name_is_synthetic
            AND nullif(btrim(w.canonical_name), '') IS NOT NULL
        ) AS name_placeholder_fill,
        (
            NOT coalesce(c_by_id.name_is_placeholder, c_by_key.name_is_placeholder, false)
            AND NOT w.name_is_synthetic
            AND lower(btrim(coalesce(c_by_id.canonical_name, c_by_key.canonical_name, '')))
                IS DISTINCT FROM lower(btrim(coalesce(w.canonical_name, '')))
            AND nullif(btrim(w.canonical_name), '') IS NOT NULL
        ) AS real_name_replacement,
        -- class meaning: different codes = conflict; same code different id = mechanical
        (
            nullif(lower(btrim(coalesce(w.class_code, ''))), '') IS NOT NULL
            AND nullif(lower(btrim(coalesce(
                c_by_id.road_class, c_by_key.road_class,
                (SELECT rc.code FROM ref.ref_road_classes rc
                 WHERE rc.id = coalesce(c_by_id.road_class_id, c_by_key.road_class_id) LIMIT 1),
                ''
            ))), '') IS NOT NULL
            AND lower(btrim(w.class_code)) IS DISTINCT FROM lower(btrim(coalesce(
                c_by_id.road_class, c_by_key.road_class,
                (SELECT rc.code FROM ref.ref_road_classes rc
                 WHERE rc.id = coalesce(c_by_id.road_class_id, c_by_key.road_class_id) LIMIT 1),
                ''
            )))
        ) AS class_code_changed,
        (
            coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) IS NULL
            AND w.admin_area_id IS NOT NULL
        ) AS admin_fill_ok,
        (
            coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) IS NOT NULL
            AND w.admin_area_id IS NOT NULL
            AND coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) IS DISTINCT FROM w.admin_area_id
        ) AS admin_ambiguous
    FROM roads_loader_work AS w
    LEFT JOIN roads_loader_core AS c_by_id
        ON w.target_core_id IS NOT NULL AND c_by_id.id = w.target_core_id
    LEFT JOIN roads_loader_core AS c_by_key
        ON w.identity_key IS NOT NULL
       AND c_by_key.identity_key = w.identity_key
       AND c_by_id.id IS NULL
)
INSERT INTO roads_loader_plan (
    work_id, classification, identity_key, external_id, action,
    skip_reason, fail_reason, conflict_reason,
    target_core_id, core_is_verified, core_manual_protected,
    apply_name, apply_admin
)
SELECT
    m.work_id,
    m.classification,
    m.identity_key,
    m.external_id,
    CASE
        WHEN m.identity_key IS NULL THEN 'fail'
        WHEN m.dup_identity THEN 'fail'
        WHEN m.canonical_name IS NULL THEN 'fail'
        WHEN m.road_class_id IS NULL OR NOT m.class_ok THEN 'fail'
        WHEN m.geom_ready IS NULL
             OR NOT ST_IsValid(m.geom_ready)
             OR ST_IsEmpty(m.geom_ready)
             OR ST_SRID(m.geom_ready) <> 4326
             OR GeometryType(m.geom_ready) <> 'LINESTRING' THEN 'fail'
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL THEN 'skip'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL THEN 'fail'
        WHEN m.classification = 'safe_update' AND m.core_manual_protected THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.core_is_verified
             AND (
                 m.geom_changed OR m.real_name_replacement OR m.class_code_changed
                 OR m.admin_ambiguous OR m.name_placeholder_fill
                 OR m.is_oneway IS DISTINCT FROM m.core_is_oneway
                 OR m.bridge IS DISTINCT FROM m.core_bridge
                 OR m.tunnel IS DISTINCT FROM m.core_tunnel
                 OR m.layer IS DISTINCT FROM m.core_layer
                 OR m.surface IS DISTINCT FROM m.core_surface
                 OR m.road_class_id IS DISTINCT FROM m.core_road_class_id
             ) THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.geom_changed THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.real_name_replacement THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.class_code_changed THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.admin_ambiguous THEN 'conflict_ir'
        WHEN m.classification = 'safe_update'
             AND NOT m.geom_changed
             AND NOT m.real_name_replacement
             AND NOT m.class_code_changed
             AND NOT m.admin_ambiguous
             AND m.road_class_id IS NOT DISTINCT FROM m.core_road_class_id
             AND m.is_oneway IS NOT DISTINCT FROM m.core_is_oneway
             AND m.bridge IS NOT DISTINCT FROM m.core_bridge
             AND m.tunnel IS NOT DISTINCT FROM m.core_tunnel
             AND m.layer IS NOT DISTINCT FROM m.core_layer
             AND m.surface IS NOT DISTINCT FROM m.core_surface
             AND NOT m.name_placeholder_fill
             AND NOT m.admin_fill_ok
            THEN 'skip'
        WHEN m.classification = 'safe_update' THEN 'update'
        WHEN m.classification = 'safe_new' THEN 'insert'
        ELSE 'fail'
    END,
    CASE
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL
            THEN 'identity already in core (rerun skip)'
        WHEN m.classification = 'safe_update'
             AND NOT m.geom_changed
             AND m.road_class_id IS NOT DISTINCT FROM m.core_road_class_id
             AND m.is_oneway IS NOT DISTINCT FROM m.core_is_oneway
             AND m.bridge IS NOT DISTINCT FROM m.core_bridge
             AND m.tunnel IS NOT DISTINCT FROM m.core_tunnel
             AND m.layer IS NOT DISTINCT FROM m.core_layer
             AND m.surface IS NOT DISTINCT FROM m.core_surface
             AND NOT m.name_placeholder_fill
             AND NOT m.admin_fill_ok
            THEN 'allowlist unchanged (idempotent rerun)'
        ELSE NULL
    END,
    CASE
        WHEN m.identity_key IS NULL THEN 'external_id has no OSM identity key'
        WHEN m.dup_identity THEN 'duplicate identity_key in batch'
        WHEN m.canonical_name IS NULL THEN 'canonical_name required'
        WHEN m.road_class_id IS NULL OR NOT m.class_ok THEN 'missing or unknown road_class_id'
        WHEN m.geom_ready IS NULL
             OR NOT ST_IsValid(m.geom_ready)
             OR ST_IsEmpty(m.geom_ready)
             OR ST_SRID(m.geom_ready) <> 4326
             OR GeometryType(m.geom_ready) <> 'LINESTRING' THEN 'invalid LineString geometry'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL
            THEN 'safe_update has no matching core identity'
        ELSE NULL
    END,
    CASE
        WHEN m.classification = 'safe_update' AND m.core_manual_protected
            THEN 'manual/dashboard protected — Import Review'
        WHEN m.classification = 'safe_update' AND m.core_is_verified
            THEN 'verified meaningful change — Import Review'
        WHEN m.classification = 'safe_update' AND m.geom_changed
            THEN 'geometry change — Import Review'
        WHEN m.classification = 'safe_update' AND m.real_name_replacement
            THEN 'real name replacement — Import Review'
        WHEN m.classification = 'safe_update' AND m.class_code_changed
            THEN 'road class meaning change — Import Review'
        WHEN m.classification = 'safe_update' AND m.admin_ambiguous
            THEN 'ambiguous admin assignment — Import Review'
        ELSE NULL
    END,
    m.matched_core_id,
    coalesce(m.core_is_verified, false),
    coalesce(m.core_manual_protected, false),
    coalesce(m.name_placeholder_fill, false),
    coalesce(m.admin_fill_ok, false)
FROM matched AS m;

DO $$
DECLARE
    v_fail bigint; v_sample text;
    v_insert bigint; v_update bigint; v_skip bigint; v_conflict bigint; v_total bigint;
BEGIN
    SELECT count(*), min(fail_reason || ' [' || external_id || ']')
    INTO v_fail, v_sample
    FROM roads_loader_plan WHERE action = 'fail';

    SELECT
        count(*) FILTER (WHERE action = 'insert'),
        count(*) FILTER (WHERE action = 'update'),
        count(*) FILTER (WHERE action = 'skip'),
        count(*) FILTER (WHERE action = 'conflict_ir'),
        count(*)
    INTO v_insert, v_update, v_skip, v_conflict, v_total
    FROM roads_loader_plan;

    RAISE NOTICE 'roads_loader [45%%] plan ready total=% insert=% update=% skip=% conflict_ir=% fail=%',
        v_total, v_insert, v_update, v_skip, v_conflict, v_fail;

    IF v_fail > 0 THEN
        RAISE EXCEPTION 'roads loader: % failed row(s); sample: %', v_fail, v_sample;
    END IF;
END $$;

DROP TABLE IF EXISTS roads_loader_result;
CREATE TEMP TABLE roads_loader_result (
    inserted bigint NOT NULL DEFAULT 0,
    updated bigint NOT NULL DEFAULT 0,
    skipped bigint NOT NULL DEFAULT 0,
    failed bigint NOT NULL DEFAULT 0,
    conflict_ir bigint NOT NULL DEFAULT 0,
    names_written bigint NOT NULL DEFAULT 0,
    ir_review_batch_id bigint,
    publish_batch_id bigint,
    core_before bigint,
    core_after bigint,
    duration_ms numeric
);

INSERT INTO roads_loader_result (skipped, failed, conflict_ir, core_before)
SELECT
    (SELECT count(*) FROM roads_loader_plan WHERE action = 'skip'),
    (SELECT count(*) FROM roads_loader_plan WHERE action = 'fail'),
    (SELECT count(*) FROM roads_loader_plan WHERE action = 'conflict_ir'),
    -- Avoid full-table count on ~800k streets; use planner estimate.
    (
        SELECT greatest(coalesce(c.reltuples, 0), 0)::bigint
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'core' AND c.relname = 'core_streets'
    );

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_inserted bigint := 0;
    v_updated bigint := 0;
    v_names bigint := 0;
    v_ir_batch bigint;
    v_conflict_n bigint;
    v_batch_code text;
    v_snap_ver text;
    v_snap_id bigint;
    v_region text;
    v_osm_source_type_id bigint;
    v_chunk_size int := 200;
    v_total bigint;
    v_done bigint := 0;
    v_ids bigint[];
    v_chunk_n bigint;
    v_pct int;
BEGIN
    PERFORM set_config('local_map.edit_reason', 'import_work.roads_safe_loader', true);

    SELECT id INTO v_osm_source_type_id
    FROM ref.ref_source_types
    WHERE code = 'osm'
    ORDER BY id LIMIT 1;
    IF v_osm_source_type_id IS NULL THEN
        RAISE EXCEPTION 'roads loader: ref.ref_source_types code=osm missing';
    END IF;

    SELECT count(*) INTO v_total FROM roads_loader_plan WHERE action = 'insert';
    RAISE NOTICE 'roads_loader [50%%] insert start total=% chunk=%', v_total, v_chunk_size;

    IF v_total > 0 THEN
        LOOP
            SELECT coalesce(array_agg(work_id ORDER BY work_id), ARRAY[]::bigint[])
            INTO v_ids
            FROM (
                SELECT work_id FROM roads_loader_plan
                WHERE action = 'insert'
                ORDER BY work_id OFFSET v_done LIMIT v_chunk_size
            ) s;
            EXIT WHEN coalesce(array_length(v_ids, 1), 0) = 0;

            WITH ins AS (
                INSERT INTO core.core_streets (
                    external_id, canonical_name, geom, admin_area_id, source_type_id,
                    road_class_id, road_class, surface, is_oneway, bridge, tunnel, layer,
                    source_refs, normalized_data, is_active, manual_override,
                    edit_status, routing_status, deleted_at, last_edited_at,
                    is_verified, verification_status, created_at, updated_at
                )
                SELECT
                    w.external_id,
                    w.canonical_name,
                    w.geom_ready,
                    w.admin_area_id,
                    v_osm_source_type_id,
                    w.road_class_id,
                    w.class_code,
                    w.surface,
                    w.is_oneway,
                    w.bridge,
                    w.tunnel,
                    w.layer,
                    coalesce(w.source_refs, '{}'::jsonb) || jsonb_build_object(
                        'external_id', w.external_id,
                        'loader', 'import_work.roads_safe_loader'
                    ),
                    coalesce(w.normalized_data, '{}'::jsonb) || jsonb_build_object(
                        'class_code', w.class_code,
                        'loader', 'import_work.roads_safe_loader',
                        'name_is_generated', w.name_is_synthetic
                    ),
                    true, false, 'published', 'needs_rebuild',
                    NULL::timestamptz, now(),
                    false, 'unverified', now(), now()
                FROM roads_loader_work AS w
                JOIN roads_loader_plan AS p ON p.work_id = w.id
                WHERE p.action = 'insert' AND w.id = ANY (v_ids)
                RETURNING id, external_id, canonical_name
            ),
            name_src AS (
                SELECT i.id AS street_id, w.name_en, w.name_mm, w.canonical_name, w.name_is_synthetic
                FROM ins i
                JOIN roads_loader_work w
                  ON system.pipeline_osm_identity_key(w.external_id)
                   = system.pipeline_osm_identity_key(i.external_id)
            ),
            ins_my AS (
                INSERT INTO core.core_street_names (
                    street_id, name, language_code, script_code, name_type, is_primary
                )
                SELECT street_id, name_mm, 'my', 'Mymr', 'primary', true
                FROM name_src
                WHERE name_mm IS NOT NULL AND NOT pg_temp.roads_loader_is_synthetic_name(name_mm)
                RETURNING id
            ),
            ins_en AS (
                INSERT INTO core.core_street_names (
                    street_id, name, language_code, script_code, name_type, is_primary
                )
                SELECT street_id, name_en, 'en', 'Latn', 'primary', true
                FROM name_src
                WHERE name_en IS NOT NULL AND NOT pg_temp.roads_loader_is_synthetic_name(name_en)
                RETURNING id
            ),
            ins_und AS (
                INSERT INTO core.core_street_names (
                    street_id, name, language_code, script_code, name_type, is_primary
                )
                SELECT street_id, canonical_name, 'und', NULL, 'primary', true
                FROM name_src
                WHERE name_en IS NULL AND name_mm IS NULL
                  AND canonical_name IS NOT NULL
                  AND NOT name_is_synthetic
                RETURNING id
            )
            SELECT
                (SELECT count(*) FROM ins),
                (SELECT count(*) FROM ins_my) + (SELECT count(*) FROM ins_en) + (SELECT count(*) FROM ins_und)
            INTO v_chunk_n, v_names;

            v_inserted := v_inserted + coalesce(v_chunk_n, 0);
            UPDATE roads_loader_result
            SET inserted = v_inserted,
                names_written = names_written + coalesce(v_names, 0);
            v_done := v_done + coalesce(v_chunk_n, 0);
            v_pct := least(70, 50 + ((v_done * 20) / greatest(v_total, 1))::int);
            RAISE NOTICE 'roads_loader [% %%] insert progress %/%', v_pct, v_done, v_total;
            EXIT WHEN v_done >= v_total;
        END LOOP;
    ELSE
        RAISE NOTICE 'roads_loader [70%%] insert skipped (0 rows)';
    END IF;

    RAISE NOTICE 'roads_loader [75%%] updates starting...';

    WITH upd AS (
        UPDATE core.core_streets AS c
        SET
            road_class_id = w.road_class_id,
            road_class = coalesce(w.class_code, c.road_class),
            is_oneway = w.is_oneway,
            bridge = w.bridge,
            tunnel = w.tunnel,
            layer = w.layer,
            surface = coalesce(w.surface, c.surface),
            admin_area_id = CASE
                WHEN p.apply_admin THEN w.admin_area_id
                ELSE c.admin_area_id
            END,
            canonical_name = CASE
                WHEN p.apply_name THEN w.canonical_name
                ELSE c.canonical_name
            END,
            source_refs = coalesce(w.source_refs, '{}'::jsonb) || jsonb_build_object(
                'external_id', w.external_id,
                'loader', 'import_work.roads_safe_loader'
            ),
            normalized_data = coalesce(c.normalized_data, '{}'::jsonb)
                || coalesce(w.normalized_data, '{}'::jsonb)
                || jsonb_build_object(
                    'class_code', w.class_code,
                    'loader', 'import_work.roads_safe_loader',
                    'name_is_generated', CASE WHEN p.apply_name THEN false ELSE NULL END
                ),
            last_edited_at = now(),
            updated_at = now()
        FROM roads_loader_work AS w
        JOIN roads_loader_plan AS p ON p.work_id = w.id
        WHERE p.action = 'update'
          AND c.id = p.target_core_id
          AND c.deleted_at IS NULL
          AND coalesce(c.is_active, true)
          AND NOT coalesce(c.manual_override, false)
          AND NOT coalesce(c.is_verified, false)
          AND lower(coalesce(c.verification_status, '')) <> 'verified'
        RETURNING c.id, w.name_en, w.name_mm, w.canonical_name, p.apply_name, w.name_is_synthetic
    ),
    del_names AS (
        DELETE FROM core.core_street_names AS n
        USING upd AS u
        WHERE u.apply_name
          AND n.street_id = u.id
          AND n.name_type = 'primary'
          AND n.is_primary IS TRUE
          AND (
                (u.name_en IS NOT NULL AND n.language_code = 'en')
             OR (u.name_mm IS NOT NULL AND n.language_code IN ('my', 'mm'))
             OR (u.name_en IS NULL AND u.name_mm IS NULL AND n.language_code = 'und')
          )
        RETURNING n.id
    ),
    ins_my AS (
        INSERT INTO core.core_street_names (
            street_id, name, language_code, script_code, name_type, is_primary
        )
        SELECT id, name_mm, 'my', 'Mymr', 'primary', true
        FROM upd
        WHERE apply_name AND name_mm IS NOT NULL
          AND NOT pg_temp.roads_loader_is_synthetic_name(name_mm)
        RETURNING id
    ),
    ins_en AS (
        INSERT INTO core.core_street_names (
            street_id, name, language_code, script_code, name_type, is_primary
        )
        SELECT id, name_en, 'en', 'Latn', 'primary', true
        FROM upd
        WHERE apply_name AND name_en IS NOT NULL
          AND NOT pg_temp.roads_loader_is_synthetic_name(name_en)
        RETURNING id
    ),
    ins_und AS (
        INSERT INTO core.core_street_names (
            street_id, name, language_code, script_code, name_type, is_primary
        )
        SELECT id, canonical_name, 'und', NULL, 'primary', true
        FROM upd
        WHERE apply_name AND name_en IS NULL AND name_mm IS NULL
          AND canonical_name IS NOT NULL AND NOT name_is_synthetic
        RETURNING id
    )
    SELECT
        (SELECT count(*) FROM upd),
        (SELECT count(*) FROM ins_my) + (SELECT count(*) FROM ins_en) + (SELECT count(*) FROM ins_und)
    INTO v_updated, v_names;

    UPDATE roads_loader_result
    SET names_written = names_written + coalesce(v_names, 0);

    RAISE NOTICE 'roads_loader [80%%] updates=%; conflict IR upload...', coalesce(v_updated, 0);

    SELECT count(*) INTO v_conflict_n
    FROM roads_loader_plan WHERE action = 'conflict_ir';

    IF v_conflict_n > 0 THEN
        SELECT batch_code, source_snapshot_version, source_snapshot_id
        INTO v_batch_code, v_snap_ver, v_snap_id
        FROM roads_loader_batch;

        v_region := coalesce(
            (
                SELECT nullif(btrim(w.source_refs->>'region_code'), '')
                FROM roads_loader_work w
                JOIN roads_loader_plan p ON p.work_id = w.id
                WHERE p.action = 'conflict_ir'
                LIMIT 1
            ),
            'MM-YANGON'
        );

        INSERT INTO import_review.review_batches (
            batch_name, source_snapshot_version, source_snapshot_id_local,
            region_code, entity_families, status, upload_mode,
            total_candidate_count, uploaded_candidate_count, summary
        ) VALUES (
            format('safe_loader_road_conflicts_%s_%s', v_batch_code,
                   to_char(clock_timestamp(), 'YYYYMMDDHH24MISS')),
            v_snap_ver, v_snap_id, v_region, ARRAY['roads']::text[],
            'uploaded', 'safe_loader_conflict',
            v_conflict_n::int, v_conflict_n::int,
            jsonb_build_object(
                'loader', 'import_work.roads_safe_loader',
                'import_batch_code', v_batch_code,
                'conflict_count', v_conflict_n
            )
        )
        RETURNING id INTO v_ir_batch;

        INSERT INTO import_review.road_candidates (
            review_batch_id, source_snapshot_version, source_snapshot_id_local,
            local_staging_id, entity_family, external_id, canonical_name,
            class_code, confidence_score, match_status, auto_action,
            review_status, review_note, normalized_data, source_refs,
            matched_core_id, matched_core_table,
            road_class_id, road_class, surface, is_oneway, bridge, tunnel, layer,
            geom, name_mm, name_en, admin_area_id, promotion_status
        )
        SELECT
            v_ir_batch, v_snap_ver, v_snap_id,
            coalesce(w.local_staging_id, w.id),
            'roads', w.external_id, w.canonical_name,
            w.class_code, coalesce(w.confidence_score, 60),
            'conflict', 'needs_review', 'needs_review', p.conflict_reason,
            coalesce(w.normalized_data, '{}'::jsonb) || jsonb_build_object(
                'conflict_reason', p.conflict_reason,
                'loader', 'import_work.roads_safe_loader'
            ),
            coalesce(w.source_refs, '{}'::jsonb) || jsonb_build_object(
                'external_id', w.external_id,
                'conflict_reason', p.conflict_reason
            ),
            p.target_core_id,
            CASE WHEN p.target_core_id IS NOT NULL THEN 'core.core_streets' ELSE NULL END,
            w.road_class_id, w.class_code, w.surface,
            w.is_oneway, w.bridge, w.tunnel, w.layer,
            ST_Multi(w.geom_ready),
            w.name_mm, w.name_en, w.admin_area_id,
            'not_ready'
        FROM roads_loader_work w
        JOIN roads_loader_plan p ON p.work_id = w.id
        WHERE p.action = 'conflict_ir'
        ON CONFLICT (source_snapshot_version, entity_family, local_staging_id)
        DO UPDATE SET
            review_batch_id = EXCLUDED.review_batch_id,
            review_note = EXCLUDED.review_note,
            matched_core_id = EXCLUDED.matched_core_id,
            review_status = 'needs_review',
            updated_at = now();
    END IF;

    UPDATE roads_loader_result
    SET
        inserted = coalesce(v_inserted, 0),
        updated = coalesce(v_updated, 0),
        ir_review_batch_id = v_ir_batch,
        duration_ms = round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);

    RAISE NOTICE 'roads_loader [90%%] writes complete conflict_ir=% ir_batch=%',
        v_conflict_n, v_ir_batch;
END $$;

UPDATE roads_loader_result
SET core_after = core_before + inserted;

DO $$ BEGIN
    RAISE NOTICE 'roads_loader [95%%] writing publish batch + batch summary...';
END $$;

WITH pub AS (
    INSERT INTO system.system_publish_batches (
        batch_name, status, note, source_snapshot_version,
        total_item_count, success_count, failed_count, skipped_count,
        summary, published_at, promoted_at
    )
    SELECT
        format('import_work_roads:%s:%s', b.batch_code,
               to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')),
        CASE WHEN p.dry_run THEN 'cancelled' ELSE 'promoted' END,
        CASE WHEN p.dry_run THEN 'dry_run (will roll back if wrapper rolls back)'
             ELSE 'import_work roads safe loader' END,
        b.source_snapshot_version,
        (SELECT count(*) FROM roads_loader_plan)::int,
        (SELECT (inserted + updated)::int FROM roads_loader_result),
        (SELECT failed::int FROM roads_loader_result),
        (SELECT (skipped + conflict_ir)::int FROM roads_loader_result),
        jsonb_build_object(
            'loader', 'import_work.roads_safe_loader',
            'import_batch_id', b.import_batch_id,
            'batch_code', b.batch_code,
            'entity_family', 'roads',
            'dry_run', p.dry_run,
            'allowlist', jsonb_build_array(
                'road_class_id_mechanical', 'is_oneway', 'bridge', 'tunnel',
                'layer', 'surface', 'source_refs', 'normalized_data',
                'admin_area_id_fill', 'placeholder_name_fill'
            ),
            'counts', (SELECT to_jsonb(r) - 'publish_batch_id' FROM roads_loader_result r),
            'skip_reasons', (
                SELECT coalesce(jsonb_object_agg(skip_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT skip_reason, count(*) AS cnt
                    FROM roads_loader_plan
                    WHERE action = 'skip' AND skip_reason IS NOT NULL
                    GROUP BY skip_reason
                ) s
            ),
            'conflict_reasons', (
                SELECT coalesce(jsonb_object_agg(conflict_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT conflict_reason, count(*) AS cnt
                    FROM roads_loader_plan
                    WHERE action = 'conflict_ir' AND conflict_reason IS NOT NULL
                    GROUP BY conflict_reason
                ) s
            )
        ),
        CASE WHEN p.dry_run THEN NULL ELSE now() END,
        CASE WHEN p.dry_run THEN NULL ELSE now() END
    FROM roads_loader_batch b
    CROSS JOIN roads_loader_params p
    RETURNING id
)
UPDATE roads_loader_result SET publish_batch_id = (SELECT id FROM pub);

UPDATE import_work.import_batches AS b
SET
    status = CASE
        WHEN (SELECT dry_run FROM roads_loader_params) THEN b.status
        ELSE 'applied'
    END,
    validation_status = CASE
        WHEN (SELECT dry_run FROM roads_loader_params) THEN b.validation_status
        ELSE 'passed'
    END,
    loaded_row_count = (SELECT count(*) FROM import_work.road_rows r WHERE r.import_batch_id = b.id),
    updated_at = now(),
    validation_summary = coalesce(b.validation_summary, '{}'::jsonb) || jsonb_build_object(
        'roads_safe_loader', (SELECT to_jsonb(r) FROM roads_loader_result r),
        'dry_run', (SELECT dry_run FROM roads_loader_params),
        'ran_at', now()
    )
FROM roads_loader_batch AS lb
WHERE b.id = lb.import_batch_id;

DO $$
DECLARE
    r roads_loader_result%ROWTYPE;
    v_dry boolean;
BEGIN
    SELECT * INTO r FROM roads_loader_result;
    SELECT dry_run INTO v_dry FROM roads_loader_params;
    RAISE NOTICE 'roads_loader [100%%] done dry_run=% inserted=% updated=% skipped=% conflict_ir=% failed=% names=% core_before=% core_after=% delta=% ir_batch=% duration_ms=%',
        v_dry, r.inserted, r.updated, r.skipped, r.conflict_ir, r.failed, r.names_written,
        r.core_before, r.core_after, (r.core_after - r.core_before),
        r.ir_review_batch_id, r.duration_ms;
END $$;

SELECT
    'roads_safe_loader_metrics' AS section,
    (SELECT batch_code FROM roads_loader_batch) AS batch_code,
    (SELECT dry_run FROM roads_loader_params) AS dry_run,
    r.inserted,
    r.updated,
    r.skipped,
    r.conflict_ir,
    r.failed,
    r.names_written,
    r.core_before,
    r.core_after,
    (r.core_after - r.core_before) AS core_delta,
    r.ir_review_batch_id,
    r.publish_batch_id,
    r.duration_ms
FROM roads_loader_result r;
