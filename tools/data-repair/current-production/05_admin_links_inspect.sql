-- Prompt 4 — Inspect missing / wrong-level admin links (READ-ONLY)

\echo '=== Missing admin by family ==='
SELECT 'places' AS family,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL) AS has_admin
FROM core.core_places
UNION ALL
SELECT 'buildings',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_map_buildings
UNION ALL
SELECT 'landuse',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_map_landuse
UNION ALL
SELECT 'streets',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_streets
UNION ALL
SELECT 'stops',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.stops
UNION ALL
SELECT 'terminals',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.terminals
UNION ALL
SELECT 'infrastructure_lines',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.infrastructure_lines;

\echo '=== Streets with non-township admin (sample count) ==='
SELECT al.code, count(*)
FROM core.core_streets s
JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE s.deleted_at IS NULL
GROUP BY 1
ORDER BY 2 DESC;
