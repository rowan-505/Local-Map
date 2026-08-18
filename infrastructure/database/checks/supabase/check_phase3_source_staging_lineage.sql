-- Read-only pre/post checks for Phase 3 source_staging_id cleanup.
\set ON_ERROR_STOP on

SELECT nspname AS staging_schema
FROM pg_namespace
WHERE nspname = 'staging';

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default,
  is_generated
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name IN (
    'core_buildings',
    'core_land_areas',
    'core_water_lines',
    'core_water_polygons'
  )
  AND column_name IN (
    'source_staging_id',
    'source_registry_id',
    'source_snapshot_id',
    'source_feature_type',
    'source_feature_id',
    'external_id',
    'source_refs',
    'normalized_data',
    'geom'
  )
ORDER BY table_name, column_name;

SELECT
  'core_buildings' AS object,
  count(*) AS total,
  count(*) FILTER (WHERE source_staging_id IS NOT NULL) AS staging_nonnull,
  count(*) FILTER (
    WHERE source_staging_id IS NOT NULL
      AND nullif(btrim(external_id), '') IS NOT NULL
  ) AS has_external,
  count(*) FILTER (
    WHERE source_staging_id IS NOT NULL
      AND source_registry_id IS NOT NULL
      AND source_feature_type IS NOT NULL
      AND source_feature_id IS NOT NULL
  ) AS has_typed_identity,
  count(*) FILTER (
    WHERE source_staging_id IS NOT NULL
      AND source_snapshot_id IS NOT NULL
  ) AS has_snapshot,
  count(*) FILTER (
    WHERE source_staging_id IS NOT NULL
      AND (
        normalized_data ->> 'local_staging_id' = source_staging_id::text
        OR source_refs ->> 'local_staging_id' = source_staging_id::text
        OR source_refs ->> 'source_staging_id' = source_staging_id::text
      )
  ) AS staging_id_duplicated_in_json,
  count(*) FILTER (
    WHERE source_staging_id IS NOT NULL
      AND nullif(btrim(external_id), '') IS NULL
      AND NOT (
        source_registry_id IS NOT NULL
        AND source_feature_type IS NOT NULL
        AND source_feature_id IS NOT NULL
      )
  ) AS lacks_durable_identity
FROM core.core_buildings
UNION ALL
SELECT
  'core_land_areas', count(*),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_snapshot_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND (normalized_data ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'source_staging_id' = source_staging_id::text)),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NULL AND NOT (source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL))
FROM core.core_land_areas
UNION ALL
SELECT
  'core_water_lines', count(*),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_snapshot_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND (normalized_data ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'source_staging_id' = source_staging_id::text)),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NULL AND NOT (source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL))
FROM core.core_water_lines
UNION ALL
SELECT
  'core_water_polygons', count(*),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND source_snapshot_id IS NOT NULL),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND (normalized_data ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'local_staging_id' = source_staging_id::text OR source_refs ->> 'source_staging_id' = source_staging_id::text)),
  count(*) FILTER (WHERE source_staging_id IS NOT NULL AND nullif(btrim(external_id), '') IS NULL AND NOT (source_registry_id IS NOT NULL AND source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL))
FROM core.core_water_polygons
ORDER BY object;

SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  i.relname AS index_name,
  pg_get_indexdef(i.oid) AS definition
FROM pg_class AS t
JOIN pg_namespace AS n ON n.oid = t.relnamespace
JOIN pg_index AS x ON x.indrelid = t.oid
JOIN pg_class AS i ON i.oid = x.indexrelid
JOIN pg_attribute AS a
  ON a.attrelid = t.oid
 AND a.attname = 'source_staging_id'
WHERE n.nspname = 'core'
  AND t.relname IN ('core_buildings', 'core_land_areas', 'core_water_lines', 'core_water_polygons')
  AND a.attnum = ANY (x.indkey)
ORDER BY table_name, index_name;

SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  a.attname,
  pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object,
  d.deptype
FROM pg_class AS t
JOIN pg_namespace AS n ON n.oid = t.relnamespace
JOIN pg_attribute AS a
  ON a.attrelid = t.oid
 AND a.attname = 'source_staging_id'
JOIN pg_depend AS d
  ON d.refclassid = 'pg_class'::regclass
 AND d.refobjid = t.oid
 AND d.refobjsubid = a.attnum
WHERE n.nspname = 'core'
  AND t.relname IN ('core_buildings', 'core_land_areas', 'core_water_lines', 'core_water_polygons')
ORDER BY table_name, dependent_object;

SELECT 'view' AS kind, schemaname AS schema_name, viewname AS object_name
FROM pg_views
WHERE definition ILIKE '%source_staging_id%'
UNION ALL
SELECT 'materialized_view', schemaname, matviewname
FROM pg_matviews
WHERE definition ILIKE '%source_staging_id%'
UNION ALL
SELECT 'function', n.nspname, p.proname
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND (
    p.prosrc ILIKE '%source_staging_id%'
    OR pg_get_functiondef(p.oid) ILIKE '%source_staging_id%'
  )
ORDER BY kind, schema_name, object_name;

SELECT
  'trigger' AS kind,
  n.nspname AS schema_name,
  c.relname AS object_name,
  t.tgname AS detail
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND pg_get_triggerdef(t.oid) ILIKE '%source_staging_id%'
UNION ALL
SELECT
  'policy', schemaname, tablename, policyname
FROM pg_policies
WHERE coalesce(qual, '') ILIKE '%source_staging_id%'
   OR coalesce(with_check, '') ILIKE '%source_staging_id%';
