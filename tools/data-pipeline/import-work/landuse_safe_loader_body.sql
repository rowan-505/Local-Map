-- =============================================================================
-- Landuse set-based safe loader — body (no BEGIN/COMMIT).
-- Requires temp params: landuse_loader_params(batch_code, dry_run, sample_limit)
-- Writes only safe_new/safe_update. Never pmtiles_only.
-- Allowlist: name, geom, centroid, area_m2, landuse_class_id, class_code,
--   admin_area_id, confidence_score, normalized_data, source_refs, source_tags,
--   detail_level, crop_code, landuse_names
-- Protection: manual_override OR source_refs dashboard/manual; verified skip.
-- Names: core.core_map_landuse_names primary official en/my (+ und).
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('pg_temp.landuse_loader_params') IS NULL THEN
        RAISE EXCEPTION 'landuse loader body: landuse_loader_params missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM landuse_loader_params WHERE batch_code IS NOT NULL) THEN
        RAISE EXCEPTION 'landuse loader: batch_code is required';
    END IF;
    IF to_regclass('import_work.landuse_rows') IS NULL THEN
        RAISE EXCEPTION 'landuse loader: import_work.landuse_rows missing — apply migration 142';
    END IF;
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'landuse loader: system.pipeline_osm_identity_key missing — apply migration 137';
    END IF;
END $$;

DROP TABLE IF EXISTS landuse_loader_batch;
CREATE TEMP TABLE landuse_loader_batch (
    import_batch_id bigint PRIMARY KEY,
    batch_code text NOT NULL,
    source_snapshot_id bigint,
    source_snapshot_version text NOT NULL,
    status text NOT NULL,
    expected_row_count bigint,
    loaded_row_count bigint
) ON COMMIT DROP;

INSERT INTO landuse_loader_batch
SELECT b.id, b.batch_code, b.source_snapshot_id, b.source_snapshot_version,
       b.status, b.expected_row_count, b.loaded_row_count
FROM import_work.import_batches AS b
JOIN landuse_loader_params AS p ON p.batch_code = b.batch_code
WHERE b.entity_family = 'landuse';

DO $$
DECLARE
    b landuse_loader_batch%ROWTYPE;
    v_actual bigint; v_safe_new bigint; v_safe_update bigint; v_other bigint; v_pmtiles bigint;
    v_dry boolean; v_start timestamptz := clock_timestamp();
BEGIN
    SELECT * INTO b FROM landuse_loader_batch;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'landuse loader: batch not found or not entity_family=landuse';
    END IF;
    SELECT dry_run INTO v_dry FROM landuse_loader_params;
    IF b.status NOT IN ('loaded', 'validated', 'applied', 'failed') THEN
        RAISE EXCEPTION 'landuse loader: batch status % not loadable', b.status;
    END IF;
    IF b.source_snapshot_id IS NULL OR nullif(btrim(b.source_snapshot_version), '') IS NULL THEN
        RAISE EXCEPTION 'landuse loader: batch missing snapshot identity';
    END IF;
    SELECT count(*),
           count(*) FILTER (WHERE r.classification = 'safe_new'),
           count(*) FILTER (WHERE r.classification = 'safe_update'),
           count(*) FILTER (WHERE r.classification NOT IN ('safe_new', 'safe_update')),
           count(*) FILTER (WHERE r.classification = 'pmtiles_only')
    INTO v_actual, v_safe_new, v_safe_update, v_other, v_pmtiles
    FROM import_work.landuse_rows AS r WHERE r.import_batch_id = b.import_batch_id;
    IF v_pmtiles > 0 THEN
        RAISE EXCEPTION 'landuse loader: % pmtiles_only row(s) in work table — refuse', v_pmtiles;
    END IF;
    IF b.loaded_row_count IS NOT NULL AND b.loaded_row_count <> v_actual THEN
        RAISE EXCEPTION 'landuse loader: loaded_row_count (%) <> actual (%)', b.loaded_row_count, v_actual;
    END IF;
    IF b.expected_row_count IS NOT NULL AND b.expected_row_count <> v_actual THEN
        RAISE EXCEPTION 'landuse loader: expected_row_count (%) <> actual (%)', b.expected_row_count, v_actual;
    END IF;
    IF EXISTS (
        SELECT 1 FROM import_work.landuse_rows AS r
        WHERE r.import_batch_id = b.import_batch_id
          AND r.source_snapshot_version IS DISTINCT FROM b.source_snapshot_version
    ) THEN
        RAISE EXCEPTION 'landuse loader: work-row snapshot_version mismatch vs batch';
    END IF;
    RAISE NOTICE 'landuse_loader [5%%] precheck ok batch=% dry_run=% actual=% safe_new=% safe_update=% other_ignored=% elapsed_ms=%',
        b.batch_code, v_dry, v_actual, v_safe_new, v_safe_update, v_other,
        round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);
END $$;

DROP TABLE IF EXISTS landuse_loader_work;
CREATE TEMP TABLE landuse_loader_work AS
SELECT
    r.id,
    r.external_id,
    r.classification,
    r.target_core_id,
    system.pipeline_osm_identity_key(r.external_id) AS identity_key,
    nullif(btrim(coalesce(r.name, r.name_en, r.name_mm, '')), '') AS name_ready,
    nullif(btrim(coalesce(r.name_en, '')), '') AS name_en_ready,
    nullif(btrim(coalesce(r.name_mm, '')), '') AS name_mm_ready,
    r.landuse_class_id,
    nullif(btrim(coalesce(r.class_code, '')), '') AS class_code,
    r.admin_area_id,
    CASE
        WHEN r.geom IS NULL THEN NULL::geometry(MultiPolygon, 4326)
        WHEN GeometryType(ST_MakeValid(r.geom)) IN ('POLYGON', 'MULTIPOLYGON')
            THEN ST_Multi(ST_CollectionExtract(ST_MakeValid(r.geom), 3))::geometry(MultiPolygon, 4326)
        ELSE NULL::geometry(MultiPolygon, 4326)
    END AS geom_ready,
    coalesce(
        r.centroid,
        CASE
            WHEN r.geom IS NOT NULL AND ST_IsValid(ST_MakeValid(r.geom))
                THEN ST_PointOnSurface(ST_MakeValid(r.geom))::geometry(Point, 4326)
            ELSE NULL
        END
    ) AS centroid,
    coalesce(r.area_m2, CASE WHEN r.geom IS NOT NULL THEN ST_Area(r.geom::geography)::numeric END) AS area_m2,
    r.confidence_score,
    coalesce(r.source_tags, '{}'::jsonb) AS source_tags,
    coalesce(r.source_refs, '{}'::jsonb) AS source_refs,
    coalesce(r.normalized_data, '{}'::jsonb) AS normalized_data,
    r.core_selection_reason,
    coalesce(nullif(btrim(r.detail_level), ''), 'zone') AS detail_level,
    r.crop_code
FROM import_work.landuse_rows AS r
JOIN landuse_loader_batch AS b ON b.import_batch_id = r.import_batch_id
WHERE r.classification IN ('safe_new', 'safe_update')
ORDER BY r.id
LIMIT greatest(
    (SELECT sample_limit FROM landuse_loader_params),
    CASE WHEN (SELECT sample_limit FROM landuse_loader_params) = 0 THEN 1000000000 ELSE 0 END
);

CREATE INDEX ON landuse_loader_work (id);
CREATE INDEX ON landuse_loader_work (identity_key);

DO $$ BEGIN RAISE NOTICE 'landuse_loader [15%%] work rows ready n=%', (SELECT count(*) FROM landuse_loader_work); END $$;

UPDATE import_work.landuse_rows AS r
SET validation_status = 'ready',
    validation_result = jsonb_build_object('identity_key', w.identity_key, 'geom_ok', w.geom_ready IS NOT NULL)
FROM landuse_loader_work AS w
WHERE r.id = w.id;

DROP TABLE IF EXISTS landuse_loader_core_by_identity;
CREATE TEMP TABLE landuse_loader_core_by_identity AS
SELECT c.id, system.pipeline_osm_identity_key(c.external_id) AS identity_key,
       c.name, c.landuse_class_id, c.class_code, c.admin_area_id, c.geom,
       c.is_verified, c.verification_status, c.source_refs, c.manual_override
FROM core.core_map_landuse AS c
WHERE c.deleted_at IS NULL AND coalesce(c.is_active, true)
  AND c.external_id IS NOT NULL
  AND system.pipeline_osm_identity_key(c.external_id) IS NOT NULL;
CREATE INDEX ON landuse_loader_core_by_identity (identity_key);

DROP TABLE IF EXISTS landuse_loader_core_by_id;
CREATE TEMP TABLE landuse_loader_core_by_id AS
SELECT c.id, c.name, c.landuse_class_id, c.class_code, c.admin_area_id, c.geom,
       c.is_verified, c.verification_status, c.source_refs, c.manual_override
FROM core.core_map_landuse AS c
WHERE c.deleted_at IS NULL AND coalesce(c.is_active, true);
CREATE INDEX ON landuse_loader_core_by_id (id);

DO $$ BEGIN RAISE NOTICE 'landuse_loader [30%%] building plan (match + classify)...'; END $$;

DROP TABLE IF EXISTS landuse_loader_plan;
CREATE TEMP TABLE landuse_loader_plan (
    work_id bigint PRIMARY KEY,
    classification text NOT NULL,
    identity_key text,
    external_id text NOT NULL,
    action text NOT NULL,
    skip_reason text,
    fail_reason text,
    target_core_id bigint,
    core_is_verified boolean,
    core_manual_protected boolean
);

WITH dup AS (
    SELECT identity_key FROM landuse_loader_work
    WHERE identity_key IS NOT NULL GROUP BY identity_key HAVING count(*) > 1
),
matched AS (
    SELECT
        w.id AS work_id, w.classification, w.identity_key, w.external_id,
        w.name_ready, w.landuse_class_id, w.class_code, w.geom_ready, w.centroid, w.area_m2,
        w.admin_area_id, w.detail_level,
        coalesce(c_by_id.id, c_by_key.id) AS matched_core_id,
        coalesce(c_by_id.is_verified, c_by_key.is_verified, false)
            OR lower(coalesce(c_by_id.verification_status, c_by_key.verification_status, '')) = 'verified'
            AS core_is_verified,
        (
            coalesce(c_by_id.manual_override, c_by_key.manual_override, false)
            OR (
            coalesce((coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'manual_override') IN ('true', 't', '1'), false)
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"dashboard"}'::jsonb
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"manual"}'::jsonb
            OR coalesce(coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'source', '') ILIKE '%manual%'
            OR coalesce(coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'source', '') ILIKE '%dashboard%'
        )
        ) AS core_manual_protected,
        EXISTS (
            SELECT 1 FROM ref.ref_landuse_classes lc
            WHERE lc.id = w.landuse_class_id AND coalesce(lc.is_active, true)
        ) AS type_ok,
        EXISTS (SELECT 1 FROM dup d WHERE d.identity_key = w.identity_key) AS dup_identity,
        (
            coalesce(c_by_id.id, c_by_key.id) IS NOT NULL
            AND coalesce(c_by_id.name, c_by_key.name) IS NOT DISTINCT FROM w.name_ready
            AND coalesce(c_by_id.landuse_class_id, c_by_key.landuse_class_id) IS NOT DISTINCT FROM w.landuse_class_id
            AND coalesce(c_by_id.class_code, c_by_key.class_code) IS NOT DISTINCT FROM w.class_code
            AND coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) IS NOT DISTINCT FROM w.admin_area_id
            AND w.geom_ready IS NOT NULL AND coalesce(c_by_id.geom, c_by_key.geom) IS NOT NULL
            AND ST_Equals(coalesce(c_by_id.geom, c_by_key.geom), w.geom_ready)
        ) AS allowlist_unchanged
    FROM landuse_loader_work AS w
    LEFT JOIN landuse_loader_core_by_id AS c_by_id
        ON w.target_core_id IS NOT NULL AND c_by_id.id = w.target_core_id
    LEFT JOIN landuse_loader_core_by_identity AS c_by_key
        ON w.identity_key IS NOT NULL AND c_by_key.identity_key = w.identity_key AND c_by_id.id IS NULL
)
INSERT INTO landuse_loader_plan (
    work_id, classification, identity_key, external_id, action,
    skip_reason, fail_reason, target_core_id, core_is_verified, core_manual_protected
)
SELECT
    m.work_id, m.classification, m.identity_key, m.external_id,
    CASE
        WHEN m.identity_key IS NULL THEN 'fail'
        WHEN m.dup_identity THEN 'fail'
        WHEN m.name_ready IS NULL THEN 'fail'
        WHEN m.landuse_class_id IS NULL OR NOT m.type_ok THEN 'fail'
        WHEN m.class_code IS NULL THEN 'fail'
        WHEN m.geom_ready IS NULL OR NOT ST_IsValid(m.geom_ready) OR ST_IsEmpty(m.geom_ready)
             OR ST_SRID(m.geom_ready) <> 4326 THEN 'fail'
        WHEN m.centroid IS NULL OR NOT ST_IsValid(m.centroid) OR ST_SRID(m.centroid) <> 4326 THEN 'fail'
        WHEN m.area_m2 IS NULL OR m.area_m2 <= 0 THEN 'fail'
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL THEN 'skip'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL THEN 'fail'
        WHEN m.classification = 'safe_update' AND m.core_manual_protected THEN 'skip'
        WHEN m.classification = 'safe_update' AND m.core_is_verified THEN 'skip'
        WHEN m.classification = 'safe_update' AND m.allowlist_unchanged THEN 'skip'
        WHEN m.classification = 'safe_new' THEN 'insert'
        WHEN m.classification = 'safe_update' THEN 'update'
        ELSE 'fail'
    END,
    CASE
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL THEN 'identity already in core (rerun skip)'
        WHEN m.classification = 'safe_update' AND m.core_manual_protected THEN 'manual/dashboard protected'
        WHEN m.classification = 'safe_update' AND m.core_is_verified THEN 'verified row — skip meaningful overwrite'
        WHEN m.classification = 'safe_update' AND m.allowlist_unchanged THEN 'allowlist unchanged (idempotent rerun)'
        ELSE NULL
    END,
    CASE
        WHEN m.identity_key IS NULL THEN 'external_id has no OSM identity key'
        WHEN m.dup_identity THEN 'duplicate identity_key in batch'
        WHEN m.name_ready IS NULL THEN 'name required'
        WHEN m.landuse_class_id IS NULL OR NOT m.type_ok THEN 'missing or inactive landuse_class_id'
        WHEN m.class_code IS NULL THEN 'class_code required'
        WHEN m.geom_ready IS NULL OR NOT ST_IsValid(m.geom_ready) OR ST_IsEmpty(m.geom_ready)
             OR ST_SRID(m.geom_ready) <> 4326 THEN 'invalid geometry'
        WHEN m.centroid IS NULL OR NOT ST_IsValid(m.centroid) OR ST_SRID(m.centroid) <> 4326 THEN 'invalid centroid'
        WHEN m.area_m2 IS NULL OR m.area_m2 <= 0 THEN 'invalid area_m2'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL THEN 'safe_update has no matching core identity'
        ELSE NULL
    END,
    m.matched_core_id,
    coalesce(m.core_is_verified, false),
    coalesce(m.core_manual_protected, false)
FROM matched AS m;

DO $$
DECLARE
    v_fail bigint; v_sample text; v_insert bigint; v_update bigint; v_skip bigint; v_total bigint;
BEGIN
    SELECT count(*), min(fail_reason || ' [' || external_id || ']')
    INTO v_fail, v_sample FROM landuse_loader_plan WHERE action = 'fail';
    SELECT count(*) FILTER (WHERE action = 'insert'),
           count(*) FILTER (WHERE action = 'update'),
           count(*) FILTER (WHERE action = 'skip'),
           count(*)
    INTO v_insert, v_update, v_skip, v_total FROM landuse_loader_plan;
    RAISE NOTICE 'landuse_loader [45%%] plan ready total=% insert=% update=% skip=% fail=%',
        v_total, v_insert, v_update, v_skip, v_fail;
    IF v_fail > 0 THEN
        RAISE EXCEPTION 'landuse loader: % failed row(s); sample: %', v_fail, v_sample;
    END IF;
END $$;

DROP TABLE IF EXISTS landuse_loader_result;
CREATE TEMP TABLE landuse_loader_result (
    inserted bigint NOT NULL DEFAULT 0,
    updated bigint NOT NULL DEFAULT 0,
    skipped bigint NOT NULL DEFAULT 0,
    failed bigint NOT NULL DEFAULT 0,
    names_written bigint NOT NULL DEFAULT 0,
    publish_batch_id bigint,
    core_before bigint,
    core_after bigint,
    duration_ms numeric
);

INSERT INTO landuse_loader_result (skipped, failed, core_before)
SELECT
    (SELECT count(*) FROM landuse_loader_plan WHERE action = 'skip'),
    (SELECT count(*) FROM landuse_loader_plan WHERE action = 'fail'),
    (SELECT count(*) FROM core.core_map_landuse WHERE deleted_at IS NULL AND coalesce(is_active, true));

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_total bigint; v_done bigint := 0; v_chunk_n bigint; v_chunk_size int := 200;
    v_pct int; v_ids bigint[]; v_names bigint := 0;
BEGIN
    SELECT count(*) INTO v_total FROM landuse_loader_plan WHERE action = 'insert';
    RAISE NOTICE 'landuse_loader [50%%] insert start total=% chunk=%', v_total, v_chunk_size;
    IF v_total = 0 THEN
        RAISE NOTICE 'landuse_loader [70%%] insert skipped (0 rows)';
    ELSE
        LOOP
            SELECT coalesce(array_agg(work_id ORDER BY work_id), ARRAY[]::bigint[]) INTO v_ids
            FROM (
                SELECT work_id FROM landuse_loader_plan WHERE action = 'insert'
                ORDER BY work_id OFFSET v_done LIMIT v_chunk_size
            ) s;
            EXIT WHEN coalesce(array_length(v_ids, 1), 0) = 0;

            WITH ins AS (
                INSERT INTO core.core_map_landuse (
                    external_id, name, class_code, landuse_class_id, admin_area_id,
                    geom, centroid, area_m2, confidence_score, manual_override,
                    source_tags, normalized_data, source_refs,
                    crop_code, detail_level,
                    verification_status, is_verified, is_active,
                    created_at, updated_at, deleted_at
                )
                SELECT
                    w.external_id, w.name_ready, w.class_code, w.landuse_class_id, w.admin_area_id,
                    w.geom_ready, w.centroid, round(w.area_m2::numeric, 2),
                    coalesce(w.confidence_score, 80), false,
                    w.source_tags,
                    coalesce(w.normalized_data, '{}'::jsonb) || jsonb_build_object(
                        'core_selection_reason', w.core_selection_reason,
                        'loader', 'import_work.landuse_safe_loader'
                    ),
                    w.source_refs,
                    w.crop_code, w.detail_level,
                    'unverified', false, true, now(), now(), NULL::timestamptz
                FROM landuse_loader_work AS w
                JOIN landuse_loader_plan AS p ON p.work_id = w.id
                WHERE p.action = 'insert' AND w.id = ANY (v_ids)
                RETURNING id, external_id
            ),
            name_src AS (
                SELECT i.id AS entity_id, w.name_en_ready, w.name_mm_ready, w.name_ready
                FROM ins AS i
                JOIN landuse_loader_work AS w
                  ON system.pipeline_osm_identity_key(w.external_id)
                   = system.pipeline_osm_identity_key(i.external_id)
            ),
            
            del_names AS (
                DELETE FROM core.core_map_landuse_names AS n
                USING name_src AS s
                WHERE n.landuse_id = s.entity_id
                  AND n.name_type = 'official'
                  AND n.is_primary IS TRUE
                  AND (
                        (s.name_en_ready IS NOT NULL AND n.language_code = 'en')
                     OR (s.name_mm_ready IS NOT NULL AND n.language_code IN ('mm', 'my'))
                     OR (
                            s.name_en_ready IS NULL
                        AND s.name_mm_ready IS NULL
                        AND s.name_ready IS NOT NULL
                        AND n.language_code = 'und'
                     )
                  )
                RETURNING n.id
            ),
            
            ins_en AS (
                INSERT INTO core.core_map_landuse_names (
                    landuse_id, name, language_code, script_code,
                    name_type, is_primary, search_weight
                )
                SELECT entity_id, name_en_ready, 'en', 'LATN', 'official', true,
                       CASE WHEN name_mm_ready IS NULL THEN 100 ELSE 90 END
                FROM name_src WHERE name_en_ready IS NOT NULL
                RETURNING id
            ),
            ins_mm AS (
                INSERT INTO core.core_map_landuse_names (
                    landuse_id, name, language_code, script_code,
                    name_type, is_primary, search_weight
                )
                SELECT entity_id, name_mm_ready, 'my', 'MYMR', 'official', true, 100
                FROM name_src WHERE name_mm_ready IS NOT NULL
                RETURNING id
            ),
            ins_und AS (
                INSERT INTO core.core_map_landuse_names (
                    landuse_id, name, language_code, script_code,
                    name_type, is_primary, search_weight
                )
                SELECT entity_id, name_ready, 'und', NULL, 'official', true, 80
                FROM name_src
                WHERE name_en_ready IS NULL AND name_mm_ready IS NULL AND name_ready IS NOT NULL
                RETURNING id
            )
            SELECT (SELECT count(*) FROM ins),
                   (SELECT count(*) FROM ins_en)+(SELECT count(*) FROM ins_mm)+(SELECT count(*) FROM ins_und)
            INTO v_chunk_n, v_names;

            UPDATE landuse_loader_result SET names_written = names_written + coalesce(v_names, 0);
            v_done := v_done + coalesce(v_chunk_n, 0);
            UPDATE landuse_loader_result SET inserted = v_done;
            v_pct := least(70, 50 + ((v_done * 20) / greatest(v_total, 1))::int);
            RAISE NOTICE 'landuse_loader [% %%] insert progress %/% (+%)', v_pct, v_done, v_total, coalesce(v_chunk_n, 0);
            EXIT WHEN v_done >= v_total;
        END LOOP;
    END IF;

    RAISE NOTICE 'landuse_loader [75%%] updates starting...';

    WITH upd AS (
        UPDATE core.core_map_landuse AS c
        SET
            name = w.name_ready,
            class_code = w.class_code,
            landuse_class_id = w.landuse_class_id,
            admin_area_id = w.admin_area_id,
            geom = w.geom_ready,
            centroid = w.centroid,
            area_m2 = round(w.area_m2::numeric, 2),
            confidence_score = coalesce(w.confidence_score, c.confidence_score),
            source_tags = coalesce(w.source_tags, c.source_tags),
            detail_level = coalesce(w.detail_level, c.detail_level),
            crop_code = coalesce(w.crop_code, c.crop_code),
            normalized_data = coalesce(c.normalized_data, '{}'::jsonb)
                || coalesce(w.normalized_data, '{}'::jsonb)
                || jsonb_build_object('loader', 'import_work.landuse_safe_loader'),
            source_refs = coalesce(w.source_refs, c.source_refs),
            updated_at = now()
        FROM landuse_loader_work AS w
        JOIN landuse_loader_plan AS p ON p.work_id = w.id
        WHERE p.action = 'update'
          AND c.id = p.target_core_id
          AND c.deleted_at IS NULL AND coalesce(c.is_active, true)
          AND NOT coalesce(c.is_verified, false)
          AND lower(coalesce(c.verification_status, '')) <> 'verified'
          AND NOT coalesce(c.manual_override, false)
          AND NOT (
                coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
                OR c.source_refs @> '{"source":"dashboard"}'::jsonb
                OR c.source_refs @> '{"source":"manual"}'::jsonb
                OR coalesce(c.source_refs->>'source', '') ILIKE '%manual%'
                OR coalesce(c.source_refs->>'source', '') ILIKE '%dashboard%'
          )
        RETURNING c.id, w.name_en_ready, w.name_mm_ready, w.name_ready
    ),
    
    del_names AS (
        DELETE FROM core.core_map_landuse_names AS n
        USING upd AS u
        WHERE n.landuse_id = u.id
          AND n.name_type = 'official'
          AND n.is_primary IS TRUE
          AND (
                (u.name_en_ready IS NOT NULL AND n.language_code = 'en')
             OR (u.name_mm_ready IS NOT NULL AND n.language_code IN ('mm', 'my'))
             OR (
                    u.name_en_ready IS NULL
                AND u.name_mm_ready IS NULL
                AND u.name_ready IS NOT NULL
                AND n.language_code = 'und'
             )
          )
        RETURNING n.id
    ),
    
    ins_en AS (
        INSERT INTO core.core_map_landuse_names (
            landuse_id, name, language_code, script_code,
            name_type, is_primary, search_weight
        )
        SELECT id, name_en_ready, 'en', 'LATN', 'official', true,
               CASE WHEN name_mm_ready IS NULL THEN 100 ELSE 90 END
        FROM upd WHERE name_en_ready IS NOT NULL
        RETURNING id
    ),
    ins_mm AS (
        INSERT INTO core.core_map_landuse_names (
            landuse_id, name, language_code, script_code,
            name_type, is_primary, search_weight
        )
        SELECT id, name_mm_ready, 'my', 'MYMR', 'official', true, 100
        FROM upd WHERE name_mm_ready IS NOT NULL
        RETURNING id
    ),
    ins_und AS (
        INSERT INTO core.core_map_landuse_names (
            landuse_id, name, language_code, script_code,
            name_type, is_primary, search_weight
        )
        SELECT id, name_ready, 'und', NULL, 'official', true, 80
        FROM upd
        WHERE name_en_ready IS NULL AND name_mm_ready IS NULL AND name_ready IS NOT NULL
        RETURNING id
    )
    UPDATE landuse_loader_result
    SET updated = (SELECT count(*) FROM upd),
        names_written = names_written
            + (SELECT count(*) FROM ins_en) + (SELECT count(*) FROM ins_mm) + (SELECT count(*) FROM ins_und),
        duration_ms = round((extract(epoch FROM (clock_timestamp() - v_start)) * 1000.0)::numeric, 2);

    RAISE NOTICE 'landuse_loader [90%%] updates complete';
END $$;

UPDATE landuse_loader_result SET core_after = (
    SELECT count(*) FROM core.core_map_landuse WHERE deleted_at IS NULL AND coalesce(is_active, true)
);

DO $$ BEGIN RAISE NOTICE 'landuse_loader [95%%] writing publish batch + batch summary...'; END $$;

WITH pub AS (
    INSERT INTO system.system_publish_batches (
        batch_name, status, note, source_snapshot_version,
        total_item_count, success_count, failed_count, skipped_count,
        summary, published_at, promoted_at
    )
    SELECT
        format('import_work_landuse:%s:%s', b.batch_code, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')),
        CASE WHEN p.dry_run THEN 'cancelled' ELSE 'promoted' END,
        CASE WHEN p.dry_run THEN 'dry_run (will roll back if wrapper rolls back)'
             ELSE 'import_work landuse safe loader' END,
        b.source_snapshot_version,
        (SELECT count(*) FROM landuse_loader_plan)::int,
        (SELECT (inserted + updated)::int FROM landuse_loader_result),
        (SELECT failed::int FROM landuse_loader_result),
        (SELECT skipped::int FROM landuse_loader_result),
        jsonb_build_object(
            'loader', 'import_work.landuse_safe_loader',
            'import_batch_id', b.import_batch_id,
            'batch_code', b.batch_code,
            'entity_family', 'landuse',
            'dry_run', p.dry_run,
            'allowlist', jsonb_build_array(
                'name','geom','centroid','area_m2','landuse_class_id','class_code',
                'admin_area_id','confidence_score','normalized_data','source_refs',
                'source_tags','detail_level','crop_code','landuse_names'
            ),
            'counts', (SELECT to_jsonb(r) - 'publish_batch_id' FROM landuse_loader_result r),
            'skip_reasons', (
                SELECT coalesce(jsonb_object_agg(skip_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT skip_reason, count(*) AS cnt FROM landuse_loader_plan
                    WHERE action = 'skip' AND skip_reason IS NOT NULL GROUP BY skip_reason
                ) s
            )
        ),
        CASE WHEN p.dry_run THEN NULL ELSE now() END,
        CASE WHEN p.dry_run THEN NULL ELSE now() END
    FROM landuse_loader_batch AS b
    CROSS JOIN landuse_loader_params AS p
    RETURNING id
)
UPDATE landuse_loader_result SET publish_batch_id = (SELECT id FROM pub);

UPDATE import_work.import_batches AS b
SET
    status = CASE WHEN (SELECT dry_run FROM landuse_loader_params) THEN b.status ELSE 'applied' END,
    validation_status = CASE WHEN (SELECT dry_run FROM landuse_loader_params) THEN b.validation_status ELSE 'passed' END,
    validation_summary = coalesce(b.validation_summary, '{}'::jsonb) || jsonb_build_object(
        'landuse_safe_loader', (SELECT to_jsonb(r) FROM landuse_loader_result r),
        'dry_run', (SELECT dry_run FROM landuse_loader_params),
        'ran_at', now()
    ),
    updated_at = now()
FROM landuse_loader_batch AS lb
WHERE b.id = lb.import_batch_id;

DO $$
DECLARE r landuse_loader_result%ROWTYPE; v_dry boolean;
BEGIN
    SELECT * INTO r FROM landuse_loader_result;
    SELECT dry_run INTO v_dry FROM landuse_loader_params;
    RAISE NOTICE 'landuse_loader [100%%] done dry_run=% inserted=% updated=% skipped=% failed=% names=% core_before=% core_after=% delta=% duration_ms=%',
        v_dry, r.inserted, r.updated, r.skipped, r.failed, r.names_written,
        r.core_before, r.core_after, (r.core_after - r.core_before), r.duration_ms;
END $$;

SELECT 'landuse_safe_loader_result' AS section, p.dry_run, b.batch_code,
       r.inserted, r.updated, r.skipped, r.failed, r.names_written, r.publish_batch_id,
       r.core_before, r.core_after, (r.core_after - r.core_before) AS core_delta, r.duration_ms
FROM landuse_loader_result AS r
CROSS JOIN landuse_loader_params AS p
CROSS JOIN landuse_loader_batch AS b;

SELECT 'landuse_safe_loader_plan' AS section, action, count(*) AS n,
       min(skip_reason) FILTER (WHERE skip_reason IS NOT NULL) AS sample_skip,
       min(fail_reason) FILTER (WHERE fail_reason IS NOT NULL) AS sample_fail
FROM landuse_loader_plan GROUP BY action ORDER BY action;
