-- Read-only national building rollout readiness checks.
-- Run after migrations 149 and 150, before every regional apply.
--
-- psql "$SUPABASE_READ_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -f infrastructure/database/verification/verify_national_building_rollout_readiness.sql

\set ON_ERROR_STOP on
\pset pager off

BEGIN READ ONLY;
SET LOCAL statement_timeout = '5min';

SELECT
    'capacity' AS section,
    now() AS captured_at,
    pg_database_size(current_database()) AS database_bytes,
    (
        SELECT coalesce(sum(wal.size), 0)
        FROM pg_ls_waldir() AS wal
    ) AS wal_directory_bytes,
    pg_relation_size('core.core_buildings') AS building_table_bytes,
    pg_indexes_size('core.core_buildings') AS building_index_bytes,
    pg_total_relation_size('core.core_buildings') AS building_total_bytes,
    693.310::numeric AS measured_persistent_bytes_per_new_building,
    3110.448::numeric AS measured_wal_bytes_per_staged_building,
    3990.825::numeric AS measured_temp_bytes_per_staged_building,
    30589000000::bigint AS required_free_headroom_bytes;

WITH required_columns(column_name) AS (
    VALUES
        ('source_registry_id'),
        ('source_snapshot_id'),
        ('source_feature_type'),
        ('source_feature_id'),
        ('region_code'),
        ('is_geometry_manually_edited'),
        ('is_attributes_manually_edited')
)
SELECT
    'schema' AS section,
    required.column_name,
    column_info.column_name IS NOT NULL AS present
FROM required_columns AS required
LEFT JOIN information_schema.columns AS column_info
  ON column_info.table_schema = 'core'
 AND column_info.table_name = 'core_buildings'
 AND column_info.column_name = required.column_name
ORDER BY required.column_name;

SELECT
    'required_indexes' AS section,
    index_class.relname AS index_name,
    index_meta.indisunique,
    index_meta.indisvalid,
    index_meta.indisready,
    pg_relation_size(index_class.oid) AS index_bytes,
    pg_get_indexdef(index_class.oid) AS definition
FROM pg_class AS index_class
JOIN pg_index AS index_meta
  ON index_meta.indexrelid = index_class.oid
WHERE index_class.oid IN (
    'core.core_buildings_source_identity_uidx'::regclass,
    'core.core_buildings_geom_gix'::regclass,
    'core.core_buildings_public_id_uidx'::regclass,
    'core.core_place_buildings_building_id_idx'::regclass,
    'core.core_building_names_building_id_idx'::regclass
)
ORDER BY index_class.relname;

SELECT
    'building_integrity' AS section,
    count(*) AS rows,
    count(DISTINCT building.id) AS distinct_ids,
    count(DISTINCT building.public_id) AS distinct_public_ids,
    count(*) FILTER (WHERE building.geom IS NULL) AS null_geometry,
    count(*) FILTER (
        WHERE building.geom IS NOT NULL
          AND (
              ST_SRID(building.geom) <> 4326
              OR ST_IsEmpty(building.geom)
              OR NOT ST_IsValid(building.geom)
              OR GeometryType(building.geom) NOT IN ('POLYGON', 'MULTIPOLYGON')
          )
    ) AS invalid_geometry
FROM core.core_buildings AS building;

SELECT
    'duplicate_source_identity' AS section,
    count(*) AS duplicate_groups
FROM (
    SELECT
        building.source_registry_id,
        building.source_feature_type,
        building.source_feature_id
    FROM core.core_buildings AS building
    WHERE building.source_registry_id IS NOT NULL
      AND building.source_feature_type IS NOT NULL
      AND building.source_feature_id IS NOT NULL
    GROUP BY
        building.source_registry_id,
        building.source_feature_type,
        building.source_feature_id
    HAVING count(*) > 1
) AS duplicate;

SELECT
    'relationship_integrity' AS section,
    count(*) FILTER (WHERE building.id IS NULL) AS orphan_building_links,
    count(*) FILTER (WHERE place.id IS NULL) AS orphan_place_links
FROM core.core_place_buildings AS place_building
LEFT JOIN core.core_buildings AS building
  ON building.id = place_building.building_id
LEFT JOIN core.core_places AS place
  ON place.id = place_building.place_id;

SELECT
    'unnamed_search_exposure' AS section,
    count(*) AS unnamed_ordinary_footprints_in_search
FROM search.v_search_buildings_source AS search_building
JOIN core.core_buildings AS building
  ON building.id = search_building.entity_id
WHERE nullif(btrim(building.name), '') IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_building_names AS building_name
      WHERE building_name.building_id = building.id
        AND nullif(btrim(building_name.name), '') IS NOT NULL
  );

WITH application_roles AS (
    SELECT
        max(role.oid) FILTER (WHERE role.rolname = 'anon') AS anon_oid,
        max(role.oid) FILTER (
            WHERE role.rolname = 'authenticated'
        ) AS authenticated_oid
    FROM pg_roles AS role
)
SELECT
    'security' AS section,
    relation.relname,
    relation.relrowsecurity AS rls_enabled,
    relation.relforcerowsecurity AS force_rls,
    application_roles.anon_oid IS NOT NULL AS anon_role_present,
    coalesce(
        has_table_privilege(application_roles.anon_oid, relation.oid, 'SELECT'),
        false
    ) AS anon_select,
    coalesce(
        has_table_privilege(
            application_roles.anon_oid,
            relation.oid,
            'INSERT,UPDATE,DELETE'
        ),
        false
    ) AS anon_write,
    application_roles.authenticated_oid IS NOT NULL
        AS authenticated_role_present,
    coalesce(
        has_table_privilege(
            application_roles.authenticated_oid,
            relation.oid,
            'SELECT'
        ),
        false
    ) AS authenticated_select,
    coalesce(
        has_table_privilege(
            application_roles.authenticated_oid,
            relation.oid,
            'INSERT,UPDATE,DELETE'
        ),
        false
    ) AS authenticated_write
FROM pg_class AS relation
JOIN pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
CROSS JOIN application_roles
WHERE namespace.nspname = 'core'
  AND relation.relname IN (
      'core_buildings',
      'core_building_names',
      'core_place_buildings'
  )
ORDER BY relation.relname;

SELECT
    'index_usage' AS section,
    index_stats.relname,
    index_stats.indexrelname,
    index_stats.idx_scan,
    index_stats.idx_tup_read,
    index_stats.idx_tup_fetch,
    pg_relation_size(index_stats.indexrelid) AS index_bytes
FROM pg_stat_user_indexes AS index_stats
WHERE index_stats.schemaname = 'core'
  AND index_stats.relname IN (
      'core_buildings',
      'core_building_names',
      'core_place_buildings'
  )
ORDER BY index_stats.relname, index_stats.indexrelname;

ROLLBACK;
