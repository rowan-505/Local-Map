-- Prompt 10 — Small core inspect (READ-ONLY)
SELECT 'places' AS family,
  count(*) FILTER (WHERE deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
  count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external,
  count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL AND source_type_id = 1) AS osm_source_no_external,
  count(*) FILTER (WHERE deleted_at IS NULL AND category_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ref.ref_poi_categories c WHERE c.id = p.category_id)) AS bad_category,
  count(*) FILTER (WHERE deleted_at IS NULL AND nullif(btrim(primary_name), '') IS NULL) AS missing_name,
  count(*) FILTER (WHERE deleted_at IS NULL AND point_geom IS NOT NULL AND NOT ST_IsValid(point_geom)) AS invalid_geom
FROM core.core_places p;

SELECT language_code, count(*) FROM core.core_place_names GROUP BY 1 ORDER BY 2 DESC;

SELECT 'buildings' AS family,
  count(*) FILTER (WHERE deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
  count(*) FILTER (WHERE deleted_at IS NULL AND building_type_id IS NULL) AS null_type,
  count(*) FILTER (WHERE deleted_at IS NULL AND building_type_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ref.ref_building_types t WHERE t.id = b.building_type_id)) AS bad_type,
  count(*) FILTER (WHERE deleted_at IS NULL AND geom IS NOT NULL AND NOT ST_IsValid(geom)) AS invalid_geom
FROM core.core_buildings b;

SELECT 'landuse' AS family,
  count(*) FILTER (WHERE deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
  count(*) FILTER (WHERE deleted_at IS NULL
    AND class_code IS DISTINCT FROM (SELECT code FROM ref.ref_land_area_classes c WHERE c.id = l.land_area_class_id)) AS class_mismatch
FROM core.core_land_areas l;

SELECT 'water_lines' AS family, count(*) FILTER (WHERE deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE deleted_at IS NULL AND geom IS NOT NULL AND NOT ST_IsValid(geom)) AS invalid_geom
FROM core.core_water_lines
UNION ALL
SELECT 'water_polygons', count(*) FILTER (WHERE deleted_at IS NULL),
  count(*) FILTER (WHERE deleted_at IS NULL AND geom IS NOT NULL AND NOT ST_IsValid(geom))
FROM core.core_water_polygons;

SELECT 'stops' AS family, count(*) FILTER (WHERE deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin
FROM transport.stops
UNION ALL
SELECT 'terminals', count(*) FILTER (WHERE deleted_at IS NULL),
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL)
FROM transport.terminals
UNION ALL
SELECT 'infra', count(*) FILTER (WHERE deleted_at IS NULL),
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL)
FROM transport.infrastructure_lines;
