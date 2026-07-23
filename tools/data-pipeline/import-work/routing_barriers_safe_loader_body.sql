-- =============================================================================
-- Routing barriers set-based safe loader — body (no BEGIN/COMMIT).
-- Requires temp params: routing_barriers_loader_params(batch_code, dry_run, sample_limit)
--
-- Target: routing.routing_barriers (Point geom only). Identity via source_refs.external_id.
-- Writes only classification IN ('safe_new','safe_update').
-- High-risk changes → Import Review (conflict_ir), not direct core write.
-- Does NOT rebuild Valhalla.
--
-- Safe-update allowlist (tight): source_refs + normalized_data only when
--   barrier_type unchanged, access_tags unchanged, geom moved ≤ 2 m.
-- Conflict IR reasons:
--   barrier_type change, access meaning change, location > 5 m,
--   manual/verified target, spatial duplicate within 10 m (other identity).
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('pg_temp.routing_barriers_loader_params') IS NULL THEN
        RAISE EXCEPTION 'routing_barriers loader body: params missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM routing_barriers_loader_params WHERE batch_code IS NOT NULL) THEN
        RAISE EXCEPTION 'routing_barriers loader: batch_code is required';
    END IF;
    IF to_regclass('import_work.routing_barrier_rows') IS NULL THEN
        RAISE EXCEPTION 'routing_barriers loader: import_work.routing_barrier_rows missing — apply migration 143';
    END IF;
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'routing_barriers loader: system.pipeline_osm_identity_key missing — apply migration 137';
    END IF;
    IF to_regclass('routing.routing_barriers') IS NULL THEN
        RAISE EXCEPTION 'routing_barriers loader: routing.routing_barriers missing';
    END IF;
END $$;

DROP TABLE IF EXISTS routing_barriers_loader_batch;
CREATE TEMP TABLE routing_barriers_loader_batch (
    import_batch_id bigint PRIMARY KEY,
    batch_code text NOT NULL,
    source_snapshot_id bigint,
    source_snapshot_version text NOT NULL,
    status text NOT NULL,
    expected_row_count bigint,
    loaded_row_count bigint
) ON COMMIT DROP;

INSERT INTO routing_barriers_loader_batch
SELECT b.id, b.batch_code, b.source_snapshot_id, b.source_snapshot_version,
       b.status, b.expected_row_count, b.loaded_row_count
FROM import_work.import_batches AS b
JOIN routing_barriers_loader_params AS p ON p.batch_code = b.batch_code
WHERE b.entity_family = 'routing_barriers';

DO $$
DECLARE
    b routing_barriers_loader_batch%ROWTYPE;
    v_actual bigint; v_safe_new bigint; v_safe_update bigint; v_other bigint;
    v_dry boolean; v_start timestamptz := clock_timestamp();
BEGIN
    SELECT * INTO b FROM routing_barriers_loader_batch;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'routing_barriers loader: batch not found or wrong entity_family';
    END IF;
    SELECT dry_run INTO v_dry FROM routing_barriers_loader_params;
    IF b.status NOT IN ('loaded', 'validated', 'applied', 'failed') THEN
        RAISE EXCEPTION 'routing_barriers loader: batch status % not loadable', b.status;
    END IF;
    IF b.source_snapshot_id IS NULL OR nullif(btrim(b.source_snapshot_version), '') IS NULL THEN
        RAISE EXCEPTION 'routing_barriers loader: batch missing snapshot identity';
    END IF;

    SELECT count(*),
           count(*) FILTER (WHERE r.classification = 'safe_new'),
           count(*) FILTER (WHERE r.classification = 'safe_update'),
           count(*) FILTER (WHERE r.classification NOT IN ('safe_new', 'safe_update'))
    INTO v_actual, v_safe_new, v_safe_update, v_other
    FROM import_work.routing_barrier_rows AS r
    WHERE r.import_batch_id = b.import_batch_id;

    IF b.loaded_row_count IS NOT NULL AND b.loaded_row_count <> v_actual THEN
        RAISE EXCEPTION 'routing_barriers loader: loaded_row_count (%) <> actual (%)',
            b.loaded_row_count, v_actual;
    END IF;
    IF b.expected_row_count IS NOT NULL AND b.expected_row_count <> v_actual THEN
        RAISE EXCEPTION 'routing_barriers loader: expected_row_count (%) <> actual (%)',
            b.expected_row_count, v_actual;
    END IF;
    IF EXISTS (
        SELECT 1 FROM import_work.routing_barrier_rows AS r
        WHERE r.import_batch_id = b.import_batch_id
          AND r.source_snapshot_version IS DISTINCT FROM b.source_snapshot_version
    ) THEN
        RAISE EXCEPTION 'routing_barriers loader: work-row snapshot_version mismatch vs batch';
    END IF;

    RAISE NOTICE 'routing_barriers_loader [5%%] precheck ok batch=% dry_run=% actual=% safe_new=% safe_update=% other_ignored=% elapsed_ms=%',
        b.batch_code, v_dry, v_actual, v_safe_new, v_safe_update, v_other,
        round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);
END $$;

-- Access meaning key: only routing-relevant access keys
DROP TABLE IF EXISTS routing_barriers_loader_work;
CREATE TEMP TABLE routing_barriers_loader_work AS
SELECT
    r.id,
    r.external_id,
    r.classification,
    r.target_core_id,
    r.local_staging_id,
    system.pipeline_osm_identity_key(r.external_id) AS identity_key,
    nullif(btrim(r.barrier_type), '') AS barrier_type,
    coalesce(r.access_tags, '{}'::jsonb) AS access_tags,
    jsonb_strip_nulls(jsonb_build_object(
        'access', nullif(btrim(coalesce(r.access_tags->>'access', '')), ''),
        'foot', nullif(btrim(coalesce(r.access_tags->>'foot', '')), ''),
        'bicycle', nullif(btrim(coalesce(r.access_tags->>'bicycle', '')), ''),
        'motor_vehicle', nullif(btrim(coalesce(r.access_tags->>'motor_vehicle', '')), ''),
        'vehicle', nullif(btrim(coalesce(r.access_tags->>'vehicle', '')), '')
    )) AS access_meaning,
    CASE
        WHEN r.point_geom IS NOT NULL
             AND GeometryType(r.point_geom) = 'POINT'
             AND ST_SRID(r.point_geom) = 4326
            THEN r.point_geom::geometry(Point, 4326)
        WHEN r.geom IS NOT NULL AND NOT ST_IsEmpty(r.geom)
            THEN ST_PointOnSurface(ST_MakeValid(r.geom))::geometry(Point, 4326)
        ELSE NULL::geometry(Point, 4326)
    END AS point_ready,
    r.core_street_id,
    r.confidence_score,
    coalesce(r.source_refs, '{}'::jsonb) AS source_refs,
    coalesce(r.normalized_data, '{}'::jsonb) AS normalized_data
FROM import_work.routing_barrier_rows AS r
JOIN routing_barriers_loader_batch AS b ON b.import_batch_id = r.import_batch_id
WHERE r.classification IN ('safe_new', 'safe_update')
ORDER BY r.id
LIMIT greatest(
    (SELECT sample_limit FROM routing_barriers_loader_params),
    CASE WHEN (SELECT sample_limit FROM routing_barriers_loader_params) = 0 THEN 1000000000 ELSE 0 END
);

CREATE INDEX ON routing_barriers_loader_work (id);
CREATE INDEX ON routing_barriers_loader_work (identity_key);
CREATE INDEX ON routing_barriers_loader_work USING GIST (point_ready);

DO $$ BEGIN
    RAISE NOTICE 'routing_barriers_loader [15%%] work rows ready n=%',
        (SELECT count(*) FROM routing_barriers_loader_work);
END $$;

UPDATE import_work.routing_barrier_rows AS r
SET validation_status = 'ready',
    validation_result = jsonb_build_object(
        'identity_key', w.identity_key,
        'point_ok', w.point_ready IS NOT NULL
    )
FROM routing_barriers_loader_work AS w
WHERE r.id = w.id;

-- Core identity index (external_id lives in source_refs)
DROP TABLE IF EXISTS routing_barriers_loader_core;
CREATE TEMP TABLE routing_barriers_loader_core AS
SELECT
    c.id,
    system.pipeline_osm_identity_key(
        coalesce(
            nullif(btrim(c.source_refs->>'external_id'), ''),
            nullif(btrim(c.source_refs->>'osm_external_id'), ''),
            CASE
                WHEN nullif(btrim(c.source_refs->>'osm_id'), '') IS NOT NULL
                    THEN 'osm:' || lower(coalesce(nullif(btrim(c.source_refs->>'osm_feature_type'), ''), 'n'))
                         || ':' || btrim(c.source_refs->>'osm_id')
                ELSE NULL
            END
        )
    ) AS identity_key,
    c.barrier_type,
    c.geom,
    c.is_verified,
    c.verification_status,
    c.source_refs,
    c.normalized_data,
    c.core_street_id,
    jsonb_strip_nulls(jsonb_build_object(
        'access', nullif(btrim(coalesce(
            c.normalized_data->'access_tags'->>'access',
            c.normalized_data->'tags'->>'access',
            c.source_refs->'access_tags'->>'access',
            ''
        )), ''),
        'foot', nullif(btrim(coalesce(
            c.normalized_data->'access_tags'->>'foot',
            c.normalized_data->'tags'->>'foot', ''
        )), ''),
        'bicycle', nullif(btrim(coalesce(
            c.normalized_data->'access_tags'->>'bicycle',
            c.normalized_data->'tags'->>'bicycle', ''
        )), ''),
        'motor_vehicle', nullif(btrim(coalesce(
            c.normalized_data->'access_tags'->>'motor_vehicle',
            c.normalized_data->'tags'->>'motor_vehicle', ''
        )), ''),
        'vehicle', nullif(btrim(coalesce(
            c.normalized_data->'access_tags'->>'vehicle',
            c.normalized_data->'tags'->>'vehicle', ''
        )), '')
    )) AS access_meaning,
    (
        coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
        OR c.source_refs @> '{"source":"dashboard"}'::jsonb
        OR c.source_refs @> '{"source":"manual"}'::jsonb
        OR coalesce(c.source_refs->>'source', '') ILIKE '%manual%'
        OR coalesce(c.source_refs->>'source', '') ILIKE '%dashboard%'
    ) AS manual_protected
FROM routing.routing_barriers AS c
WHERE coalesce(c.is_active, true);

CREATE INDEX ON routing_barriers_loader_core (id);
CREATE INDEX ON routing_barriers_loader_core (identity_key);
CREATE INDEX ON routing_barriers_loader_core USING GIST (geom);

DO $$ BEGIN RAISE NOTICE 'routing_barriers_loader [30%%] building plan...'; END $$;

DROP TABLE IF EXISTS routing_barriers_loader_plan;
CREATE TEMP TABLE routing_barriers_loader_plan (
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
    core_manual_protected boolean
);

WITH dup_id AS (
    SELECT identity_key
    FROM routing_barriers_loader_work
    WHERE identity_key IS NOT NULL
    GROUP BY identity_key
    HAVING count(*) > 1
),
dup_spatial AS (
    SELECT a.id AS work_id
    FROM routing_barriers_loader_work AS a
    JOIN routing_barriers_loader_work AS b
      ON a.id < b.id
     AND a.point_ready IS NOT NULL
     AND b.point_ready IS NOT NULL
     AND ST_DWithin(a.point_ready::geography, b.point_ready::geography, 10)
     AND a.identity_key IS DISTINCT FROM b.identity_key
),
matched AS (
    SELECT
        w.id AS work_id,
        w.classification,
        w.identity_key,
        w.external_id,
        w.barrier_type,
        w.access_meaning,
        w.point_ready,
        coalesce(c_by_id.id, c_by_key.id) AS matched_core_id,
        coalesce(c_by_id.barrier_type, c_by_key.barrier_type) AS core_barrier_type,
        coalesce(c_by_id.access_meaning, c_by_key.access_meaning) AS core_access_meaning,
        coalesce(c_by_id.geom, c_by_key.geom) AS core_geom,
        coalesce(c_by_id.is_verified, c_by_key.is_verified, false)
            OR lower(coalesce(c_by_id.verification_status, c_by_key.verification_status, '')) = 'verified'
            AS core_is_verified,
        coalesce(c_by_id.manual_protected, c_by_key.manual_protected, false) AS core_manual_protected,
        EXISTS (SELECT 1 FROM dup_id d WHERE d.identity_key = w.identity_key) AS dup_identity,
        EXISTS (SELECT 1 FROM dup_spatial ds WHERE ds.work_id = w.id) AS dup_spatial_batch,
        EXISTS (
            SELECT 1
            FROM routing_barriers_loader_core AS oc
            WHERE w.point_ready IS NOT NULL
              AND oc.geom IS NOT NULL
              AND ST_DWithin(w.point_ready::geography, oc.geom::geography, 10)
              AND (
                    w.identity_key IS NULL
                 OR oc.identity_key IS NULL
                 OR oc.identity_key IS DISTINCT FROM w.identity_key
              )
              AND coalesce(c_by_id.id, c_by_key.id) IS DISTINCT FROM oc.id
        ) AS spatial_dup_core,
        CASE
            WHEN coalesce(c_by_id.geom, c_by_key.geom) IS NULL OR w.point_ready IS NULL THEN NULL
            ELSE ST_Distance(
                coalesce(c_by_id.geom, c_by_key.geom)::geography,
                w.point_ready::geography
            )
        END AS move_m,
        (
            coalesce(c_by_id.id, c_by_key.id) IS NOT NULL
            AND coalesce(c_by_id.barrier_type, c_by_key.barrier_type) IS NOT DISTINCT FROM w.barrier_type
            AND coalesce(c_by_id.access_meaning, c_by_key.access_meaning) IS NOT DISTINCT FROM w.access_meaning
            AND coalesce(
                ST_Distance(
                    coalesce(c_by_id.geom, c_by_key.geom)::geography,
                    w.point_ready::geography
                ),
                0
            ) <= 2
            AND coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'external_id'
                IS NOT DISTINCT FROM w.external_id
            AND coalesce(c_by_id.source_refs, c_by_key.source_refs)->'access_tags'
                IS NOT DISTINCT FROM w.access_tags
            AND coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'loader'
                = 'import_work.routing_barriers_safe_loader'
        ) AS allowlist_unchanged
    FROM routing_barriers_loader_work AS w
    LEFT JOIN routing_barriers_loader_core AS c_by_id
        ON w.target_core_id IS NOT NULL AND c_by_id.id = w.target_core_id
    LEFT JOIN routing_barriers_loader_core AS c_by_key
        ON w.identity_key IS NOT NULL
       AND c_by_key.identity_key = w.identity_key
       AND c_by_id.id IS NULL
)
INSERT INTO routing_barriers_loader_plan (
    work_id, classification, identity_key, external_id, action,
    skip_reason, fail_reason, conflict_reason,
    target_core_id, core_is_verified, core_manual_protected
)
SELECT
    m.work_id,
    m.classification,
    m.identity_key,
    m.external_id,
    CASE
        WHEN m.identity_key IS NULL THEN 'fail'
        WHEN m.dup_identity THEN 'fail'
        WHEN m.barrier_type IS NULL THEN 'fail'
        WHEN m.point_ready IS NULL
             OR NOT ST_IsValid(m.point_ready)
             OR ST_IsEmpty(m.point_ready)
             OR ST_SRID(m.point_ready) <> 4326
             OR GeometryType(m.point_ready) <> 'POINT' THEN 'fail'
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL THEN 'skip'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL THEN 'fail'
        WHEN m.classification = 'safe_update' AND m.core_manual_protected THEN 'conflict_ir'
        WHEN m.classification = 'safe_update' AND m.core_is_verified THEN 'conflict_ir'
        WHEN m.dup_spatial_batch OR m.spatial_dup_core THEN 'conflict_ir'
        WHEN m.classification = 'safe_update'
             AND m.core_barrier_type IS DISTINCT FROM m.barrier_type THEN 'conflict_ir'
        WHEN m.classification = 'safe_update'
             AND m.core_access_meaning IS DISTINCT FROM m.access_meaning THEN 'conflict_ir'
        WHEN m.classification = 'safe_update'
             AND m.move_m IS NOT NULL AND m.move_m > 5 THEN 'conflict_ir'
        WHEN m.classification = 'safe_update'
             AND m.allowlist_unchanged THEN 'skip'
        WHEN m.classification = 'safe_update'
             AND m.core_barrier_type IS NOT DISTINCT FROM m.barrier_type
             AND m.core_access_meaning IS NOT DISTINCT FROM m.access_meaning
             AND coalesce(m.move_m, 0) <= 2 THEN 'update'
        WHEN m.classification = 'safe_new' THEN 'insert'
        WHEN m.classification = 'safe_update' THEN 'conflict_ir'
        ELSE 'fail'
    END,
    CASE
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL
            THEN 'identity already in core (rerun skip)'
        WHEN m.classification = 'safe_update' AND m.allowlist_unchanged
            THEN 'allowlist unchanged (idempotent rerun)'
        ELSE NULL
    END,
    CASE
        WHEN m.identity_key IS NULL THEN 'external_id has no OSM identity key'
        WHEN m.dup_identity THEN 'duplicate identity_key in batch'
        WHEN m.barrier_type IS NULL THEN 'barrier_type required'
        WHEN m.point_ready IS NULL
             OR NOT ST_IsValid(m.point_ready)
             OR ST_IsEmpty(m.point_ready)
             OR ST_SRID(m.point_ready) <> 4326
             OR GeometryType(m.point_ready) <> 'POINT' THEN 'invalid point geometry'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL
            THEN 'safe_update has no matching core identity'
        ELSE NULL
    END,
    CASE
        WHEN m.classification = 'safe_update' AND m.core_manual_protected
            THEN 'manual/dashboard protected — Import Review'
        WHEN m.classification = 'safe_update' AND m.core_is_verified
            THEN 'verified target — Import Review'
        WHEN m.dup_spatial_batch
            THEN 'duplicate-distance within batch (≤10 m) — Import Review'
        WHEN m.spatial_dup_core
            THEN 'duplicate-distance vs core (≤10 m, other identity) — Import Review'
        WHEN m.classification = 'safe_update'
             AND m.core_barrier_type IS DISTINCT FROM m.barrier_type
            THEN 'barrier_type change — Import Review'
        WHEN m.classification = 'safe_update'
             AND m.core_access_meaning IS DISTINCT FROM m.access_meaning
            THEN 'access meaning change — Import Review'
        WHEN m.classification = 'safe_update'
             AND m.move_m IS NOT NULL AND m.move_m > 5
            THEN 'substantial location movement (>5 m) — Import Review'
        WHEN m.classification = 'safe_update'
            THEN 'routing-impact or ambiguous update — Import Review'
        ELSE NULL
    END,
    m.matched_core_id,
    coalesce(m.core_is_verified, false),
    coalesce(m.core_manual_protected, false)
FROM matched AS m;

DO $$
DECLARE
    v_fail bigint; v_sample text;
    v_insert bigint; v_update bigint; v_skip bigint; v_conflict bigint; v_total bigint;
BEGIN
    SELECT count(*), min(fail_reason || ' [' || external_id || ']')
    INTO v_fail, v_sample
    FROM routing_barriers_loader_plan WHERE action = 'fail';

    SELECT
        count(*) FILTER (WHERE action = 'insert'),
        count(*) FILTER (WHERE action = 'update'),
        count(*) FILTER (WHERE action = 'skip'),
        count(*) FILTER (WHERE action = 'conflict_ir'),
        count(*)
    INTO v_insert, v_update, v_skip, v_conflict, v_total
    FROM routing_barriers_loader_plan;

    RAISE NOTICE 'routing_barriers_loader [45%%] plan ready total=% insert=% update=% skip=% conflict_ir=% fail=%',
        v_total, v_insert, v_update, v_skip, v_conflict, v_fail;

    IF v_fail > 0 THEN
        RAISE EXCEPTION 'routing_barriers loader: % failed row(s); sample: %', v_fail, v_sample;
    END IF;
END $$;

DROP TABLE IF EXISTS routing_barriers_loader_result;
CREATE TEMP TABLE routing_barriers_loader_result (
    inserted bigint NOT NULL DEFAULT 0,
    updated bigint NOT NULL DEFAULT 0,
    skipped bigint NOT NULL DEFAULT 0,
    failed bigint NOT NULL DEFAULT 0,
    conflict_ir bigint NOT NULL DEFAULT 0,
    ir_review_batch_id bigint,
    publish_batch_id bigint,
    core_before bigint,
    core_after bigint,
    duration_ms numeric
);

INSERT INTO routing_barriers_loader_result (skipped, failed, conflict_ir, core_before)
SELECT
    (SELECT count(*) FROM routing_barriers_loader_plan WHERE action = 'skip'),
    (SELECT count(*) FROM routing_barriers_loader_plan WHERE action = 'fail'),
    (SELECT count(*) FROM routing_barriers_loader_plan WHERE action = 'conflict_ir'),
    (SELECT count(*) FROM routing.routing_barriers WHERE coalesce(is_active, true));

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_inserted bigint;
    v_updated bigint;
    v_ir_batch bigint;
    v_conflict_n bigint;
    v_batch_code text;
    v_snap_ver text;
    v_snap_id bigint;
    v_region text;
BEGIN
    RAISE NOTICE 'routing_barriers_loader [50%%] insert start...';

    WITH ins AS (
        INSERT INTO routing.routing_barriers (
            barrier_type, core_street_id, geom, is_active,
            source_refs, normalized_data,
            is_verified, verification_status,
            verified_at, verified_by, verification_note,
            created_at, updated_at
        )
        SELECT
            w.barrier_type,
            coalesce(
                w.core_street_id,
                nearest.core_street_id
            ),
            w.point_ready,
            true,
            coalesce(w.source_refs, '{}'::jsonb) || jsonb_build_object(
                'external_id', w.external_id,
                'loader', 'import_work.routing_barriers_safe_loader',
                'access_tags', w.access_tags
            ),
            coalesce(w.normalized_data, '{}'::jsonb) || jsonb_build_object(
                'access_tags', w.access_tags,
                'loader', 'import_work.routing_barriers_safe_loader'
            ),
            false,
            'unverified',
            NULL, NULL, NULL,
            now(), now()
        FROM routing_barriers_loader_work AS w
        JOIN routing_barriers_loader_plan AS p ON p.work_id = w.id
        LEFT JOIN LATERAL (
            SELECT s.id AS core_street_id
            FROM core.core_streets AS s
            WHERE s.geom IS NOT NULL
              AND coalesce(s.is_active, true)
              AND s.deleted_at IS NULL
              AND s.geom && ST_Expand(w.point_ready, 30.0 / 111320.0)
            ORDER BY s.geom <-> w.point_ready
            LIMIT 1
        ) nearest ON true
        WHERE p.action = 'insert'
        RETURNING id
    )
    SELECT count(*) INTO v_inserted FROM ins;

    RAISE NOTICE 'routing_barriers_loader [70%%] inserted=%; updates starting...', v_inserted;

    -- Tight allowlist: source_refs + normalized_data only (no type/geom/access overwrite)
    WITH upd AS (
        UPDATE routing.routing_barriers AS c
        SET
            source_refs = coalesce(c.source_refs, '{}'::jsonb)
                || coalesce(w.source_refs, '{}'::jsonb)
                || jsonb_build_object(
                    'external_id', w.external_id,
                    'loader', 'import_work.routing_barriers_safe_loader',
                    'access_tags', w.access_tags
                ),
            normalized_data = coalesce(c.normalized_data, '{}'::jsonb)
                || coalesce(w.normalized_data, '{}'::jsonb)
                || jsonb_build_object(
                    'access_tags', w.access_tags,
                    'loader', 'import_work.routing_barriers_safe_loader'
                ),
            updated_at = now()
        FROM routing_barriers_loader_work AS w
        JOIN routing_barriers_loader_plan AS p ON p.work_id = w.id
        WHERE p.action = 'update'
          AND c.id = p.target_core_id
          AND coalesce(c.is_active, true)
          AND NOT coalesce(c.is_verified, false)
          AND lower(coalesce(c.verification_status, '')) <> 'verified'
        RETURNING c.id
    )
    SELECT count(*) INTO v_updated FROM upd;

    RAISE NOTICE 'routing_barriers_loader [80%%] updates=%; conflict IR upload...', coalesce(v_updated, 0);

    SELECT count(*) INTO v_conflict_n
    FROM routing_barriers_loader_plan WHERE action = 'conflict_ir';

    IF v_conflict_n > 0 THEN
        SELECT batch_code, source_snapshot_version, source_snapshot_id
        INTO v_batch_code, v_snap_ver, v_snap_id
        FROM routing_barriers_loader_batch;

        v_region := coalesce(
            (
                SELECT nullif(btrim(r.source_refs->>'region_code'), '')
                FROM routing_barriers_loader_work AS w
                JOIN routing_barriers_loader_plan AS p ON p.work_id = w.id
                JOIN import_work.routing_barrier_rows AS r ON r.id = w.id
                WHERE p.action = 'conflict_ir'
                LIMIT 1
            ),
            'UNKNOWN'
        );

        INSERT INTO import_review.review_batches (
            batch_name,
            source_snapshot_version,
            source_snapshot_id_local,
            region_code,
            entity_families,
            status,
            upload_mode,
            total_candidate_count,
            uploaded_candidate_count,
            summary
        ) VALUES (
            format(
                'safe_loader_routing_barrier_conflicts_%s_%s',
                v_batch_code,
                to_char(clock_timestamp(), 'YYYYMMDDHH24MISS')
            ),
            v_snap_ver,
            v_snap_id,
            v_region,
            ARRAY['routing_barriers']::text[],
            'uploaded',
            'safe_loader_conflict',
            v_conflict_n::int,
            v_conflict_n::int,
            jsonb_build_object(
                'loader', 'import_work.routing_barriers_safe_loader',
                'import_batch_code', v_batch_code,
                'conflict_count', v_conflict_n,
                'note', 'High-risk barrier changes diverted from direct core load'
            )
        )
        RETURNING id INTO v_ir_batch;

        INSERT INTO import_review.routing_barrier_candidates (
            review_batch_id,
            source_snapshot_version,
            source_snapshot_id_local,
            local_staging_id,
            entity_family,
            external_id,
            canonical_name,
            class_code,
            confidence_score,
            match_status,
            auto_action,
            review_status,
            review_decision,
            review_note,
            normalized_data,
            source_refs,
            matched_core_id,
            matched_core_table,
            barrier_type,
            point_geom,
            promotion_status
        )
        SELECT
            v_ir_batch,
            v_snap_ver,
            v_snap_id,
            coalesce(w.local_staging_id, w.id),
            'routing_barriers',
            w.external_id,
            w.barrier_type,
            w.barrier_type,
            coalesce(w.confidence_score, 60),
            'conflict',
            'needs_review',
            'needs_review',
            NULL,
            p.conflict_reason,
            coalesce(w.normalized_data, '{}'::jsonb) || jsonb_build_object(
                'access_tags', w.access_tags,
                'conflict_reason', p.conflict_reason,
                'loader', 'import_work.routing_barriers_safe_loader'
            ),
            coalesce(w.source_refs, '{}'::jsonb) || jsonb_build_object(
                'external_id', w.external_id,
                'conflict_reason', p.conflict_reason
            ),
            p.target_core_id,
            CASE WHEN p.target_core_id IS NOT NULL THEN 'routing.routing_barriers' ELSE NULL END,
            w.barrier_type,
            w.point_ready,
            'not_ready'
        FROM routing_barriers_loader_work AS w
        JOIN routing_barriers_loader_plan AS p ON p.work_id = w.id
        WHERE p.action = 'conflict_ir'
        ON CONFLICT (source_snapshot_version, entity_family, local_staging_id)
        DO UPDATE SET
            review_batch_id = EXCLUDED.review_batch_id,
            review_note = EXCLUDED.review_note,
            matched_core_id = EXCLUDED.matched_core_id,
            matched_core_table = EXCLUDED.matched_core_table,
            barrier_type = EXCLUDED.barrier_type,
            point_geom = EXCLUDED.point_geom,
            normalized_data = EXCLUDED.normalized_data,
            source_refs = EXCLUDED.source_refs,
            review_status = 'needs_review',
            updated_at = now();
    END IF;

    UPDATE routing_barriers_loader_result
    SET
        inserted = coalesce(v_inserted, 0),
        updated = coalesce(v_updated, 0),
        ir_review_batch_id = v_ir_batch,
        duration_ms = round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);

    RAISE NOTICE 'routing_barriers_loader [90%%] writes complete conflict_ir=% ir_batch=%',
        v_conflict_n, v_ir_batch;
END $$;

UPDATE routing_barriers_loader_result
SET core_after = (
    SELECT count(*) FROM routing.routing_barriers WHERE coalesce(is_active, true)
);

DO $$ BEGIN
    RAISE NOTICE 'routing_barriers_loader [95%%] writing publish batch + batch summary...';
END $$;

WITH pub AS (
    INSERT INTO system.system_publish_batches (
        batch_name, status, note, source_snapshot_version,
        total_item_count, success_count, failed_count, skipped_count,
        summary, published_at, promoted_at
    )
    SELECT
        format(
            'import_work_routing_barriers:%s:%s',
            b.batch_code,
            to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
        ),
        CASE WHEN p.dry_run THEN 'cancelled' ELSE 'promoted' END,
        CASE WHEN p.dry_run THEN 'dry_run (will roll back if wrapper rolls back)'
             ELSE 'import_work routing_barriers safe loader (no Valhalla rebuild)' END,
        b.source_snapshot_version,
        (SELECT count(*) FROM routing_barriers_loader_plan)::int,
        (SELECT (inserted + updated)::int FROM routing_barriers_loader_result),
        (SELECT failed::int FROM routing_barriers_loader_result),
        (SELECT (skipped + conflict_ir)::int FROM routing_barriers_loader_result),
        jsonb_build_object(
            'loader', 'import_work.routing_barriers_safe_loader',
            'import_batch_id', b.import_batch_id,
            'batch_code', b.batch_code,
            'entity_family', 'routing_barriers',
            'dry_run', p.dry_run,
            'valhalla_rebuilt', false,
            'allowlist', jsonb_build_array('source_refs', 'normalized_data'),
            'counts', (SELECT to_jsonb(r) - 'publish_batch_id' FROM routing_barriers_loader_result r),
            'skip_reasons', (
                SELECT coalesce(jsonb_object_agg(skip_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT skip_reason, count(*) AS cnt
                    FROM routing_barriers_loader_plan
                    WHERE action = 'skip' AND skip_reason IS NOT NULL
                    GROUP BY skip_reason
                ) s
            ),
            'conflict_reasons', (
                SELECT coalesce(jsonb_object_agg(conflict_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT conflict_reason, count(*) AS cnt
                    FROM routing_barriers_loader_plan
                    WHERE action = 'conflict_ir' AND conflict_reason IS NOT NULL
                    GROUP BY conflict_reason
                ) s
            )
        ),
        CASE WHEN p.dry_run THEN NULL ELSE now() END,
        CASE WHEN p.dry_run THEN NULL ELSE now() END
    FROM routing_barriers_loader_batch AS b
    CROSS JOIN routing_barriers_loader_params AS p
    RETURNING id
)
UPDATE routing_barriers_loader_result
SET publish_batch_id = (SELECT id FROM pub);

UPDATE import_work.import_batches AS b
SET
    status = CASE WHEN (SELECT dry_run FROM routing_barriers_loader_params) THEN b.status ELSE 'applied' END,
    validation_status = CASE
        WHEN (SELECT dry_run FROM routing_barriers_loader_params) THEN b.validation_status
        ELSE 'passed'
    END,
    validation_summary = coalesce(b.validation_summary, '{}'::jsonb) || jsonb_build_object(
        'routing_barriers_safe_loader', (SELECT to_jsonb(r) FROM routing_barriers_loader_result r),
        'dry_run', (SELECT dry_run FROM routing_barriers_loader_params),
        'ran_at', now()
    ),
    updated_at = now()
FROM routing_barriers_loader_batch AS lb
WHERE b.id = lb.import_batch_id;

DO $$
DECLARE
    r routing_barriers_loader_result%ROWTYPE;
    v_dry boolean;
BEGIN
    SELECT * INTO r FROM routing_barriers_loader_result;
    SELECT dry_run INTO v_dry FROM routing_barriers_loader_params;
    RAISE NOTICE 'routing_barriers_loader [100%%] done dry_run=% inserted=% updated=% skipped=% conflict_ir=% failed=% core_before=% core_after=% delta=% ir_batch=% duration_ms=%',
        v_dry, r.inserted, r.updated, r.skipped, r.conflict_ir, r.failed,
        r.core_before, r.core_after, (r.core_after - r.core_before),
        r.ir_review_batch_id, r.duration_ms;
END $$;

SELECT
    'routing_barriers_safe_loader_result' AS section,
    p.dry_run,
    b.batch_code,
    r.inserted,
    r.updated,
    r.skipped,
    r.conflict_ir,
    r.failed,
    r.ir_review_batch_id,
    r.publish_batch_id,
    r.core_before,
    r.core_after,
    (r.core_after - r.core_before) AS core_delta,
    r.duration_ms
FROM routing_barriers_loader_result AS r
CROSS JOIN routing_barriers_loader_params AS p
CROSS JOIN routing_barriers_loader_batch AS b;

SELECT
    'routing_barriers_safe_loader_plan' AS section,
    action,
    count(*) AS n,
    min(skip_reason) FILTER (WHERE skip_reason IS NOT NULL) AS sample_skip,
    min(conflict_reason) FILTER (WHERE conflict_reason IS NOT NULL) AS sample_conflict,
    min(fail_reason) FILTER (WHERE fail_reason IS NOT NULL) AS sample_fail
FROM routing_barriers_loader_plan
GROUP BY action
ORDER BY action;
