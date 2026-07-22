-- Prompt 4 — Verify admin links

SELECT 'places' AS family,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL) AS has_admin
FROM core.core_places
UNION ALL SELECT 'buildings',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_map_buildings
UNION ALL SELECT 'landuse',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_map_landuse
UNION ALL SELECT 'streets',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM core.core_streets
UNION ALL SELECT 'stops',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.stops
UNION ALL SELECT 'terminals',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.terminals
UNION ALL SELECT 'infrastructure_lines',
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NOT NULL)
FROM transport.infrastructure_lines;
