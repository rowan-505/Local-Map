-- Focused read-only follow-up for Phase 4.
SET statement_timeout = '60s';

-- Street exceptions only (expected four rows from the aggregate audit).
SELECT
    s.id,
    s.external_id,
    s.road_class_id,
    s.road_class AS legacy_code,
    rc.code AS canonical_code,
    s.normalized_data->'tags'->>'highway' AS osm_highway,
    s.source_refs
FROM core.core_streets AS s
LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
WHERE s.road_class_id IS NULL
   OR nullif(btrim(s.road_class), '') IS DISTINCT FROM rc.code
ORDER BY s.id;

-- Water mismatch groups and whether the exact legacy value remains in provenance.
SELECT
    'water_lines' AS entity,
    w.class_code AS legacy_code,
    wc.code AS canonical_code,
    count(*)::bigint AS row_count,
    count(*) FILTER (
        WHERE w.normalized_data::text LIKE '%' || to_jsonb(w.class_code)::text || '%'
           OR w.source_refs::text LIKE '%' || to_jsonb(w.class_code)::text || '%'
    )::bigint AS legacy_value_in_provenance
FROM core.core_water_lines AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
WHERE nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
GROUP BY w.class_code, wc.code
UNION ALL
SELECT
    'water_polygons',
    w.class_code,
    wc.code,
    count(*)::bigint,
    count(*) FILTER (
        WHERE w.normalized_data::text LIKE '%' || to_jsonb(w.class_code)::text || '%'
           OR w.source_refs::text LIKE '%' || to_jsonb(w.class_code)::text || '%'
    )::bigint
FROM core.core_water_polygons AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
WHERE nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
GROUP BY w.class_code, wc.code
ORDER BY entity, row_count DESC, legacy_code;

-- Building rows that still need classification; original tags remain inspectable.
SELECT
    b.id,
    b.external_id,
    b.normalized_data->'tags'->>'building' AS osm_building,
    b.source_refs
FROM core.core_buildings AS b
WHERE b.building_type_id IS NULL
ORDER BY b.id;

-- Direct index coverage for normalized and legacy classification fields.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'core'
  AND tablename IN ('core_streets', 'core_land_areas', 'core_water_lines', 'core_water_polygons', 'core_buildings')
  AND indexdef ~* '\m(road_class|road_class_id|class_code|land_area_class_id|water_class_id|building_type_id)\M'
ORDER BY tablename, indexname;

-- Catalog dependencies attached to the exact legacy attributes.
SELECT
    a.attrelid::regclass AS source_table,
    a.attname AS source_column,
    d.classid::regclass AS dependent_catalog,
    d.objid,
    d.objsubid,
    d.deptype,
    pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object
FROM pg_attribute AS a
JOIN pg_depend AS d
  ON d.refclassid = 'pg_class'::regclass
 AND d.refobjid = a.attrelid
 AND d.refobjsubid = a.attnum
WHERE a.attrelid IN (
      'core.core_streets'::regclass,
      'core.core_land_areas'::regclass,
      'core.core_water_lines'::regclass,
      'core.core_water_polygons'::regclass
  )
  AND a.attname IN ('road_class', 'class_code')
ORDER BY a.attrelid::regclass::text, source_column, dependent_object;

-- Runtime DB objects whose stored definitions mention these Core columns.
SELECT 'view' AS kind, schemaname AS schema_name, viewname AS object_name
FROM pg_views
WHERE definition ~* 'core_(streets|land_areas|water_lines|water_polygons)'
  AND definition ~* '\m(road_class|class_code)\M'
UNION ALL
SELECT 'materialized view', schemaname, matviewname
FROM pg_matviews
WHERE definition ~* 'core_(streets|land_areas|water_lines|water_polygons)'
  AND definition ~* '\m(road_class|class_code)\M'
UNION ALL
SELECT 'function', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prosrc ~* 'core_(streets|land_areas|water_lines|water_polygons)'
  AND p.prosrc ~* '\m(road_class|class_code)\M'
ORDER BY kind, schema_name, object_name;

SELECT
    t.tgrelid::regclass AS source_table,
    t.tgname,
    pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger AS t
WHERE NOT t.tgisinternal
  AND t.tgrelid IN (
      'core.core_streets'::regclass,
      'core.core_land_areas'::regclass,
      'core.core_water_lines'::regclass,
      'core.core_water_polygons'::regclass
  )
ORDER BY t.tgrelid::regclass::text, t.tgname;

-- Estimated column widths; dropping a column is metadata-only and does not
-- immediately reclaim heap bytes without a later rewrite (not proposed here).
SELECT schemaname, tablename, attname, null_frac, avg_width, n_distinct
FROM pg_stats
WHERE schemaname = 'core'
  AND tablename IN ('core_streets', 'core_land_areas', 'core_water_lines', 'core_water_polygons')
  AND attname IN ('road_class', 'class_code')
ORDER BY tablename, attname;
