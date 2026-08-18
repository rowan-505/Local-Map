-- =============================================================================
-- Verification for migration 154 (read-only after apply)
-- =============================================================================

SELECT 'tables' AS section, c.relname, (xpath('count(//*)', query_to_xml(format('SELECT 1 FROM core.%I', c.relname), false, true, '')))[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'core'
  AND c.relkind = 'r'
  AND c.relname IN (
    'core_buildings','core_building_names','core_land_areas','core_land_area_names',
    'core_water_lines','core_water_line_names','core_water_polygons','core_water_polygon_names',
    'core_map_buildings','core_map_building_names','core_map_landuse','core_map_landuse_names',
    'core_map_water_lines','core_map_water_line_names','core_map_water_polygons','core_map_water_polygon_names'
  )
ORDER BY 2;

SELECT 'counts' AS section, * FROM (
  SELECT 'core_buildings' AS t, count(*)::bigint AS n FROM core.core_buildings
  UNION ALL SELECT 'core_building_names', count(*) FROM core.core_building_names
  UNION ALL SELECT 'core_land_areas', count(*) FROM core.core_land_areas
  UNION ALL SELECT 'core_land_area_names', count(*) FROM core.core_land_area_names
  UNION ALL SELECT 'core_water_lines', count(*) FROM core.core_water_lines
  UNION ALL SELECT 'core_water_line_names', count(*) FROM core.core_water_line_names
  UNION ALL SELECT 'core_water_polygons', count(*) FROM core.core_water_polygons
  UNION ALL SELECT 'core_water_polygon_names', count(*) FROM core.core_water_polygon_names
) s ORDER BY 2;

SELECT 'view_sql' AS section, v, (def ILIKE '%core_map_%') AS has_old, (def ILIKE '%core.core_buildings%' OR def ILIKE '%core.core_land_areas%' OR def ILIKE '%core.core_water_%') AS has_new
FROM (
  SELECT 'tiles.tiles_buildings_v' AS v, pg_get_viewdef('tiles.tiles_buildings_v'::regclass, true) AS def
  UNION ALL SELECT 'tiles.tiles_landuse_v', pg_get_viewdef('tiles.tiles_landuse_v'::regclass, true)
  UNION ALL SELECT 'tiles.tiles_water_lines_v', pg_get_viewdef('tiles.tiles_water_lines_v'::regclass, true)
  UNION ALL SELECT 'tiles.tiles_water_polygons_v', pg_get_viewdef('tiles.tiles_water_polygons_v'::regclass, true)
  UNION ALL SELECT 'search.v_search_buildings_source', pg_get_viewdef('search.v_search_buildings_source'::regclass, true)
  UNION ALL SELECT 'search.v_search_landuse_source', pg_get_viewdef('search.v_search_landuse_source'::regclass, true)
  UNION ALL SELECT 'search.v_search_water_lines_source', pg_get_viewdef('search.v_search_water_lines_source'::regclass, true)
  UNION ALL SELECT 'search.v_search_water_polygons_source', pg_get_viewdef('search.v_search_water_polygons_source'::regclass, true)
) q;
