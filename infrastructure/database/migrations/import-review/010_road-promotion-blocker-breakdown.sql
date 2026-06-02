-- Road promotion eligibility blocker breakdown for a review batch.
--
-- validation_errors / validation_warnings may be stored as:
--   - object arrays: [{"code":"ROAD_TOO_SHORT","severity":"warning","message":"..."}]
--   - string arrays: ["ROAD_TOO_SHORT", "OUTSIDE_REVIEW_BOUNDARY"]
--   - message-only objects: [{"message":"Road is short"}]
--
-- The "Top validation_* codes" sections normalize all of the above for reporting.
-- Eligibility buckets and promotion-blocking checks still use only canonical error
-- codes on object items with severity=error (see eligible_core CTE below).
--
-- Usage: psql "$DATABASE_URL" -v review_batch_id=2 \
--   -f infrastructure/database/migrations/import-review/010_road-promotion-blocker-breakdown.sql

\set review_batch_id 2

\echo '=== Approved roads: eligibility buckets (review_batch_id=' :review_batch_id ') ==='

WITH base AS (
    SELECT r.*
    FROM import_review.road_candidates AS r
    WHERE r.review_batch_id = :review_batch_id
      AND r.entity_family = 'roads'
      AND r.review_status = 'approved'
      AND r.review_decision = 'approved'
),
eligible_core AS (
    SELECT b.*
    FROM base AS b
    WHERE b.promotion_status IS DISTINCT FROM 'promoted'
      AND b.review_status IS DISTINCT FROM 'promoted'
      -- Promotion-blocking: object items only, canonical codes, severity=error.
      AND NOT (
          b.validation_errors IS NOT NULL
          AND jsonb_typeof(b.validation_errors) = 'array'
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(b.validation_errors) AS issue
              WHERE jsonb_typeof(issue) = 'object'
                AND coalesce(issue->>'severity', 'error') = 'error'
                AND upper(coalesce(issue->>'code', '')) IN (
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
      AND NOT EXISTS (
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
          OR NOT EXISTS (
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
          AND nullif(trim(coalesce(b.normalized_data->>'highway', '')), '') IS NULL
          AND nullif(trim(coalesce(b.review_overrides->>'highway', '')), '') IS NULL
      )
)
SELECT
    count(*)::int AS approved_total,
    count(*) FILTER (
        WHERE id IN (SELECT id FROM eligible_core)
          AND (
              validation_warnings IS NULL
              OR jsonb_typeof(validation_warnings) <> 'array'
              OR jsonb_array_length(validation_warnings) = 0
          )
    )::int AS ready,
    count(*) FILTER (
        WHERE id IN (SELECT id FROM eligible_core)
          AND validation_warnings IS NOT NULL
          AND jsonb_typeof(validation_warnings) = 'array'
          AND jsonb_array_length(validation_warnings) > 0
    )::int AS with_warnings,
    count(*) FILTER (
        WHERE EXISTS (
            SELECT 1
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.review_candidate_table = 'import_review.road_candidates'
              AND spi.review_candidate_id = base.id
              AND spb.status IN ('draft', 'validating', 'validated', 'promoting')
        )
    )::int AS batched_active_publish,
    count(*) FILTER (WHERE promotion_status = 'promoted' OR review_status = 'promoted')::int AS promoted,
    count(*) FILTER (
        WHERE promotion_status IS DISTINCT FROM 'promoted'
          AND review_status IS DISTINCT FROM 'promoted'
          AND id NOT IN (SELECT id FROM eligible_core)
          AND NOT EXISTS (
              SELECT 1
              FROM system.system_publish_items AS spi
              INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
              WHERE spi.review_candidate_table = 'import_review.road_candidates'
                AND spi.review_candidate_id = base.id
                AND spb.status IN ('draft', 'validating', 'validated', 'promoting')
          )
    )::int AS excluded_from_ready
FROM base;

\echo ''
\echo '=== Top validation_errors codes (approved roads) ==='
\echo 'Supports object, string, and other JSON array element shapes.'

SELECT
    CASE
        WHEN jsonb_typeof(issue) = 'object' THEN
            upper(coalesce(issue->>'code', issue->>'message', '(no code)'))
        WHEN jsonb_typeof(issue) = 'string' THEN
            upper(trim(both '"' from issue::text))
        ELSE
            upper(issue::text)
    END AS error_code,
    count(*)::int AS issue_count,
    count(DISTINCT r.id)::int AS road_count
FROM import_review.road_candidates AS r
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.validation_errors, '[]'::jsonb)) AS issue
WHERE r.review_batch_id = :review_batch_id
  AND r.entity_family = 'roads'
  AND r.review_status = 'approved'
  AND r.review_decision = 'approved'
  AND jsonb_typeof(r.validation_errors) = 'array'
  AND jsonb_array_length(COALESCE(r.validation_errors, '[]'::jsonb)) > 0
GROUP BY 1
ORDER BY road_count DESC, issue_count DESC, error_code ASC
LIMIT 30;

\echo ''
\echo '=== Top validation_warnings codes (approved roads) ==='
\echo 'Supports object, string, and other JSON array element shapes.'

SELECT
    CASE
        WHEN jsonb_typeof(issue) = 'object' THEN
            upper(coalesce(issue->>'code', issue->>'message', '(no code)'))
        WHEN jsonb_typeof(issue) = 'string' THEN
            upper(trim(both '"' from issue::text))
        ELSE
            upper(issue::text)
    END AS warning_code,
    count(*)::int AS issue_count,
    count(DISTINCT r.id)::int AS road_count
FROM import_review.road_candidates AS r
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.validation_warnings, '[]'::jsonb)) AS issue
WHERE r.review_batch_id = :review_batch_id
  AND r.entity_family = 'roads'
  AND r.review_status = 'approved'
  AND r.review_decision = 'approved'
  AND jsonb_typeof(r.validation_warnings) = 'array'
  AND jsonb_array_length(COALESCE(r.validation_warnings, '[]'::jsonb)) > 0
GROUP BY 1
ORDER BY road_count DESC, issue_count DESC, warning_code ASC
LIMIT 30;

\echo ''
\echo '=== Excluded approved roads: primary blocker reason ==='
\echo 'Only roads not in eligible_core (and not promoted / not in active publish batch).'

WITH base AS (
    SELECT r.*
    FROM import_review.road_candidates AS r
    WHERE r.review_batch_id = :review_batch_id
      AND r.entity_family = 'roads'
      AND r.review_status = 'approved'
      AND r.review_decision = 'approved'
),
eligible_core AS (
    SELECT b.id
    FROM base AS b
    WHERE b.promotion_status IS DISTINCT FROM 'promoted'
      AND b.review_status IS DISTINCT FROM 'promoted'
      AND NOT (
          b.validation_errors IS NOT NULL
          AND jsonb_typeof(b.validation_errors) = 'array'
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(b.validation_errors) AS issue
              WHERE jsonb_typeof(issue) = 'object'
                AND coalesce(issue->>'severity', 'error') = 'error'
                AND upper(coalesce(issue->>'code', '')) IN (
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
      AND NOT EXISTS (
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
          OR NOT EXISTS (
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
          AND nullif(trim(coalesce(b.normalized_data->>'highway', '')), '') IS NULL
          AND nullif(trim(coalesce(b.review_overrides->>'highway', '')), '') IS NULL
      )
),
excluded AS (
    SELECT b.*
    FROM base AS b
    WHERE b.id NOT IN (SELECT id FROM eligible_core)
      AND b.promotion_status IS DISTINCT FROM 'promoted'
      AND b.review_status IS DISTINCT FROM 'promoted'
      AND NOT EXISTS (
          SELECT 1
          FROM system.system_publish_items AS spi
          INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
          WHERE spi.review_candidate_table = 'import_review.road_candidates'
            AND spi.review_candidate_id = b.id
            AND spb.status IN ('draft', 'validating', 'validated', 'promoting')
      )
)
SELECT
    blocker_reason,
    count(*)::int AS road_count
FROM (
    SELECT
        b.id,
        CASE
            WHEN b.match_status IN ('duplicate_candidate', 'possible_duplicate')
                 AND b.review_decision IS DISTINCT FROM 'merged'
                 AND trim(coalesce(b.review_note, '')) = '' THEN 'duplicate_unconfirmed'
            WHEN b.match_status = 'manual_protected' OR b.auto_action = 'protect_manual' THEN 'manual_protected'
            WHEN EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(b.validation_errors, '[]'::jsonb)) AS issue
                WHERE jsonb_typeof(issue) = 'object'
                  AND coalesce(issue->>'severity', 'error') = 'error'
                  AND upper(coalesce(issue->>'code', '')) IN (
                      'GEOMETRY_MISSING', 'GEOMETRY_INVALID', 'GEOMETRY_EMPTY',
                      'INVALID_GEOMETRY_TYPE', 'INVALID_SRID', 'INVALID_COORDINATES',
                      'ROAD_CLASS_MISSING', 'DUPLICATE_EXTERNAL_ID_IN_CORE'
                  )
            ) THEN 'promotion_blocking_validation_errors'
            WHEN b.external_id IS NOT NULL
                 AND trim(b.external_id) <> ''
                 AND b.matched_core_id IS NULL
                 AND EXISTS (
                     SELECT 1
                     FROM core.core_streets AS cs
                     WHERE cs.external_id = b.external_id
                       AND coalesce(cs.is_active, true)
                       AND cs.deleted_at IS NULL
                 ) THEN 'duplicate_external_id_in_core'
            WHEN b.road_class_id IS NULL
                 AND nullif(trim(coalesce(b.class_code, '')), '') IS NULL
                 AND nullif(trim(coalesce(b.normalized_data->>'highway', '')), '') IS NULL
                 AND nullif(trim(coalesce(b.review_overrides->>'highway', '')), '') IS NULL
                THEN 'road_class_missing_no_fallback'
            ELSE 'other_excluded'
        END AS blocker_reason
    FROM excluded AS b
) AS tagged
GROUP BY blocker_reason
ORDER BY road_count DESC, blocker_reason ASC;
