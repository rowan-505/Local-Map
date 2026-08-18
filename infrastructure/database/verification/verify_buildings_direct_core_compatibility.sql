-- =============================================================================
-- Before/after verification for building direct-Core schema compatibility
-- (migration 149 columns + importer prerequisites).
-- Read-mostly. Safe to run on production.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

SELECT 'counts' AS section,
  (SELECT count(*) FROM core.core_buildings) AS buildings,
  (SELECT count(*) FROM core.core_building_names) AS names,
  (SELECT count(*) FROM core.core_place_buildings) AS links;

SELECT 'migration_149_columns' AS section, count(*) AS n,
  count(*) = 7 AS passes
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name = 'core_buildings'
  AND column_name IN (
    'source_registry_id', 'source_snapshot_id', 'source_feature_type',
    'source_feature_id', 'region_code',
    'is_geometry_manually_edited', 'is_attributes_manually_edited'
  );

SELECT 'source_identity_uidx' AS section,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'core'
      AND indexname = 'core_buildings_source_identity_uidx'
  ) AS passes;

SELECT 'pipeline_osm_identity_key' AS section,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'system' AND p.proname = 'pipeline_osm_identity_key'
  ) AS passes;

SELECT 'complete_identity_collisions' AS section, count(*) AS n,
  count(*) = 0 AS passes
FROM (
  SELECT source_registry_id, source_feature_type, source_feature_id
  FROM core.core_buildings
  WHERE source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
) d;

SELECT 'bare_numeric_invented_type' AS section, count(*) AS n,
  count(*) = 0 AS passes
FROM core.core_buildings
WHERE external_id ~ '^[1-9][0-9]*$'
  AND source_feature_type IS NOT NULL
  AND source_feature_id IS NOT NULL
  AND coalesce(source_refs->>'osm_feature_type', '') = ''
  AND coalesce(source_refs->>'osm_id', '') = '';

SELECT 'identity_formats' AS section,
  CASE
    WHEN external_id ~ '^osm:way:[1-9][0-9]*$' THEN 'verbose_way'
    WHEN external_id ~ '^osm:relation:[1-9][0-9]*$' THEN 'verbose_relation'
    WHEN external_id ~ '^osm:W:[1-9][0-9]*$' THEN 'compact_W'
    WHEN external_id ~ '^osm:R:[1-9][0-9]*$' THEN 'compact_R'
    WHEN external_id ~ '^[1-9][0-9]*$' THEN 'bare_numeric'
    WHEN nullif(btrim(external_id), '') IS NULL THEN 'null_or_blank'
    ELSE 'other'
  END AS fmt,
  count(*) AS n
FROM core.core_buildings
GROUP BY 1
ORDER BY n DESC;

SELECT 'protected_rows' AS section,
  count(*) FILTER (WHERE coalesce(source_refs->>'source', '') = 'dashboard') AS dashboard,
  count(*) FILTER (WHERE is_verified OR verification_status = 'verified') AS verifiedish,
  count(*) FILTER (
    WHERE is_geometry_manually_edited OR is_attributes_manually_edited
  ) AS manual_edit_flags,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM core.core_buildings;

SELECT 'integration_views' AS section,
  (SELECT count(*) FROM tiles.tiles_buildings_v) AS tiles_buildings_v,
  (SELECT count(*) FROM search.v_search_buildings_source) AS search_buildings_source;

SELECT 'direct_core_snapshot' AS section, id, snapshot_version
FROM system.system_source_snapshots
WHERE snapshot_version = 'osm_myanmar_2026_07_21_national_dry_run_v1';
