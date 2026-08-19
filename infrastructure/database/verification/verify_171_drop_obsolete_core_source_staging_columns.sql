-- Post-migration verification for 171_drop_obsolete_core_source_staging_columns.sql.
-- Read-only. Every query should return the stated result or inspection metrics.

-- Expected: zero rows.
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name IN (
      'core_buildings',
      'core_land_areas',
      'core_water_lines',
      'core_water_polygons'
  )
  AND column_name = 'source_staging_id';

-- Expected: 24 rows (six durable provenance columns for each Core table).
SELECT table_name, count(*) AS durable_provenance_columns
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name IN (
      'core_buildings',
      'core_land_areas',
      'core_water_lines',
      'core_water_polygons'
  )
  AND column_name IN (
      'source_registry_id',
      'source_snapshot_id',
      'source_feature_type',
      'source_feature_id',
      'external_id',
      'source_refs'
  )
GROUP BY table_name
ORDER BY table_name;

-- Capture and compare these row counts with the immediate pre-migration check.
SELECT 'core.core_buildings' AS object, count(*)::bigint AS row_count
FROM core.core_buildings
UNION ALL
SELECT 'core.core_land_areas', count(*)::bigint FROM core.core_land_areas
UNION ALL
SELECT 'core.core_water_lines', count(*)::bigint FROM core.core_water_lines
UNION ALL
SELECT 'core.core_water_polygons', count(*)::bigint FROM core.core_water_polygons
ORDER BY object;

-- Geometry presence, SRID, type, and validity metrics must match the immediate
-- pre-migration check. The migration does not read or write geometry.
SELECT
    'core.core_buildings' AS object,
    count(*) FILTER (WHERE geom IS NOT NULL)::bigint AS geometry_rows,
    count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint AS wrong_srid,
    count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint AS invalid_geometry
FROM core.core_buildings
UNION ALL
SELECT
    'core.core_land_areas',
    count(*) FILTER (WHERE geom IS NOT NULL)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint
FROM core.core_land_areas
UNION ALL
SELECT
    'core.core_water_lines',
    count(*) FILTER (WHERE geom IS NOT NULL)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint
FROM core.core_water_lines
UNION ALL
SELECT
    'core.core_water_polygons',
    count(*) FILTER (WHERE geom IS NOT NULL)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint,
    count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint
FROM core.core_water_polygons
ORDER BY object;
