-- =============================================================================
-- Phase 3 gate: full merge verification + promotion eligibility parity (read-only)
-- =============================================================================
-- Run after supabase/083. Blocks Phase 4 (direct column PATCH) if any check fails.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/import-review/004_review-overrides-phase3-verification-gate.sql
--
-- Pass: final NOTICE "Phase 3 gate: PASSED"; no EXCEPTION.
-- Subset checks: 003_review-overrides-merge-verify.sql (no hard stop).
-- =============================================================================

DROP TABLE IF EXISTS phase3_gate_failures;
CREATE TEMP TABLE phase3_gate_failures (
    check_name text PRIMARY KEY,
    fail_count bigint NOT NULL
);

-- -----------------------------------------------------------------------------
-- HS-2: FK-valid scalar parity
-- -----------------------------------------------------------------------------
INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2 buildings.building_type_id', count(*)::bigint
FROM import_review.building_candidates AS b
WHERE b.review_overrides ? 'building_type_id'
  AND nullif(trim(b.review_overrides ->> 'building_type_id'), '') IS NOT NULL
  AND exists (
      select 1 from ref.ref_building_types bt
      where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
  )
  AND b.building_type_id IS DISTINCT FROM (b.review_overrides ->> 'building_type_id')::bigint;

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2 roads.road_class_id', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'road_class_id'
  AND nullif(trim(r.review_overrides ->> 'road_class_id'), '') IS NOT NULL
  AND exists (
      select 1 from ref.ref_road_classes rc
      where rc.id = (r.review_overrides ->> 'road_class_id')::bigint
  )
  AND r.road_class_id IS DISTINCT FROM (r.review_overrides ->> 'road_class_id')::bigint;

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2 places.category_id', count(*)::bigint
FROM import_review.place_candidates AS p
WHERE (
    (
        p.review_overrides ? 'category_id'
        AND nullif(trim(p.review_overrides ->> 'category_id'), '') IS NOT NULL
        AND exists (
            select 1 from ref.ref_poi_categories pc
            where pc.id = (p.review_overrides ->> 'category_id')::bigint
        )
        AND p.category_id IS DISTINCT FROM (p.review_overrides ->> 'category_id')::bigint
    )
    OR (
        p.review_overrides ? 'poi_category_id'
        AND nullif(trim(p.review_overrides ->> 'poi_category_id'), '') IS NOT NULL
        AND exists (
            select 1 from ref.ref_poi_categories pc
            where pc.id = (p.review_overrides ->> 'poi_category_id')::bigint
        )
        AND p.category_id IS DISTINCT FROM (p.review_overrides ->> 'poi_category_id')::bigint
    )
);

-- -----------------------------------------------------------------------------
-- HS-2 extended: 1:1 merge-safe text / numeric keys
-- -----------------------------------------------------------------------------
INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2ext buildings.name_mm', count(*)::bigint
FROM import_review.building_candidates AS b
WHERE b.review_overrides ? 'name_mm'
  AND nullif(trim(b.review_overrides ->> 'name_mm'), '') IS NOT NULL
  AND b.name_mm IS DISTINCT FROM nullif(trim(b.review_overrides ->> 'name_mm'), '');

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2ext roads.speed_kph', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'speed_kph'
  AND nullif(trim(r.review_overrides ->> 'speed_kph'), '') IS NOT NULL
  AND r.speed_kph IS DISTINCT FROM (r.review_overrides ->> 'speed_kph')::numeric;

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2ext roads.access', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'access'
  AND nullif(trim(r.review_overrides ->> 'access'), '') IS NOT NULL
  AND r.access IS DISTINCT FROM nullif(trim(r.review_overrides ->> 'access'), '');

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-2ext roads.admin_area_id', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'admin_area_id'
  AND nullif(trim(r.review_overrides ->> 'admin_area_id'), '') IS NOT NULL
  AND exists (
      select 1 from core.core_admin_areas aa
      where aa.id = (r.review_overrides ->> 'admin_area_id')::bigint
  )
  AND r.admin_area_id IS DISTINCT FROM (r.review_overrides ->> 'admin_area_id')::bigint;

-- -----------------------------------------------------------------------------
-- HS-3: geometry parity where override has GeoJSON object
-- -----------------------------------------------------------------------------
INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-3 roads.geom', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'geom'
  AND jsonb_typeof(r.review_overrides -> 'geom') = 'object'
  AND (
      r.geom IS NULL
      OR NOT st_equals(r.geom, st_setsrid(st_geomfromgeojson(r.review_overrides -> 'geom'), 4326))
  );

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-3 buildings.geom', count(*)::bigint
FROM import_review.building_candidates AS b
WHERE b.review_overrides ? 'geom'
  AND jsonb_typeof(b.review_overrides -> 'geom') = 'object'
  AND (
      b.geom IS NULL
      OR NOT st_equals(b.geom, st_setsrid(st_geomfromgeojson(b.review_overrides -> 'geom'), 4326))
  );

INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'HS-3 places.point_geom', count(*)::bigint
FROM import_review.place_candidates AS p
WHERE (
    (p.review_overrides ? 'point_geom' AND jsonb_typeof(p.review_overrides -> 'point_geom') = 'object')
    OR (p.review_overrides ? 'geom' AND jsonb_typeof(p.review_overrides -> 'geom') = 'object')
)
AND (
    p.point_geom IS NULL
    OR NOT st_equals(
        p.point_geom,
        st_setsrid(
            st_geomfromgeojson(
                coalesce(
                    case when jsonb_typeof(p.review_overrides -> 'point_geom') = 'object'
                        then p.review_overrides -> 'point_geom' end,
                    p.review_overrides -> 'geom'
                )
            ),
            4326
        )
    )
);

-- -----------------------------------------------------------------------------
-- Archive unchanged (083 must not mutate review_overrides or archive)
-- -----------------------------------------------------------------------------
INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'archive_drift buildings+roads', sum(cnt)::bigint
FROM (
    SELECT count(*)::bigint AS cnt
    FROM import_review.building_candidates
    WHERE review_overrides IS DISTINCT FROM review_overrides_archive
      AND review_overrides <> '{}'::jsonb
    UNION ALL
    SELECT count(*)::bigint
    FROM import_review.road_candidates
    WHERE review_overrides IS DISTINCT FROM review_overrides_archive
      AND review_overrides <> '{}'::jsonb
) AS s;

-- -----------------------------------------------------------------------------
-- Promotion eligibility parity (roads): legacy vs column-only road_class guard
-- -----------------------------------------------------------------------------
WITH road_base AS (
    SELECT r.*
    FROM import_review.road_candidates AS r
    WHERE r.entity_family = 'roads'
      AND r.review_status = 'approved'
      AND r.review_decision = 'approved'
),
eligible_legacy AS (
    SELECT b.id
    FROM road_base AS b
    WHERE b.promotion_status IS DISTINCT FROM 'promoted'
      AND b.review_status IS DISTINCT FROM 'promoted'
      AND NOT (
          b.validation_errors IS NOT NULL
          AND jsonb_typeof(b.validation_errors) = 'array'
          AND exists (
              SELECT 1
              FROM jsonb_array_elements(b.validation_errors) AS issue
              WHERE jsonb_typeof(issue) = 'object'
                AND coalesce(issue ->> 'severity', 'error') = 'error'
                AND upper(coalesce(issue ->> 'code', '')) IN (
                    'GEOMETRY_MISSING', 'GEOMETRY_INVALID', 'GEOMETRY_EMPTY',
                    'INVALID_GEOMETRY_TYPE', 'INVALID_SRID', 'INVALID_COORDINATES',
                    'ROAD_CLASS_MISSING', 'DUPLICATE_EXTERNAL_ID_IN_CORE'
                )
          )
      )
      AND b.review_decision IS DISTINCT FROM 'rejected'
      AND b.match_status IS DISTINCT FROM 'manual_protected'
      AND b.auto_action IS DISTINCT FROM 'protect_manual'
      AND (
          b.match_status IS DISTINCT FROM 'duplicate_candidate'
          AND b.match_status IS DISTINCT FROM 'possible_duplicate'
          OR trim(coalesce(b.review_note, '')) <> ''
      )
      AND NOT exists (
          SELECT 1
          FROM system.system_publish_items AS spi
          INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
          WHERE spi.review_candidate_table = 'import_review.road_candidates'
            AND spi.review_candidate_id = b.id
            AND spb.status IN ('draft', 'validating', 'validated', 'promoting')
      )
      AND (
          b.external_id IS NULL
          OR trim(b.external_id) = ''
          OR b.matched_core_id IS NOT NULL
          OR NOT exists (
              SELECT 1
              FROM core.core_streets AS cs
              WHERE cs.external_id = b.external_id
                AND coalesce(cs.is_active, true)
                AND cs.deleted_at IS NULL
          )
      )
      AND NOT (
          b.road_class_id IS NULL
          AND nullif(trim(coalesce(b.class_code, '')), '') IS NULL
          AND nullif(trim(coalesce(b.normalized_data ->> 'highway', '')), '') IS NULL
          AND nullif(trim(coalesce(b.review_overrides ->> 'highway', '')), '') IS NULL
      )
),
eligible_future AS (
    SELECT b.id
    FROM road_base AS b
    WHERE b.promotion_status IS DISTINCT FROM 'promoted'
      AND b.review_status IS DISTINCT FROM 'promoted'
      AND NOT (
          b.validation_errors IS NOT NULL
          AND jsonb_typeof(b.validation_errors) = 'array'
          AND exists (
              SELECT 1
              FROM jsonb_array_elements(b.validation_errors) AS issue
              WHERE jsonb_typeof(issue) = 'object'
                AND coalesce(issue ->> 'severity', 'error') = 'error'
                AND upper(coalesce(issue ->> 'code', '')) IN (
                    'GEOMETRY_MISSING', 'GEOMETRY_INVALID', 'GEOMETRY_EMPTY',
                    'INVALID_GEOMETRY_TYPE', 'INVALID_SRID', 'INVALID_COORDINATES',
                    'ROAD_CLASS_MISSING', 'DUPLICATE_EXTERNAL_ID_IN_CORE'
                )
          )
      )
      AND b.review_decision IS DISTINCT FROM 'rejected'
      AND b.match_status IS DISTINCT FROM 'manual_protected'
      AND b.auto_action IS DISTINCT FROM 'protect_manual'
      AND (
          b.match_status IS DISTINCT FROM 'duplicate_candidate'
          AND b.match_status IS DISTINCT FROM 'possible_duplicate'
          OR trim(coalesce(b.review_note, '')) <> ''
      )
      AND NOT exists (
          SELECT 1
          FROM system.system_publish_items AS spi
          INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
          WHERE spi.review_candidate_table = 'import_review.road_candidates'
            AND spi.review_candidate_id = b.id
            AND spb.status IN ('draft', 'validating', 'validated', 'promoting')
      )
      AND (
          b.external_id IS NULL
          OR trim(b.external_id) = ''
          OR b.matched_core_id IS NOT NULL
          OR NOT exists (
              SELECT 1
              FROM core.core_streets AS cs
              WHERE cs.external_id = b.external_id
                AND coalesce(cs.is_active, true)
                AND cs.deleted_at IS NULL
          )
      )
      AND NOT (
          b.road_class_id IS NULL
          AND nullif(trim(coalesce(b.class_code, '')), '') IS NULL
          AND nullif(trim(coalesce(b.normalized_data ->> 'highway', '')), '') IS NULL
      )
),
ready_counts AS (
    SELECT
        (
            SELECT count(*)::bigint
            FROM road_base AS r
            WHERE r.id IN (SELECT id FROM eligible_legacy)
              AND (
                  r.validation_warnings IS NULL
                  OR jsonb_typeof(r.validation_warnings) <> 'array'
                  OR jsonb_array_length(r.validation_warnings) = 0
              )
        ) AS legacy_ready,
        (
            SELECT count(*)::bigint
            FROM road_base AS r
            WHERE r.id IN (SELECT id FROM eligible_future)
              AND (
                  r.validation_warnings IS NULL
                  OR jsonb_typeof(r.validation_warnings) <> 'array'
                  OR jsonb_array_length(r.validation_warnings) = 0
              )
        ) AS future_ready
)
INSERT INTO phase3_gate_failures (check_name, fail_count)
SELECT 'promotion roads ready_count_drift', abs(legacy_ready - future_ready)
FROM ready_counts;

-- -----------------------------------------------------------------------------
-- Report + hard stop
-- -----------------------------------------------------------------------------
SELECT 'phase3_gate_results' AS section, check_name, fail_count
FROM phase3_gate_failures
ORDER BY check_name;

SELECT 'invalid_building_type_override_count' AS section, count(*)::bigint AS row_count
FROM import_review.building_candidates AS b
WHERE b.review_overrides ? 'building_type_id'
  AND nullif(trim(b.review_overrides ->> 'building_type_id'), '') IS NOT NULL
  AND NOT exists (
      select 1 from ref.ref_building_types bt
      where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
  );

SELECT 'highway_override_only_count' AS section, count(*)::bigint AS row_count
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'highway'
  AND nullif(trim(r.review_overrides ->> 'highway'), '') IS NOT NULL
  AND NOT (r.review_overrides ? 'road_class_id')
  AND r.road_class_id IS NULL
  AND nullif(trim(coalesce(r.class_code, '')), '') IS NULL;

DO $$
DECLARE
    r record;
    any_fail boolean := false;
BEGIN
    FOR r IN
        SELECT check_name, fail_count
        FROM phase3_gate_failures
        WHERE fail_count > 0
        ORDER BY check_name
    LOOP
        any_fail := true;
        RAISE WARNING 'Phase 3 gate FAIL: % (count=%)', r.check_name, r.fail_count;
    END LOOP;

    IF any_fail THEN
        RAISE EXCEPTION 'Phase 3 gate: one or more checks failed (see results above)';
    END IF;

    RAISE NOTICE 'Phase 3 gate: PASSED — safe to proceed to Phase 4 (direct column PATCH API)';
END $$;
