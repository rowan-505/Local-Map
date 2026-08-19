-- Read-only verification for migration 172.

-- Expected: zero rows.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name IN ('core_land_areas', 'core_water_lines', 'core_water_polygons')
  AND column_name = 'class_code';

-- Expected: null_id=0 and orphan_id=0 for every object.
SELECT 'core.core_land_areas' AS object,
  count(*) FILTER (WHERE x.land_area_class_id IS NULL)::bigint AS null_id,
  count(*) FILTER (WHERE r.id IS NULL)::bigint AS orphan_id
FROM core.core_land_areas x
LEFT JOIN ref.ref_land_area_classes r ON r.id = x.land_area_class_id
UNION ALL
SELECT 'core.core_water_lines',
  count(*) FILTER (WHERE x.water_class_id IS NULL)::bigint,
  count(*) FILTER (WHERE r.id IS NULL)::bigint
FROM core.core_water_lines x
LEFT JOIN ref.ref_water_classes r ON r.id = x.water_class_id
UNION ALL
SELECT 'core.core_water_polygons',
  count(*) FILTER (WHERE x.water_class_id IS NULL)::bigint,
  count(*) FILTER (WHERE r.id IS NULL)::bigint
FROM core.core_water_polygons x
LEFT JOIN ref.ref_water_classes r ON r.id = x.water_class_id;

-- Expected: 20 water lines and 26 polygons preserve the previous mismatched
-- classification explicitly in provenance.
SELECT 'core.core_water_lines' AS object,
  count(*) FILTER (WHERE normalized_data ? 'legacy_classification')::bigint AS preserved_legacy_classification
FROM core.core_water_lines
UNION ALL
SELECT 'core.core_water_polygons',
  count(*) FILTER (WHERE normalized_data ? 'legacy_classification')::bigint
FROM core.core_water_polygons;

-- Expected: zero rows; stored DB objects must no longer depend on dropped text.
SELECT 'view' AS kind, schemaname AS schema_name, viewname AS object_name
FROM pg_views
WHERE definition ~* 'core_(land_areas|water_lines|water_polygons)'
  AND definition ~* '\mclass_code\M'
UNION ALL
SELECT 'materialized view', schemaname, matviewname
FROM pg_matviews
WHERE definition ~* 'core_(land_areas|water_lines|water_polygons)'
  AND definition ~* '\mclass_code\M';

-- Inspection metrics: compare with the immediate pre-migration counts.
SELECT 'core.core_land_areas' AS object, count(*)::bigint AS row_count,
  count(*) FILTER (WHERE geom IS NOT NULL)::bigint AS geometry_rows,
  count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint AS wrong_srid
FROM core.core_land_areas
UNION ALL
SELECT 'core.core_water_lines', count(*)::bigint,
  count(*) FILTER (WHERE geom IS NOT NULL)::bigint,
  count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint
FROM core.core_water_lines
UNION ALL
SELECT 'core.core_water_polygons', count(*)::bigint,
  count(*) FILTER (WHERE geom IS NOT NULL)::bigint,
  count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint
FROM core.core_water_polygons;

SELECT 'tiles.tiles_landuse_v' AS object, count(*)::bigint AS row_count FROM tiles.tiles_landuse_v
UNION ALL SELECT 'tiles.tiles_water_lines_v', count(*)::bigint FROM tiles.tiles_water_lines_v
UNION ALL SELECT 'tiles.tiles_water_polygons_v', count(*)::bigint FROM tiles.tiles_water_polygons_v
UNION ALL SELECT 'search.v_search_landuse_source', count(*)::bigint FROM search.v_search_landuse_source
UNION ALL SELECT 'search.v_search_water_lines_source', count(*)::bigint FROM search.v_search_water_lines_source
UNION ALL SELECT 'search.v_search_water_polygons_source', count(*)::bigint FROM search.v_search_water_polygons_source;
