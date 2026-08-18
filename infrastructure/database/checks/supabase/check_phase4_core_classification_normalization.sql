-- Read-only production audit for Phase 4 Core classification normalization.

SET statement_timeout = '120s';
SET lock_timeout = '3s';

-- Column definitions and physical order.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    a.attnum,
    a.attname AS column_name,
    format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull AS not_null,
    pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute AS a
JOIN pg_class AS c ON c.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'core'
  AND c.relname IN ('core_streets', 'core_land_areas', 'core_water_lines', 'core_water_polygons', 'core_buildings')
  AND a.attname IN ('road_class_id', 'road_class', 'land_area_class_id', 'water_class_id', 'building_type_id', 'class_code', 'building_type')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- FK definitions and validation state.
SELECT
    con.conrelid::regclass AS source_table,
    con.conname,
    pg_get_constraintdef(con.oid) AS definition,
    con.convalidated
FROM pg_constraint AS con
WHERE con.contype = 'f'
  AND con.conrelid IN (
      'core.core_streets'::regclass,
      'core.core_land_areas'::regclass,
      'core.core_water_lines'::regclass,
      'core.core_water_polygons'::regclass,
      'core.core_buildings'::regclass
  )
ORDER BY con.conrelid::regclass::text, con.conname;

-- Normalized-ID coverage, orphan IDs, and canonical-code mismatches.
SELECT
    'core.core_streets' AS object,
    count(*)::bigint AS total_rows,
    count(*) FILTER (WHERE s.road_class_id IS NULL)::bigint AS normalized_id_null,
    count(*) FILTER (WHERE s.road_class_id IS NOT NULL AND rc.id IS NULL)::bigint AS orphan_id,
    count(*) FILTER (WHERE s.road_class IS NULL OR btrim(s.road_class) = '')::bigint AS legacy_text_null_or_blank,
    count(*) FILTER (
        WHERE rc.id IS NOT NULL
          AND nullif(btrim(s.road_class), '') IS DISTINCT FROM rc.code
    )::bigint AS canonical_code_mismatch
FROM core.core_streets AS s
LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
UNION ALL
SELECT
    'core.core_land_areas',
    count(*)::bigint,
    count(*) FILTER (WHERE l.land_area_class_id IS NULL)::bigint,
    count(*) FILTER (WHERE l.land_area_class_id IS NOT NULL AND lc.id IS NULL)::bigint,
    count(*) FILTER (WHERE l.class_code IS NULL OR btrim(l.class_code) = '')::bigint,
    count(*) FILTER (
        WHERE lc.id IS NOT NULL
          AND nullif(btrim(l.class_code), '') IS DISTINCT FROM lc.code
    )::bigint
FROM core.core_land_areas AS l
LEFT JOIN ref.ref_land_area_classes AS lc ON lc.id = l.land_area_class_id
UNION ALL
SELECT
    'core.core_water_lines',
    count(*)::bigint,
    count(*) FILTER (WHERE w.water_class_id IS NULL)::bigint,
    count(*) FILTER (WHERE w.water_class_id IS NOT NULL AND wc.id IS NULL)::bigint,
    count(*) FILTER (WHERE w.class_code IS NULL OR btrim(w.class_code) = '')::bigint,
    count(*) FILTER (
        WHERE wc.id IS NOT NULL
          AND nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
    )::bigint
FROM core.core_water_lines AS w
LEFT JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
UNION ALL
SELECT
    'core.core_water_polygons',
    count(*)::bigint,
    count(*) FILTER (WHERE w.water_class_id IS NULL)::bigint,
    count(*) FILTER (WHERE w.water_class_id IS NOT NULL AND wc.id IS NULL)::bigint,
    count(*) FILTER (WHERE w.class_code IS NULL OR btrim(w.class_code) = '')::bigint,
    count(*) FILTER (
        WHERE wc.id IS NOT NULL
          AND nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
    )::bigint
FROM core.core_water_polygons AS w
LEFT JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
UNION ALL
SELECT
    'core.core_buildings',
    count(*)::bigint,
    count(*) FILTER (WHERE b.building_type_id IS NULL)::bigint,
    count(*) FILTER (WHERE b.building_type_id IS NOT NULL AND bt.id IS NULL)::bigint,
    NULL::bigint,
    NULL::bigint
FROM core.core_buildings AS b
LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
ORDER BY object;

-- Mismatch distribution. Limits output to the largest categories.
SELECT *
FROM (
    SELECT
        'streets' AS entity,
        coalesce(nullif(btrim(s.road_class), ''), '(null)') AS legacy_code,
        coalesce(rc.code, '(missing ref)') AS canonical_code,
        count(*)::bigint AS row_count
    FROM core.core_streets AS s
    LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
    WHERE nullif(btrim(s.road_class), '') IS DISTINCT FROM rc.code
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT 'land_areas', coalesce(nullif(btrim(l.class_code), ''), '(null)'), coalesce(lc.code, '(missing ref)'), count(*)::bigint
    FROM core.core_land_areas AS l
    LEFT JOIN ref.ref_land_area_classes AS lc ON lc.id = l.land_area_class_id
    WHERE nullif(btrim(l.class_code), '') IS DISTINCT FROM lc.code
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT 'water_lines', coalesce(nullif(btrim(w.class_code), ''), '(null)'), coalesce(wc.code, '(missing ref)'), count(*)::bigint
    FROM core.core_water_lines AS w
    LEFT JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
    WHERE nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT 'water_polygons', coalesce(nullif(btrim(w.class_code), ''), '(null)'), coalesce(wc.code, '(missing ref)'), count(*)::bigint
    FROM core.core_water_polygons AS w
    LEFT JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
    WHERE nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code
    GROUP BY 1, 2, 3
) AS mismatches
ORDER BY row_count DESC, entity, legacy_code
LIMIT 100;

-- Indexes that directly contain legacy or normalized classification columns.
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'core'
  AND tablename IN ('core_streets', 'core_land_areas', 'core_water_lines', 'core_water_polygons', 'core_buildings')
  AND indexdef ~* '\m(road_class|road_class_id|class_code|land_area_class_id|water_class_id|building_type_id)\M'
ORDER BY tablename, indexname;

-- Views/materialized views and functions whose definitions mention the legacy columns.
SELECT 'view' AS kind, schemaname AS schema_name, viewname AS object_name
FROM pg_views
WHERE definition ~* '\m(road_class|class_code)\M'
UNION ALL
SELECT 'materialized view', schemaname, matviewname
FROM pg_matviews
WHERE definition ~* '\m(road_class|class_code)\M'
UNION ALL
SELECT 'function', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND pg_get_functiondef(p.oid) ~* '\m(road_class|class_code)\M'
ORDER BY kind, schema_name, object_name;

-- Triggers generated from legacy classifications.
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
      'core.core_water_polygons'::regclass,
      'core.core_buildings'::regclass
  )
ORDER BY t.tgrelid::regclass::text, t.tgname;
