-- =============================================================================
-- Shared preflight helpers for import-review SQL bulk promotion (Supabase)
--
-- Validates schemas, OSM source type, required columns, confidence_score range,
-- and ensures partial unique indexes on core.external_id when safe.
-- Does not insert/update core rows (indexes only).
--
-- Required psql variable:
--   -v review_batch_id=<bigint>
-- Optional:
--   -v limit_rows=<int>          (empty = no limit; if set, must be > 0)
--
-- Standalone (Supabase pooler port 6543 requires one transaction for temp tables):
--   psql "$DATABASE_URL" -v review_batch_id=2 \
--     -f tools/data-pipeline/import-review-bulk-promotion/00_shared_bulk_promotion_helpers.sql
-- Prefer direct Postgres (port 5432) for long-running promote scripts.
--
-- From another script (same psql session / transaction):
--   \ir 00_shared_bulk_promotion_helpers.sql
-- =============================================================================

\set ON_ERROR_STOP on

\ir _psql_default_vars.sql

BEGIN;

-- Do not use ON COMMIT DROP here: standalone psql auto-commits each statement, which
-- would drop these tables before the next line runs. DROP + CREATE is idempotent per session.
DROP TABLE IF EXISTS bulk_promotion_preflight_params;
CREATE TEMP TABLE bulk_promotion_preflight_params (
    review_batch_id bigint NOT NULL,
    limit_rows int
);

INSERT INTO bulk_promotion_preflight_params (review_batch_id, limit_rows)
VALUES (
    NULLIF(btrim(:'review_batch_id'), '')::bigint,
    NULLIF(btrim(:'limit_rows'), '')::int
);

DROP TABLE IF EXISTS bulk_promotion_preflight_report;
CREATE TEMP TABLE bulk_promotion_preflight_report (
    ord int NOT NULL,
    check_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('PASS', 'FAIL')),
    detail text,
    hard_fail boolean NOT NULL DEFAULT true
);

DO $preflight$
DECLARE
    p bulk_promotion_preflight_params%ROWTYPE;
    v_ord int := 0;
    v_missing_cols bigint;
    v_bad_confidence bigint;
    v_has_unique boolean;
    v_has_duplicates boolean;
    v_review_batch_exists boolean;
    v_missing_list text;
BEGIN
    SELECT * INTO p FROM bulk_promotion_preflight_params;

    v_ord := v_ord + 1;
    IF p.review_batch_id IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'psql review_batch_id', 'FAIL', 'required (psql -v review_batch_id=...)', true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'psql review_batch_id', 'PASS', p.review_batch_id::text, false);
    END IF;

    v_ord := v_ord + 1;
    IF p.limit_rows IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'psql limit_rows', 'PASS', 'not set (no row limit)', false);
    ELSIF p.limit_rows <= 0 THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'psql limit_rows', 'FAIL', format('must be > 0 when set; got %s', p.limit_rows), true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'psql limit_rows', 'PASS', p.limit_rows::text, false);
    END IF;

    v_ord := v_ord + 1;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'import_review') THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'schema import_review', 'PASS', false);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'schema import_review', 'FAIL', 'schema does not exist', true);
    END IF;

    v_ord := v_ord + 1;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core') THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'schema core', 'PASS', false);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'schema core', 'FAIL', 'schema does not exist', true);
    END IF;

    v_ord := v_ord + 1;
    IF to_regclass('ref.ref_source_types') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'ref.ref_source_types code=osm', 'FAIL', 'table ref.ref_source_types does not exist', true);
    ELSIF EXISTS (SELECT 1 FROM ref.ref_source_types AS st WHERE st.code = 'osm') THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'ref.ref_source_types code=osm', 'PASS', false);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'ref.ref_source_types code=osm', 'FAIL', 'no row with code=osm', true);
    END IF;

    v_ord := v_ord + 1;
    IF p.review_batch_id IS NULL OR to_regclass('import_review.review_batches') IS NULL THEN
        IF p.review_batch_id IS NOT NULL THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (v_ord, 'import_review.review_batches', 'FAIL', 'table does not exist', true);
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM import_review.review_batches AS rb
            WHERE rb.id = p.review_batch_id
        )
        INTO v_review_batch_exists;

        IF v_review_batch_exists THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.review_batches',
                'PASS',
                format('review_batch_id=%s exists', p.review_batch_id),
                false
            );
        ELSE
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.review_batches',
                'FAIL',
                format('review_batch_id=%s not found', p.review_batch_id),
                true
            );
        END IF;
    END IF;

    v_ord := v_ord + 1;
    IF to_regclass('import_review.admin_area_candidates') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'table import_review.admin_area_candidates', 'FAIL', 'table does not exist', true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'table import_review.admin_area_candidates', 'PASS', false);
    END IF;

    v_ord := v_ord + 1;
    IF to_regclass('import_review.road_candidates') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'table import_review.road_candidates', 'FAIL', 'table does not exist', true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'table import_review.road_candidates', 'PASS', false);
    END IF;

    v_ord := v_ord + 1;
    IF to_regclass('core.core_admin_areas') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'table core.core_admin_areas', 'FAIL', 'table does not exist', true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'table core.core_admin_areas', 'PASS', false);
    END IF;

    v_ord := v_ord + 1;
    IF to_regclass('core.core_streets') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'table core.core_streets', 'FAIL', 'table does not exist', true);
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
        VALUES (v_ord, 'table core.core_streets', 'PASS', false);
    END IF;

    WITH required AS (
        SELECT
            v.check_label,
            v.table_schema,
            v.table_name,
            v.column_name
        FROM (
            VALUES
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'review_batch_id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'external_id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'canonical_name'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'admin_level_id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'geom'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'centroid'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'confidence_score'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'review_status'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'review_decision'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'promotion_status'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'promoted_core_id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'match_status'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'source_refs'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'normalized_data'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'parent_id'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'slug'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'name_mm'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'name_en'),
                ('import_review.admin_area_candidates', 'import_review', 'admin_area_candidates', 'class_code'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'external_id'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'parent_id'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'admin_level_id'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'canonical_name'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'slug'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'geom'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'centroid'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'source_type_id'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'source_refs'),
                ('core.core_admin_areas', 'core', 'core_admin_areas', 'is_active'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'review_batch_id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'external_id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'geom'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'road_class_id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'confidence_score'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'review_status'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'review_decision'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'promotion_status'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'promoted_core_id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'match_status'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'source_refs'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'normalized_data'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'local_staging_id'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'canonical_name'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'name_mm'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'name_en'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'road_class'),
                ('import_review.road_candidates', 'import_review', 'road_candidates', 'class_code'),
                ('core.core_streets', 'core', 'core_streets', 'external_id'),
                ('core.core_streets', 'core', 'core_streets', 'canonical_name'),
                ('core.core_streets', 'core', 'core_streets', 'geom'),
                ('core.core_streets', 'core', 'core_streets', 'road_class_id'),
                ('core.core_streets', 'core', 'core_streets', 'source_type_id'),
                ('core.core_streets', 'core', 'core_streets', 'source_refs'),
                ('core.core_streets', 'core', 'core_streets', 'normalized_data'),
                ('core.core_streets', 'core', 'core_streets', 'is_active')
        ) AS v(check_label, table_schema, table_name, column_name)
    ),
    missing AS (
        SELECT r.check_label, r.column_name
        FROM required AS r
        WHERE to_regclass(r.check_label) IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM information_schema.columns AS c
              WHERE c.table_schema = r.table_schema
                AND c.table_name = r.table_name
                AND c.column_name = r.column_name
          )
    ),
    missing_limited AS (
        SELECT m.check_label, m.column_name
        FROM missing AS m
        ORDER BY m.check_label, m.column_name
        LIMIT 20
    )
    SELECT
        (SELECT count(*)::bigint FROM missing),
        (
            SELECT string_agg(format('%s.%s', ml.check_label, ml.column_name), ', ' ORDER BY ml.check_label, ml.column_name)
            FROM missing_limited AS ml
        )
    INTO v_missing_cols, v_missing_list;

    v_ord := v_ord + 1;
    IF v_missing_cols = 0 THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (
            v_ord,
            'required admin_areas/roads columns',
            'PASS',
            'all required import_review/core columns present',
            false
        );
    ELSE
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (
            v_ord,
            'required admin_areas/roads columns',
            'FAIL',
            coalesce(v_missing_list, '') || CASE WHEN v_missing_cols > 20 THEN format(' (+%s more)', v_missing_cols - 20) ELSE '' END,
            true
        );
    END IF;

    IF p.review_batch_id IS NOT NULL
       AND to_regclass('import_review.admin_area_candidates') IS NOT NULL THEN
        v_ord := v_ord + 1;
        SELECT count(*)::bigint
        INTO v_bad_confidence
        FROM import_review.admin_area_candidates AS aa
        WHERE aa.review_batch_id = p.review_batch_id
          AND aa.confidence_score IS NOT NULL
          AND (aa.confidence_score < 0 OR aa.confidence_score > 100);

        IF v_bad_confidence = 0 THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.admin_area_candidates confidence_score 0-100',
                'PASS',
                format('review_batch_id=%s', p.review_batch_id),
                false
            );
        ELSE
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.admin_area_candidates confidence_score 0-100',
                'FAIL',
                format('%s row(s) out of range for review_batch_id=%s', v_bad_confidence, p.review_batch_id),
                true
            );
        END IF;
    END IF;

    IF p.review_batch_id IS NOT NULL
       AND to_regclass('import_review.road_candidates') IS NOT NULL THEN
        v_ord := v_ord + 1;
        SELECT count(*)::bigint
        INTO v_bad_confidence
        FROM import_review.road_candidates AS r
        WHERE r.review_batch_id = p.review_batch_id
          AND r.confidence_score IS NOT NULL
          AND (r.confidence_score < 0 OR r.confidence_score > 100);

        IF v_bad_confidence = 0 THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.road_candidates confidence_score 0-100',
                'PASS',
                format('review_batch_id=%s', p.review_batch_id),
                false
            );
        ELSE
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'import_review.road_candidates confidence_score 0-100',
                'FAIL',
                format('%s row(s) out of range for review_batch_id=%s', v_bad_confidence, p.review_batch_id),
                true
            );
        END IF;
    END IF;

    IF to_regclass('core.core_admin_areas') IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns AS c
           WHERE c.table_schema = 'core'
             AND c.table_name = 'core_admin_areas'
             AND c.column_name = 'boundary_confidence_score'
       ) THEN
        v_ord := v_ord + 1;
        SELECT count(*)::bigint
        INTO v_bad_confidence
        FROM core.core_admin_areas AS a
        WHERE a.boundary_confidence_score IS NOT NULL
          AND (a.boundary_confidence_score < 0 OR a.boundary_confidence_score > 100);

        IF v_bad_confidence = 0 THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
            VALUES (v_ord, 'core.core_admin_areas boundary_confidence_score 0-100', 'PASS', false);
        ELSE
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'core.core_admin_areas boundary_confidence_score 0-100',
                'FAIL',
                format('%s row(s) out of range', v_bad_confidence),
                true
            );
        END IF;
    END IF;

    IF to_regclass('core.core_streets') IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns AS c
           WHERE c.table_schema = 'core'
             AND c.table_name = 'core_streets'
             AND c.column_name = 'confidence_score'
       ) THEN
        v_ord := v_ord + 1;
        SELECT count(*)::bigint
        INTO v_bad_confidence
        FROM core.core_streets AS s
        WHERE s.confidence_score IS NOT NULL
          AND (s.confidence_score < 0 OR s.confidence_score > 100);

        IF v_bad_confidence = 0 THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, hard_fail)
            VALUES (v_ord, 'core.core_streets confidence_score 0-100', 'PASS', false);
        ELSE
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'core.core_streets confidence_score 0-100',
                'FAIL',
                format('%s row(s) out of range', v_bad_confidence),
                true
            );
        END IF;
    END IF;

    -- core.core_admin_areas(external_id) partial unique index
    v_ord := v_ord + 1;
    IF to_regclass('core.core_admin_areas') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'core.core_admin_areas external_id unique index', 'FAIL', 'table does not exist', true);
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'core'
              AND t.relname = 'core_admin_areas'
              AND c.contype IN ('u', 'p')
              AND (
                  SELECT array_agg(a.attname ORDER BY ord.ordinality)
                  FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid
                   AND a.attnum = ord.attnum
                   AND NOT a.attisdropped
              ) = ARRAY['external_id']::name[]
        )
        INTO v_has_unique;

        IF NOT v_has_unique THEN
            SELECT EXISTS (
                SELECT 1
                FROM pg_indexes i
                WHERE i.schemaname = 'core'
                  AND i.tablename = 'core_admin_areas'
                  AND i.indexdef ILIKE '%UNIQUE%'
                  AND i.indexdef ILIKE '%(external_id%'
            )
            INTO v_has_unique;
        END IF;

        IF v_has_unique THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'core.core_admin_areas external_id unique index',
                'PASS',
                'unique index or constraint on external_id already present',
                false
            );
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM core.core_admin_areas
                WHERE external_id IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            )
            INTO v_has_duplicates;

            IF v_has_duplicates THEN
                INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
                VALUES (
                    v_ord,
                    'core.core_admin_areas external_id unique index',
                    'FAIL',
                    'duplicate external_id values prevent creating partial unique index',
                    true
                );
            ELSE
                CREATE UNIQUE INDEX IF NOT EXISTS core_admin_areas_external_id_unique_idx
                    ON core.core_admin_areas (external_id)
                    WHERE external_id IS NOT NULL;
                INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
                VALUES (
                    v_ord,
                    'core.core_admin_areas external_id unique index',
                    'PASS',
                    'ensured index core_admin_areas_external_id_unique_idx',
                    false
                );
            END IF;
        END IF;
    END IF;

    -- core.core_streets(external_id) partial unique index
    v_ord := v_ord + 1;
    IF to_regclass('core.core_streets') IS NULL THEN
        INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
        VALUES (v_ord, 'core.core_streets external_id unique index', 'FAIL', 'table does not exist', true);
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'core'
              AND t.relname = 'core_streets'
              AND c.contype IN ('u', 'p')
              AND (
                  SELECT array_agg(a.attname ORDER BY ord.ordinality)
                  FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid
                   AND a.attnum = ord.attnum
                   AND NOT a.attisdropped
              ) = ARRAY['external_id']::name[]
        )
        INTO v_has_unique;

        IF NOT v_has_unique THEN
            SELECT EXISTS (
                SELECT 1
                FROM pg_indexes i
                WHERE i.schemaname = 'core'
                  AND i.tablename = 'core_streets'
                  AND i.indexdef ILIKE '%UNIQUE%'
                  AND i.indexdef ILIKE '%(external_id%'
            )
            INTO v_has_unique;
        END IF;

        IF v_has_unique THEN
            INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
            VALUES (
                v_ord,
                'core.core_streets external_id unique index',
                'PASS',
                'unique index or constraint on external_id already present',
                false
            );
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM core.core_streets
                WHERE external_id IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            )
            INTO v_has_duplicates;

            IF v_has_duplicates THEN
                INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
                VALUES (
                    v_ord,
                    'core.core_streets external_id unique index',
                    'FAIL',
                    'duplicate external_id values prevent creating partial unique index',
                    true
                );
            ELSE
                CREATE UNIQUE INDEX IF NOT EXISTS core_streets_external_id_unique_idx
                    ON core.core_streets (external_id)
                    WHERE external_id IS NOT NULL;
                INSERT INTO bulk_promotion_preflight_report (ord, check_key, status, detail, hard_fail)
                VALUES (
                    v_ord,
                    'core.core_streets external_id unique index',
                    'PASS',
                    'ensured index core_streets_external_id_unique_idx',
                    false
                );
            END IF;
        END IF;
    END IF;

END;
$preflight$;

\echo ''
\echo '=== bulk promotion preflight report ==='

SELECT
    status,
    check_key,
    coalesce(detail, '') AS detail
FROM bulk_promotion_preflight_report
ORDER BY ord;

SELECT
    count(*) FILTER (WHERE status = 'PASS') AS pass_count,
    count(*) FILTER (WHERE status = 'FAIL') AS fail_count
FROM bulk_promotion_preflight_report;

DO $raise_on_fail$
DECLARE
    v_fail_count bigint;
BEGIN
    SELECT count(*)::bigint
    INTO v_fail_count
    FROM bulk_promotion_preflight_report
    WHERE status = 'FAIL'
      AND hard_fail;

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION 'bulk promotion preflight failed: % hard FAIL check(s)', v_fail_count;
    END IF;
END;
$raise_on_fail$;

COMMIT;
