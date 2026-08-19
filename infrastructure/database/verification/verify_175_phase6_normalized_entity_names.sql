SELECT 'buildings' AS entity,
       count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL)::bigint AS scalar_nonblank,
       count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM core.core_building_names n WHERE n.building_id=e.id AND n.name=e.name
       ))::bigint AS scalar_not_represented
FROM core.core_buildings e
UNION ALL
SELECT 'land_areas', count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL),
       count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM core.core_land_area_names n WHERE n.land_area_id=e.id AND n.name=e.name
       ))
FROM core.core_land_areas e
UNION ALL
SELECT 'water_lines', count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL),
       count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM core.core_water_line_names n WHERE n.water_line_id=e.id AND n.name=e.name
       ))
FROM core.core_water_lines e
UNION ALL
SELECT 'water_polygons', count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL),
       count(*) FILTER (WHERE nullif(btrim(e.name), '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM core.core_water_polygon_names n WHERE n.water_polygon_id=e.id AND n.name=e.name
       ))
FROM core.core_water_polygons e
ORDER BY entity;

SELECT table_name, language_code, count(*)::bigint AS rows
FROM (
  SELECT 'core_building_names' AS table_name, language_code FROM core.core_building_names
  UNION ALL SELECT 'core_land_area_names', language_code FROM core.core_land_area_names
  UNION ALL SELECT 'core_water_line_names', language_code FROM core.core_water_line_names
  UNION ALL SELECT 'core_water_polygon_names', language_code FROM core.core_water_polygon_names
) names
GROUP BY table_name, language_code
ORDER BY table_name, language_code;
