-- =============================================================================
-- Places set-based safe loader — body (no BEGIN/COMMIT).
-- Requires temp params table places_loader_params(batch_code text, dry_run boolean)
-- Prefer places_safe_loader.sql wrapper for normal runs.
--
-- Progress: RAISE NOTICE with stage + percent so runners can stream live status.
-- Matching uses indexed identity-key joins (not per-row LATERAL over core).
-- =============================================================================

DO $$
BEGIN
    IF to_regclass('pg_temp.places_loader_params') IS NULL THEN
        RAISE EXCEPTION 'places loader body: places_loader_params missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM places_loader_params WHERE batch_code IS NOT NULL) THEN
        RAISE EXCEPTION 'places loader: batch_code is required';
    END IF;
    IF to_regclass('import_work.place_rows') IS NULL THEN
        RAISE EXCEPTION 'places loader: import_work.place_rows missing';
    END IF;
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'places loader: system.pipeline_osm_identity_key missing — apply migration 137';
    END IF;
END $$;

DROP TABLE IF EXISTS places_loader_batch;
CREATE TEMP TABLE places_loader_batch (
    import_batch_id bigint PRIMARY KEY,
    batch_code text NOT NULL,
    source_snapshot_id bigint,
    source_snapshot_version text NOT NULL,
    status text NOT NULL,
    expected_row_count bigint,
    loaded_row_count bigint
) ON COMMIT DROP;

INSERT INTO places_loader_batch
SELECT
    b.id,
    b.batch_code,
    b.source_snapshot_id,
    b.source_snapshot_version,
    b.status,
    b.expected_row_count,
    b.loaded_row_count
FROM import_work.import_batches AS b
JOIN places_loader_params AS p ON p.batch_code = b.batch_code
WHERE b.entity_family = 'places';

DO $$
DECLARE
    b places_loader_batch%ROWTYPE;
    v_actual bigint;
    v_safe_new bigint;
    v_safe_update bigint;
    v_other bigint;
    v_dry boolean;
BEGIN
    SELECT * INTO b FROM places_loader_batch;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'places loader: batch not found or not entity_family=places';
    END IF;

    SELECT dry_run INTO v_dry FROM places_loader_params;

    IF b.status NOT IN ('loaded', 'validated', 'applied', 'failed') THEN
        RAISE EXCEPTION
            'places loader: batch status % not loadable (need loaded|validated|applied|failed)',
            b.status;
    END IF;

    SELECT
        count(*),
        count(*) FILTER (WHERE r.classification = 'safe_new'),
        count(*) FILTER (WHERE r.classification = 'safe_update'),
        count(*) FILTER (WHERE r.classification NOT IN ('safe_new', 'safe_update'))
    INTO v_actual, v_safe_new, v_safe_update, v_other
    FROM import_work.place_rows AS r
    WHERE r.import_batch_id = b.import_batch_id;

    IF b.loaded_row_count IS NOT NULL AND b.loaded_row_count <> v_actual THEN
        RAISE EXCEPTION 'places loader: loaded_row_count (%) <> actual (%)', b.loaded_row_count, v_actual;
    END IF;
    IF b.expected_row_count IS NOT NULL AND b.expected_row_count <> v_actual THEN
        RAISE EXCEPTION 'places loader: expected_row_count (%) <> actual (%)', b.expected_row_count, v_actual;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM import_work.place_rows AS r
        WHERE r.import_batch_id = b.import_batch_id
          AND r.source_snapshot_version IS DISTINCT FROM b.source_snapshot_version
    ) THEN
        RAISE EXCEPTION 'places loader: work-row snapshot_version mismatch vs batch';
    END IF;

    IF b.source_snapshot_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM import_work.place_rows AS r
        WHERE r.import_batch_id = b.import_batch_id
          AND r.source_snapshot_id IS NOT NULL
          AND r.source_snapshot_id IS DISTINCT FROM b.source_snapshot_id
    ) THEN
        RAISE EXCEPTION 'places loader: work-row snapshot_id mismatch vs batch';
    END IF;

    RAISE NOTICE 'places_loader [5%%] precheck ok batch=% dry_run=% actual=% safe_new=% safe_update=% other_ignored=%',
        b.batch_code, v_dry, v_actual, v_safe_new, v_safe_update, v_other;
END $$;

DROP TABLE IF EXISTS places_loader_work;
CREATE TEMP TABLE places_loader_work AS
SELECT
    r.*,
    system.pipeline_osm_identity_key(r.external_id) AS identity_key,
    CASE
        WHEN r.point_geom IS NOT NULL THEN r.point_geom
        WHEN r.lat IS NOT NULL AND r.lng IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326)::geometry(Point, 4326)
        ELSE NULL::geometry(Point, 4326)
    END AS point_geom_ready,
    nullif(btrim(r.primary_name), '') AS primary_name_ready,
    coalesce(nullif(btrim(r.display_name), ''), nullif(btrim(r.primary_name), '')) AS display_name_ready
FROM (
    SELECT r0.*
    FROM import_work.place_rows AS r0
    JOIN places_loader_batch AS b0 ON b0.import_batch_id = r0.import_batch_id
    WHERE r0.classification IN ('safe_new', 'safe_update')
    ORDER BY r0.id
    LIMIT (
        SELECT CASE
            WHEN sample_limit > 0 THEN sample_limit
            ELSE NULL
        END
        FROM places_loader_params
    )
) AS r
JOIN places_loader_batch AS b ON b.import_batch_id = r.import_batch_id;

CREATE INDEX places_loader_work_id_idx ON places_loader_work (id);
CREATE INDEX places_loader_work_identity_idx ON places_loader_work (identity_key);

DO $$
DECLARE
    v_n bigint;
BEGIN
    SELECT count(*) INTO v_n FROM places_loader_work;
    RAISE NOTICE 'places_loader [15%%] work rows ready n=%', v_n;
END $$;

-- Indexed core identity map (avoids O(n×m) LATERAL identity scans).
DROP TABLE IF EXISTS places_loader_core_by_identity;
CREATE TEMP TABLE places_loader_core_by_identity AS
SELECT DISTINCT ON (system.pipeline_osm_identity_key(p.external_id))
    system.pipeline_osm_identity_key(p.external_id) AS identity_key,
    p.id,
    p.is_verified,
    p.source_refs,
    p.primary_name,
    p.display_name,
    p.category_id,
    p.admin_area_id,
    p.point_geom
FROM core.core_places AS p
WHERE p.deleted_at IS NULL
  AND p.external_id IS NOT NULL
ORDER BY system.pipeline_osm_identity_key(p.external_id), p.id;

CREATE INDEX places_loader_core_by_identity_idx
    ON places_loader_core_by_identity (identity_key);

DO $$
DECLARE
    v_n bigint;
BEGIN
    SELECT count(*) INTO v_n FROM places_loader_core_by_identity;
    RAISE NOTICE 'places_loader [25%%] core identity index ready n=%', v_n;
END $$;

DROP TABLE IF EXISTS places_loader_core_by_id;
CREATE TEMP TABLE places_loader_core_by_id AS
SELECT
    p.id,
    p.is_verified,
    p.source_refs,
    p.primary_name,
    p.display_name,
    p.category_id,
    p.admin_area_id,
    p.point_geom,
    system.pipeline_osm_identity_key(p.external_id) AS identity_key
FROM core.core_places AS p
WHERE p.deleted_at IS NULL;

CREATE INDEX places_loader_core_by_id_idx ON places_loader_core_by_id (id);

DO $$
BEGIN
    RAISE NOTICE 'places_loader [30%%] building plan (match + classify)...';
END $$;

DROP TABLE IF EXISTS places_loader_plan;
CREATE TEMP TABLE places_loader_plan (
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
    SELECT identity_key
    FROM places_loader_work
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
        w.primary_name_ready,
        w.display_name_ready,
        w.category_id,
        w.admin_area_id,
        w.point_geom_ready,
        w.target_core_id AS declared_target_id,
        coalesce(c_by_id.id, c_by_key.id) AS matched_core_id,
        coalesce(c_by_id.is_verified, c_by_key.is_verified) AS core_is_verified,
        (
            coalesce((coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'manual_override') IN ('true', 't', '1'), false)
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"dashboard"}'::jsonb
            OR coalesce(c_by_id.source_refs, c_by_key.source_refs) @> '{"source":"manual"}'::jsonb
            OR coalesce(coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'source', '') ILIKE '%manual%'
            OR coalesce(coalesce(c_by_id.source_refs, c_by_key.source_refs)->>'source', '') ILIKE '%dashboard%'
            OR coalesce(coalesce(c_by_id.source_refs, c_by_key.source_refs)::text, '') ILIKE '%manual_dashboard%'
        ) AS core_manual_protected,
        EXISTS (SELECT 1 FROM ref.ref_poi_categories cat WHERE cat.id = w.category_id) AS category_ok,
        EXISTS (SELECT 1 FROM dup d WHERE d.identity_key = w.identity_key) AS dup_identity,
        (
            coalesce(c_by_id.id, c_by_key.id) IS NOT NULL
            AND coalesce(c_by_id.primary_name, c_by_key.primary_name) IS NOT DISTINCT FROM w.primary_name_ready
            AND coalesce(c_by_id.display_name, c_by_key.display_name) IS NOT DISTINCT FROM w.display_name_ready
            AND coalesce(c_by_id.category_id, c_by_key.category_id) IS NOT DISTINCT FROM w.category_id
            AND coalesce(c_by_id.admin_area_id, c_by_key.admin_area_id) IS NOT DISTINCT FROM w.admin_area_id
            AND (
                coalesce(c_by_id.point_geom, c_by_key.point_geom) IS NOT NULL
                AND w.point_geom_ready IS NOT NULL
                AND ST_Equals(coalesce(c_by_id.point_geom, c_by_key.point_geom), w.point_geom_ready)
            )
        ) AS allowlist_unchanged
    FROM places_loader_work AS w
    LEFT JOIN places_loader_core_by_id AS c_by_id
        ON w.target_core_id IS NOT NULL
       AND c_by_id.id = w.target_core_id
    LEFT JOIN places_loader_core_by_identity AS c_by_key
        ON w.identity_key IS NOT NULL
       AND c_by_key.identity_key = w.identity_key
       AND c_by_id.id IS NULL
)
INSERT INTO places_loader_plan (
    work_id, classification, identity_key, external_id, action,
    skip_reason, fail_reason, target_core_id, core_is_verified, core_manual_protected
)
SELECT
    m.work_id,
    m.classification,
    m.identity_key,
    m.external_id,
    CASE
        WHEN m.identity_key IS NULL THEN 'fail'
        WHEN m.dup_identity THEN 'fail'
        WHEN m.primary_name_ready IS NULL THEN 'fail'
        WHEN m.display_name_ready IS NULL THEN 'fail'
        WHEN m.category_id IS NULL OR NOT m.category_ok THEN 'fail'
        WHEN m.point_geom_ready IS NULL
             OR NOT ST_IsValid(m.point_geom_ready)
             OR ST_IsEmpty(m.point_geom_ready)
             OR ST_SRID(m.point_geom_ready) <> 4326 THEN 'fail'
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
        WHEN m.classification = 'safe_new' AND m.matched_core_id IS NOT NULL
            THEN 'identity already in core (rerun skip)'
        WHEN m.classification = 'safe_update' AND m.core_manual_protected
            THEN 'manual/dashboard protected'
        WHEN m.classification = 'safe_update' AND m.core_is_verified
            THEN 'verified row — skip meaningful overwrite'
        WHEN m.classification = 'safe_update' AND m.allowlist_unchanged
            THEN 'allowlist unchanged (idempotent rerun)'
        ELSE NULL
    END,
    CASE
        WHEN m.identity_key IS NULL THEN 'external_id has no OSM identity key'
        WHEN m.dup_identity THEN 'duplicate identity_key in batch'
        WHEN m.primary_name_ready IS NULL THEN 'primary_name required'
        WHEN m.display_name_ready IS NULL THEN 'display_name required'
        WHEN m.category_id IS NULL OR NOT m.category_ok THEN 'invalid or missing category_id'
        WHEN m.point_geom_ready IS NULL
             OR NOT ST_IsValid(m.point_geom_ready)
             OR ST_IsEmpty(m.point_geom_ready)
             OR ST_SRID(m.point_geom_ready) <> 4326 THEN 'invalid point_geom'
        WHEN m.classification = 'safe_update' AND m.matched_core_id IS NULL
            THEN 'safe_update has no matching core identity'
        ELSE NULL
    END,
    m.matched_core_id,
    coalesce(m.core_is_verified, false),
    coalesce(m.core_manual_protected, false)
FROM matched AS m;

DO $$
DECLARE
    v_fail bigint;
    v_sample text;
    v_insert bigint;
    v_update bigint;
    v_skip bigint;
    v_total bigint;
BEGIN
    SELECT count(*), min(fail_reason || ' [' || external_id || ']')
    INTO v_fail, v_sample
    FROM places_loader_plan
    WHERE action = 'fail';

    SELECT
        count(*) FILTER (WHERE action = 'insert'),
        count(*) FILTER (WHERE action = 'update'),
        count(*) FILTER (WHERE action = 'skip'),
        count(*)
    INTO v_insert, v_update, v_skip, v_total
    FROM places_loader_plan;

    RAISE NOTICE 'places_loader [45%%] plan ready total=% insert=% update=% skip=% fail=%',
        v_total, v_insert, v_update, v_skip, v_fail;

    IF v_fail > 0 THEN
        RAISE EXCEPTION 'places loader: % failed row(s); sample: %', v_fail, v_sample;
    END IF;
END $$;

DROP TABLE IF EXISTS places_loader_result;
CREATE TEMP TABLE places_loader_result (
    inserted bigint NOT NULL DEFAULT 0,
    updated bigint NOT NULL DEFAULT 0,
    skipped bigint NOT NULL DEFAULT 0,
    failed bigint NOT NULL DEFAULT 0,
    publish_batch_id bigint,
    core_places_before bigint,
    core_places_after bigint
);

INSERT INTO places_loader_result (skipped, failed, core_places_before)
SELECT
    (SELECT count(*) FROM places_loader_plan WHERE action = 'skip'),
    (SELECT count(*) FROM places_loader_plan WHERE action = 'fail'),
    (SELECT count(*) FROM core.core_places WHERE deleted_at IS NULL);

-- Chunked inserts with live percent notices (keeps large Yangon batches responsive).
DO $$
DECLARE
    v_total bigint;
    v_done bigint := 0;
    v_chunk_n bigint;
    v_chunk_size int := 500;
    v_pct int;
    v_ids bigint[];
BEGIN
    SELECT count(*) INTO v_total FROM places_loader_plan WHERE action = 'insert';
    RAISE NOTICE 'places_loader [50%%] insert start total=% chunk=%', v_total, v_chunk_size;

    IF v_total = 0 THEN
        RAISE NOTICE 'places_loader [80%%] insert skipped (0 rows)';
        RETURN;
    END IF;

    LOOP
        SELECT coalesce(array_agg(work_id ORDER BY work_id), ARRAY[]::bigint[])
        INTO v_ids
        FROM (
            SELECT work_id
            FROM places_loader_plan
            WHERE action = 'insert'
            ORDER BY work_id
            OFFSET v_done
            LIMIT v_chunk_size
        ) s;

        EXIT WHEN v_ids IS NULL OR array_length(v_ids, 1) IS NULL;

        WITH ins AS (
            INSERT INTO core.core_places (
                primary_name, display_name, category_id, admin_area_id,
                point_geom, lat, lng, plus_code,
                importance_score, popularity_score, confidence_score,
                is_public, is_verified, verification_status,
                source_type_id, external_id, source_refs, normalized_data,
                created_at, updated_at, deleted_at
            )
            SELECT
                w.primary_name_ready,
                w.display_name_ready,
                w.category_id,
                w.admin_area_id,
                w.point_geom_ready,
                ST_Y(w.point_geom_ready::geometry),
                ST_X(w.point_geom_ready::geometry),
                nullif(btrim(w.plus_code), ''),
                coalesce(w.importance_score, 0),
                coalesce(w.popularity_score, 0),
                least(100, greatest(0, coalesce(w.confidence_score, 80))),
                true,
                false,
                'unverified',
                (SELECT st.id FROM ref.ref_source_types AS st WHERE st.code = 'osm' LIMIT 1),
                w.external_id,
                coalesce(w.source_refs, '{}'::jsonb),
                jsonb_strip_nulls(jsonb_build_object(
                    'import_work_batch_id', w.import_batch_id,
                    'source_hash', w.source_hash,
                    'classification', w.classification
                )),
                now(), now(), NULL::timestamptz
            FROM places_loader_work AS w
            JOIN places_loader_plan AS p ON p.work_id = w.id
            WHERE p.action = 'insert'
              AND w.id = ANY (v_ids)
            RETURNING id
        )
        SELECT count(*) INTO v_chunk_n FROM ins;

        v_done := v_done + coalesce(v_chunk_n, 0);
        UPDATE places_loader_result SET inserted = v_done;

        v_pct := least(80, 50 + ((v_done * 30) / greatest(v_total, 1))::int);
        RAISE NOTICE 'places_loader [% %%] insert progress %/% (+%)',
            v_pct, v_done, v_total, coalesce(v_chunk_n, 0);

        EXIT WHEN v_done >= v_total;
    END LOOP;

    RAISE NOTICE 'places_loader [80%%] insert complete inserted=%', v_done;
END $$;

DO $$
DECLARE
    v_n bigint;
BEGIN
    RAISE NOTICE 'places_loader [85%%] updates starting...';
    WITH upd AS (
        UPDATE core.core_places AS c
        SET
            primary_name = w.primary_name_ready,
            display_name = w.display_name_ready,
            category_id = w.category_id,
            admin_area_id = w.admin_area_id,
            point_geom = w.point_geom_ready,
            lat = ST_Y(w.point_geom_ready::geometry),
            lng = ST_X(w.point_geom_ready::geometry),
            updated_at = now()
        FROM places_loader_work AS w
        JOIN places_loader_plan AS p ON p.work_id = w.id
        WHERE p.action = 'update'
          AND c.id = p.target_core_id
          AND c.deleted_at IS NULL
          AND NOT coalesce(c.is_verified, false)
          AND NOT (
                coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
                OR c.source_refs @> '{"source":"dashboard"}'::jsonb
                OR c.source_refs @> '{"source":"manual"}'::jsonb
                OR coalesce(c.source_refs->>'source', '') ILIKE '%manual%'
                OR coalesce(c.source_refs->>'source', '') ILIKE '%dashboard%'
          )
        RETURNING c.id
    )
    UPDATE places_loader_result SET updated = (SELECT count(*) FROM upd);

    SELECT updated INTO v_n FROM places_loader_result;
    RAISE NOTICE 'places_loader [90%%] updates complete updated=%', v_n;
END $$;

UPDATE places_loader_result
SET core_places_after = (SELECT count(*) FROM core.core_places WHERE deleted_at IS NULL);

DO $$
BEGIN
    RAISE NOTICE 'places_loader [95%%] writing publish batch + batch summary...';
END $$;

WITH pub AS (
    INSERT INTO system.system_publish_batches (
        batch_name, status, note, source_snapshot_version,
        total_item_count, success_count, failed_count, skipped_count,
        summary, published_at, promoted_at
    )
    SELECT
        format(
            'import_work_places:%s:%s',
            b.batch_code,
            to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
        ),
        CASE WHEN p.dry_run THEN 'cancelled' ELSE 'promoted' END,
        CASE WHEN p.dry_run THEN 'dry_run (will roll back if wrapper rolls back)'
             ELSE 'import_work places safe loader' END,
        b.source_snapshot_version,
        (SELECT count(*) FROM places_loader_plan)::int,
        (SELECT (inserted + updated)::int FROM places_loader_result),
        (SELECT failed::int FROM places_loader_result),
        (SELECT skipped::int FROM places_loader_result),
        jsonb_build_object(
            'loader', 'import_work.places_safe_loader',
            'import_batch_id', b.import_batch_id,
            'batch_code', b.batch_code,
            'entity_family', 'places',
            'dry_run', p.dry_run,
            'allowlist', jsonb_build_array(
                'primary_name', 'display_name', 'category_id', 'admin_area_id',
                'point_geom', 'lat', 'lng'
            ),
            'counts', (SELECT to_jsonb(r) - 'publish_batch_id' FROM places_loader_result r),
            'skip_reasons', (
                SELECT coalesce(jsonb_object_agg(skip_reason, cnt), '{}'::jsonb)
                FROM (
                    SELECT skip_reason, count(*) AS cnt
                    FROM places_loader_plan
                    WHERE action = 'skip' AND skip_reason IS NOT NULL
                    GROUP BY skip_reason
                ) s
            )
        ),
        CASE WHEN p.dry_run THEN NULL ELSE now() END,
        CASE WHEN p.dry_run THEN NULL ELSE now() END
    FROM places_loader_batch AS b
    CROSS JOIN places_loader_params AS p
    RETURNING id
)
UPDATE places_loader_result
SET publish_batch_id = (SELECT id FROM pub);

UPDATE import_work.import_batches AS b
SET
    status = CASE WHEN (SELECT dry_run FROM places_loader_params) THEN b.status ELSE 'applied' END,
    validation_status = CASE
        WHEN (SELECT dry_run FROM places_loader_params) THEN b.validation_status
        ELSE 'passed'
    END,
    validation_summary = coalesce(b.validation_summary, '{}'::jsonb) || jsonb_build_object(
        'places_safe_loader', (SELECT to_jsonb(r) FROM places_loader_result r),
        'dry_run', (SELECT dry_run FROM places_loader_params),
        'ran_at', now()
    ),
    updated_at = now()
FROM places_loader_batch AS lb
WHERE b.id = lb.import_batch_id;

DO $$
DECLARE
    r places_loader_result%ROWTYPE;
    v_dry boolean;
BEGIN
    SELECT * INTO r FROM places_loader_result;
    SELECT dry_run INTO v_dry FROM places_loader_params;
    RAISE NOTICE 'places_loader [100%%] done dry_run=% inserted=% updated=% skipped=% failed=% core_before=% core_after=% delta=%',
        v_dry, r.inserted, r.updated, r.skipped, r.failed,
        r.core_places_before, r.core_places_after,
        (r.core_places_after - r.core_places_before);
END $$;

SELECT
    'places_safe_loader_result' AS section,
    p.dry_run,
    b.batch_code,
    r.inserted,
    r.updated,
    r.skipped,
    r.failed,
    r.publish_batch_id,
    r.core_places_before,
    r.core_places_after,
    (r.core_places_after - r.core_places_before) AS core_places_delta
FROM places_loader_result AS r
CROSS JOIN places_loader_params AS p
CROSS JOIN places_loader_batch AS b;

SELECT
    'places_safe_loader_plan' AS section,
    action,
    count(*) AS n,
    min(skip_reason) FILTER (WHERE skip_reason IS NOT NULL) AS sample_skip,
    min(fail_reason) FILTER (WHERE fail_reason IS NOT NULL) AS sample_fail
FROM places_loader_plan
GROUP BY action
ORDER BY action;
