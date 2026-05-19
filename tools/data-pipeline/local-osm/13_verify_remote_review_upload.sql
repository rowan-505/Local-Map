-- =============================================================================
-- Stage L: verify_remote_review_upload (LOCAL database only)
-- -----------------------------------------------------------------------------
-- Confirms Stage K metadata on `system.system_remote_review_packages` and
-- linkage on `system.system_remote_review_package_items` after uploading to Supabase import_review.
--
-- Run deliberately with psql against LOCAL_DATABASE_URL (never auto-executed by Stage K).
--
-- psql vars:
--   package_name  (required) — same as REMOTE_REVIEW_PACKAGE_NAME / Stage J -v package_name=
--
-- Example (from this directory):
--   export LOCAL_DATABASE_URL='postgresql://...'
--   PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v package_name='your_remote_review_pkg_here' \
--        -f ./13_verify_remote_review_upload.sql
--
-- If you omit -v package_name or pass an empty value, PostgreSQL rejects the guard SELECT
-- (invalid integer cast) instead of silently returning zero rows.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

-- Fail fast when :package_name is missing/blank (clear invalid cast message from PostgreSQL).
SELECT CAST(
        CASE WHEN NULLIF(trim(:'package_name'), '') IS NULL THEN
            E'missing_package_name:_use_-v_package_name_same_as_REMOTE_REVIEW_PACKAGE_NAME'
        ELSE
            '0'
        END AS integer)
    AS _package_name_guard;

WITH tgt AS (
    SELECT *
      FROM system.system_remote_review_packages
     WHERE package_name = trim(:'package_name')
     LIMIT 1
)
SELECT
    'local_package'::text                          AS slice,
    t.id                                           AS package_id,
    t.package_name,
    t.snapshot_version,
    t.uploaded_at,
    t.remote_review_batch_id,
    t.remote_upload_status,
    left(coalesce(t.note, ''), 400)                AS note_prefix,
    t.total_item_count
FROM tgt t;

WITH tgt AS (
    SELECT id AS package_id
      FROM system.system_remote_review_packages
     WHERE package_name = trim(:'package_name')
     LIMIT 1
)
SELECT
    'local_items_aggregate'::text                    AS slice,
    i.upload_status,
    count(*)                                         AS rows_n,
    count(*) FILTER (WHERE i.remote_candidate_id IS NOT NULL) AS with_remote_candidate_id
FROM tgt
JOIN system.system_remote_review_package_items AS i ON i.package_id = tgt.package_id
GROUP BY i.upload_status
ORDER BY i.upload_status;

WITH tgt AS (
    SELECT id AS package_id
      FROM system.system_remote_review_packages
     WHERE package_name = trim(:'package_name')
     LIMIT 1
)
SELECT
    'local_items_by_family'::text                  AS slice,
    i.entity_family,
    count(*)                                         AS rows_n,
    count(*) FILTER (WHERE i.remote_candidate_id IS NOT NULL) AS with_remote_candidate_id,
    count(*) FILTER (WHERE coalesce(trim(i.upload_status), '') <> 'pending') AS non_pending_upload_status
FROM tgt
JOIN system.system_remote_review_package_items AS i ON i.package_id = tgt.package_id
GROUP BY i.entity_family
ORDER BY i.entity_family;

\echo Verification complete (LOCAL only).


-- -----------------------------------------------------------------------------
-- README: verify the same upload on Supabase (import_review schema)
-- -----------------------------------------------------------------------------
-- Use psql with SUPABASE_DATABASE_URL. Replace literals with your REMOTE_REVIEW_PACKAGE_NAME /
-- Stage J batch_name (stored as import_review.review_batches.batch_name).
--
-- SELECT id,
--        batch_name,
--        source_snapshot_version,
--        source_snapshot_id_local,
--        region_code,
--        entity_families,
--        total_candidate_count,
--        uploaded_candidate_count,
--        preserved_reviewed_count,
--        skipped_count,
--        status,
--        summary -> 'stage_k_upload' AS stage_k_upload_patch,
--        uploaded_at
--   FROM import_review.review_batches
--  WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
--  LIMIT 5;
--
-- WITH b AS (
--   SELECT id FROM import_review.review_batches
--    WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>' LIMIT 1
-- )
-- SELECT 'buildings' AS entity_family, count(*) FROM import_review.building_candidates c JOIN b ON b.id = c.review_batch_id
-- UNION ALL
-- SELECT 'places', count(*) FROM import_review.place_candidates c JOIN b ON b.id = c.review_batch_id
-- UNION ALL
-- SELECT 'roads', count(*) FROM import_review.road_candidates c JOIN b ON b.id = c.review_batch_id;
--
-- WITH b AS (
--   SELECT id FROM import_review.review_batches
--    WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>' LIMIT 1
-- ),
-- allc AS (
--   SELECT 'buildings'::text AS f, review_decision, review_status FROM import_review.building_candidates c JOIN b ON b.id = c.review_batch_id
--   UNION ALL
--   SELECT 'places', review_decision, review_status FROM import_review.place_candidates c JOIN b ON b.id = c.review_batch_id
--   UNION ALL
--   SELECT 'roads', review_decision, review_status FROM import_review.road_candidates c JOIN b ON b.id = c.review_batch_id
-- )
-- SELECT f,
--        count(*) FILTER (WHERE NOT (review_decision IS NULL AND review_status = 'pending')) AS non_refreshable_rows,
--        count(*) FILTER (WHERE review_decision IS NULL AND review_status = 'pending') AS pending_blank_decision_rows
--   FROM allc
--  GROUP BY f
--  ORDER BY f;
