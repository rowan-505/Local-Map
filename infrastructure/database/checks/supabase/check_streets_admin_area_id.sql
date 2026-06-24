-- =============================================================================
-- check_streets_admin_area_id.sql
-- =============================================================================
-- Supabase validation entry point (read-only).
-- Full report + overlap spot-check lives in:
--   tools/data-pipeline/admin-hierarchy-repair/verify_roads_admin_area_id.sql
--
-- Run from that folder:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f tools/data-pipeline/admin-hierarchy-repair/verify_roads_admin_area_id.sql
--
-- Backfill (chunked loop):
--   cd tools/data-pipeline/admin-hierarchy-repair && \
--     CONFIRM_WRITE=true ./run_05_roads_loop.sh imports/<name>.env
-- =============================================================================

\echo 'Use tools/data-pipeline/admin-hierarchy-repair/verify_roads_admin_area_id.sql for the full report.'
\echo 'Quick health gates below (all core.core_streets rows).'

\set ON_ERROR_STOP on

WITH streets AS (
    SELECT
        s.id,
        s.admin_area_id,
        aa.id AS linked_id,
        aa.is_active AS linked_is_active,
        aa.deleted_at AS linked_deleted_at,
        al.code AS level_code,
        al.name AS level_name
    FROM core.core_streets AS s
    LEFT JOIN core.core_admin_areas AS aa ON aa.id = s.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
),
classified AS (
    SELECT
        CASE
            WHEN admin_area_id IS NULL THEN 'null'
            WHEN linked_id IS NULL THEN 'broken_fk'
            WHEN linked_is_active IS NOT TRUE OR linked_deleted_at IS NOT NULL THEN 'broken_fk'
            WHEN lower(btrim(coalesce(level_code, ''))) IN ('township', 'town')
                 OR lower(btrim(coalesce(level_name, ''))) IN ('township', 'town')
                THEN 'township'
            ELSE 'non_township'
        END AS quality_kind
    FROM streets
)
SELECT 'streets_admin_area_audit' AS check_name, quality_kind, count(*)::bigint AS road_count
FROM classified
GROUP BY quality_kind
ORDER BY road_count DESC;
