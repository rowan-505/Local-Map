-- =============================================================================
-- Read-only verification: core_buildings typed source identity
-- =============================================================================
--
-- Run the complete script after migration 149.
-- Before migration, section 1 may be run independently as a read-only preflight;
-- later sections intentionally reference the new columns.
--
-- This script starts a read-only transaction and performs no writes.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

-- 1. Required additive columns and their effective definitions.
SELECT
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default
FROM information_schema.columns AS c
WHERE c.table_schema = 'core'
  AND c.table_name = 'core_buildings'
  AND c.column_name IN (
      'source_registry_id',
      'source_snapshot_id',
      'source_feature_type',
      'source_feature_id',
      'region_code',
      'is_geometry_manually_edited',
      'is_attributes_manually_edited'
  )
ORDER BY c.ordinal_position;

-- Expected after migration: 7 rows.
SELECT
    count(*) AS required_column_count,
    count(*) = 7 AS passes
FROM information_schema.columns AS c
WHERE c.table_schema = 'core'
  AND c.table_name = 'core_buildings'
  AND c.column_name IN (
      'source_registry_id',
      'source_snapshot_id',
      'source_feature_type',
      'source_feature_id',
      'region_code',
      'is_geometry_manually_edited',
      'is_attributes_manually_edited'
  );

-- 2. New FKs/check and the retained single admin-area FK.
SELECT
    c.conname,
    c.contype,
    c.convalidated,
    pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint AS c
WHERE c.conrelid = 'core.core_buildings'::regclass
  AND (
      c.conname IN (
          'core_buildings_source_registry_id_fkey',
          'core_buildings_source_snapshot_id_fkey',
          'core_buildings_source_feature_type_chk'
      )
      OR c.conkey = ARRAY[
          (
              SELECT a.attnum
              FROM pg_attribute AS a
              WHERE a.attrelid = 'core.core_buildings'::regclass
                AND a.attname = 'admin_area_id'
          )
      ]::smallint[]
  )
ORDER BY c.conname;

SELECT
    count(*) AS admin_area_fk_count,
    count(*) = 1 AS passes
FROM pg_constraint AS c
WHERE c.conrelid = 'core.core_buildings'::regclass
  AND c.contype = 'f'
  AND c.conkey = ARRAY[
      (
          SELECT a.attnum
          FROM pg_attribute AS a
          WHERE a.attrelid = 'core.core_buildings'::regclass
            AND a.attname = 'admin_area_id'
      )
  ]::smallint[];

-- 3. Unique partial index definition.
SELECT
    i.indexname,
    i.indexdef
FROM pg_indexes AS i
WHERE i.schemaname = 'core'
  AND i.tablename = 'core_buildings'
  AND i.indexname = 'core_buildings_source_identity_uidx';

-- 4. Typed backfill coverage.
SELECT
    count(*) AS total_rows,
    count(*) FILTER (WHERE source_registry_id IS NOT NULL) AS with_source_registry,
    count(*) FILTER (WHERE source_snapshot_id IS NOT NULL) AS with_source_snapshot,
    count(*) FILTER (WHERE source_feature_type IS NOT NULL) AS with_feature_type,
    count(*) FILTER (WHERE source_feature_id IS NOT NULL) AS with_feature_id,
    count(*) FILTER (
        WHERE source_registry_id IS NOT NULL
          AND source_feature_type IS NOT NULL
          AND source_feature_id IS NOT NULL
    ) AS with_complete_source_identity,
    count(*) FILTER (WHERE region_code IS NOT NULL) AS with_region_code,
    count(*) FILTER (WHERE is_geometry_manually_edited) AS geometry_manually_edited,
    count(*) FILTER (WHERE is_attributes_manually_edited) AS attributes_manually_edited
FROM core.core_buildings;

-- 5. Must return zero rows: duplicate complete source identities.
SELECT
    b.source_registry_id,
    r.source_code,
    b.source_feature_type,
    b.source_feature_id,
    count(*) AS row_count,
    array_agg(b.id ORDER BY b.id) AS building_ids
FROM core.core_buildings AS b
JOIN system.system_source_registry AS r
  ON r.id = b.source_registry_id
WHERE b.source_registry_id IS NOT NULL
  AND b.source_feature_type IS NOT NULL
  AND b.source_feature_id IS NOT NULL
GROUP BY
    b.source_registry_id,
    r.source_code,
    b.source_feature_type,
    b.source_feature_id
HAVING count(*) > 1
ORDER BY row_count DESC, b.source_registry_id, b.source_feature_type, b.source_feature_id;

-- 6. Rows with an explicit OSM ID but an incomplete typed identity.
-- Current audited production expectation: 16 rows, all missing only feature type.
SELECT
    b.id,
    b.public_id,
    b.external_id,
    b.source_refs ->> 'osm_id' AS source_refs_osm_id,
    b.source_refs ->> 'osm_feature_type' AS source_refs_osm_feature_type,
    r.source_code,
    b.source_feature_type,
    b.source_feature_id,
    b.region_code
FROM core.core_buildings AS b
LEFT JOIN system.system_source_registry AS r
  ON r.id = b.source_registry_id
WHERE nullif(btrim(b.source_refs ->> 'osm_id'), '') IS NOT NULL
  AND (
      b.source_registry_id IS NULL
      OR b.source_feature_type IS NULL
      OR b.source_feature_id IS NULL
  )
ORDER BY b.id;

-- 7. Snapshot versions represented in source_refs but unresolved to a typed FK.
-- Current audited production expectation: two unresolved versions / 1,003 rows.
SELECT
    coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
    ) AS source_refs_snapshot_version,
    r.source_code,
    count(*) AS unresolved_rows,
    min(b.id) AS first_building_id,
    max(b.id) AS last_building_id
FROM core.core_buildings AS b
LEFT JOIN system.system_source_registry AS r
  ON r.id = b.source_registry_id
WHERE coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
      ) IS NOT NULL
  AND b.source_snapshot_id IS NULL
GROUP BY
    coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
    ),
    r.source_code
ORDER BY source_refs_snapshot_version;

-- 8. Must return zero rows: typed snapshot belongs to a different registry.
SELECT
    b.id,
    b.source_registry_id AS building_source_registry_id,
    s.source_registry_id AS snapshot_source_registry_id,
    b.source_snapshot_id,
    s.snapshot_version
FROM core.core_buildings AS b
JOIN system.system_source_snapshots AS s
  ON s.id = b.source_snapshot_id
WHERE b.source_registry_id IS DISTINCT FROM s.source_registry_id
ORDER BY b.id;

-- 9. Must return zero rows: a typed snapshot disagrees with an explicit JSON
-- snapshot version. Rows with no typed snapshot are reported by section 7.
SELECT
    b.id,
    b.source_snapshot_id,
    s.snapshot_version AS typed_snapshot_version,
    coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
    ) AS source_refs_snapshot_version
FROM core.core_buildings AS b
JOIN system.system_source_snapshots AS s
  ON s.id = b.source_snapshot_id
WHERE coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
      ) IS NOT NULL
  AND s.snapshot_version IS DISTINCT FROM coalesce(
        nullif(btrim(b.source_refs ->> 'source_snapshot_version'), ''),
        nullif(btrim(b.source_refs ->> 'snapshot_version'), '')
      )
ORDER BY b.id;

-- 10. Must return zero rows: typed OSM type/ID/region disagree with safely
-- parseable values in source_refs.
WITH parsed_source AS (
    SELECT
        b.id,
        CASE lower(nullif(btrim(b.source_refs ->> 'osm_feature_type'), ''))
            WHEN 'w' THEN 'way'
            WHEN 'way' THEN 'way'
            WHEN 'r' THEN 'relation'
            WHEN 'rel' THEN 'relation'
            WHEN 'relation' THEN 'relation'
            ELSE NULL
        END AS expected_feature_type,
        CASE
            WHEN nullif(btrim(b.source_refs ->> 'osm_id'), '') ~ '^[1-9][0-9]*$'
             AND (btrim(b.source_refs ->> 'osm_id'))::numeric <= 9223372036854775807::numeric
                THEN (btrim(b.source_refs ->> 'osm_id'))::bigint
            ELSE NULL
        END AS expected_feature_id,
        nullif(btrim(b.source_refs ->> 'region_code'), '') AS expected_region_code
    FROM core.core_buildings AS b
)
SELECT
    b.id,
    b.source_feature_type,
    p.expected_feature_type,
    b.source_feature_id,
    p.expected_feature_id,
    b.region_code,
    p.expected_region_code
FROM core.core_buildings AS b
JOIN parsed_source AS p
  ON p.id = b.id
WHERE (
        p.expected_feature_type IS NOT NULL
        AND b.source_feature_type IS DISTINCT FROM p.expected_feature_type
      )
   OR (
        p.expected_feature_id IS NOT NULL
        AND b.source_feature_id IS DISTINCT FROM p.expected_feature_id
      )
   OR (
        p.expected_region_code IS NOT NULL
        AND b.region_code IS DISTINCT FROM p.expected_region_code
      )
ORDER BY b.id;

-- 11. Must return zero rows: invalid feature types or null edit flags.
SELECT
    b.id,
    b.source_feature_type,
    b.is_geometry_manually_edited,
    b.is_attributes_manually_edited
FROM core.core_buildings AS b
WHERE b.source_feature_type NOT IN ('way', 'relation')
   OR b.is_geometry_manually_edited IS NULL
   OR b.is_attributes_manually_edited IS NULL
ORDER BY b.id;

ROLLBACK;
