-- Read-only verification for migration 192 (canonical settlements schema).
-- Safe before or after apply. Does not modify data.

WITH base AS (
  SELECT
    to_regclass('ref.ref_settlement_types') AS types_reg,
    to_regclass('core.core_settlements') AS settlements_reg,
    to_regclass('core.core_places') AS places_reg
),
type_stats AS (
  SELECT
    CASE WHEN types_reg IS NULL THEN NULL ELSE (
      SELECT count(*) FROM ref.ref_settlement_types
      WHERE code IN ('city', 'town', 'village', 'local_area')
    ) END AS canonical_count,
    CASE WHEN types_reg IS NULL THEN NULL ELSE (
      SELECT count(*) FROM ref.ref_settlement_types
      WHERE code NOT IN ('city', 'town', 'village', 'local_area')
    ) END AS extra_count,
    CASE WHEN types_reg IS NULL THEN NULL ELSE (
      SELECT string_agg(code, ',' ORDER BY sort_order, code)
      FROM ref.ref_settlement_types
    ) END AS codes
  FROM base
),
geom AS (
  SELECT
    CASE WHEN settlements_reg IS NULL THEN NULL ELSE (
      SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute AS a
      WHERE a.attrelid = settlements_reg
        AND a.attname = 'point_geom'
        AND NOT a.attisdropped
    ) END AS point_type,
    CASE WHEN settlements_reg IS NULL THEN NULL ELSE (
      SELECT a.attnotnull
      FROM pg_attribute AS a
      WHERE a.attrelid = settlements_reg
        AND a.attname = 'point_geom'
        AND NOT a.attisdropped
    ) END AS point_not_null,
    CASE WHEN settlements_reg IS NULL THEN NULL ELSE (
      SELECT format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute AS a
      WHERE a.attrelid = settlements_reg
        AND a.attname = 'footprint_geom'
        AND NOT a.attisdropped
    ) END AS footprint_type,
    CASE WHEN settlements_reg IS NULL THEN NULL ELSE (
      SELECT a.attnotnull
      FROM pg_attribute AS a
      WHERE a.attrelid = settlements_reg
        AND a.attname = 'footprint_geom'
        AND NOT a.attisdropped
    ) END AS footprint_not_null
  FROM base
),
fks AS (
  SELECT
    CASE WHEN settlements_reg IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = settlements_reg
        AND conname = 'core_settlements_settlement_type_id_fkey'
        AND contype = 'f'
    ) END AS type_fk,
    CASE WHEN settlements_reg IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = settlements_reg
        AND conname = 'core_settlements_township_id_fkey'
        AND contype = 'f'
    ) END AS township_fk,
    CASE WHEN settlements_reg IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = settlements_reg
        AND conname = 'core_settlements_source_type_id_fkey'
        AND contype = 'f'
    ) END AS source_fk
  FROM base
),
idx AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'core' AND tablename = 'core_settlements'
        AND indexname = 'core_settlements_point_geom_gix'
    ) AS point_gix,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'core' AND tablename = 'core_settlements'
        AND indexname = 'core_settlements_footprint_geom_gix'
    ) AS footprint_gix,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'core' AND tablename = 'core_settlements'
        AND indexname = 'core_settlements_settlement_type_id_idx'
    ) AS type_idx,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'core' AND tablename = 'core_settlements'
        AND indexname = 'core_settlements_township_id_idx'
    ) AS township_idx,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'core' AND tablename = 'core_settlements'
        AND indexname = 'core_settlements_external_id_idx'
    ) AS external_idx,
    CASE WHEN settlements_reg IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = settlements_reg
        AND contype IN ('u', 'p')
        AND pg_get_constraintdef(oid) ILIKE '%canonical_name%'
    ) END AS name_unique
  FROM base
),
counts AS (
  SELECT
    CASE WHEN settlements_reg IS NULL THEN NULL ELSE (
      SELECT count(*) FROM core.core_settlements
    ) END AS settlement_rows,
    CASE WHEN places_reg IS NULL THEN NULL ELSE (
      SELECT count(*) FROM core.core_places
    ) END AS place_rows
  FROM base
)
SELECT check_name, status, detail
FROM (
  SELECT 'ref.ref_settlement_types exists' AS check_name,
         CASE WHEN types_reg IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN types_reg IS NOT NULL THEN 'table' ELSE 'not applied' END AS detail
  FROM base
  UNION ALL
  SELECT 'core.core_settlements exists',
         CASE WHEN settlements_reg IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN settlements_reg IS NOT NULL THEN 'table' ELSE 'not applied' END
  FROM base
  UNION ALL
  SELECT 'exactly four canonical types',
         CASE
           WHEN types_reg IS NULL THEN 'FAIL'
           WHEN canonical_count = 4 AND extra_count = 0 THEN 'PASS'
           ELSE 'FAIL'
         END,
         coalesce(codes, 'types table missing')
  FROM base
  CROSS JOIN type_stats
  UNION ALL
  SELECT 'no hamlet/quarter/suburb/neighbourhood/locality types',
         CASE
           WHEN types_reg IS NULL THEN 'FAIL'
           WHEN extra_count = 0 THEN 'PASS'
           ELSE 'FAIL'
         END,
         'source metadata only'
  FROM base
  CROSS JOIN type_stats
  UNION ALL
  SELECT 'settlement_type_id FK',
         CASE WHEN type_fk THEN 'PASS' ELSE 'FAIL' END,
         'ref.ref_settlement_types'
  FROM fks
  UNION ALL
  SELECT 'township_id FK',
         CASE WHEN township_fk THEN 'PASS' ELSE 'FAIL' END,
         'core.core_admin_areas'
  FROM fks
  UNION ALL
  SELECT 'source_type_id FK',
         CASE WHEN source_fk THEN 'PASS' ELSE 'FAIL' END,
         'ref.ref_source_types'
  FROM fks
  UNION ALL
  SELECT 'point_geom is Point 4326 NOT NULL',
         CASE WHEN point_type = 'geometry(Point,4326)' AND point_not_null THEN 'PASS' ELSE 'FAIL' END,
         coalesce(point_type, 'missing')
  FROM geom
  UNION ALL
  SELECT 'footprint_geom is MultiPolygon 4326 NULL',
         CASE WHEN footprint_type = 'geometry(MultiPolygon,4326)' AND NOT coalesce(footprint_not_null, true) THEN 'PASS' ELSE 'FAIL' END,
         coalesce(footprint_type, 'missing')
  FROM geom
  UNION ALL
  SELECT 'index core_settlements_point_geom_gix',
         CASE WHEN point_gix THEN 'PASS' ELSE 'FAIL' END,
         'GIST(point_geom)'
  FROM idx
  UNION ALL
  SELECT 'index core_settlements_footprint_geom_gix',
         CASE WHEN footprint_gix THEN 'PASS' ELSE 'FAIL' END,
         'GIST(footprint_geom) WHERE NOT NULL'
  FROM idx
  UNION ALL
  SELECT 'index core_settlements_settlement_type_id_idx',
         CASE WHEN type_idx THEN 'PASS' ELSE 'FAIL' END,
         'btree'
  FROM idx
  UNION ALL
  SELECT 'index core_settlements_township_id_idx',
         CASE WHEN township_idx THEN 'PASS' ELSE 'FAIL' END,
         'btree partial'
  FROM idx
  UNION ALL
  SELECT 'index core_settlements_external_id_idx',
         CASE WHEN external_idx THEN 'PASS' ELSE 'FAIL' END,
         'btree partial, not unique'
  FROM idx
  UNION ALL
  SELECT 'no name uniqueness constraint',
         CASE
           WHEN (SELECT settlements_reg FROM base) IS NULL THEN 'FAIL'
           WHEN name_unique THEN 'FAIL'
           ELSE 'PASS'
         END,
         'canonical_name is not unique'
  FROM idx
  UNION ALL
  SELECT 'core.core_settlements is empty',
         CASE
           WHEN settlement_rows IS NULL THEN 'FAIL'
           WHEN settlement_rows = 0 THEN 'PASS'
           ELSE 'FAIL'
         END,
         coalesce(settlement_rows::text, 'table missing')
  FROM counts
  UNION ALL
  SELECT 'core.core_places still exists',
         CASE WHEN places_reg IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         coalesce(place_rows::text, 'missing') || ' rows'
  FROM base
  CROSS JOIN counts
) AS report
ORDER BY check_name;
