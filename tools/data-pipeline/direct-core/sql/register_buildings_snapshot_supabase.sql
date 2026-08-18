-- =============================================================================
-- One-time prep: register national buildings snapshot on Supabase for direct-Core
-- Idempotent. Does not touch core.core_buildings data rows.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

INSERT INTO system.system_source_snapshots (
  id,
  source_registry_id,
  import_batch_id,
  snapshot_ref,
  snapshot_version,
  region_code,
  checksum,
  captured_at,
  created_at,
  metadata
)
SELECT
  nextval('system.system_source_snapshots_id_seq'),
  r.id,
  NULL,
  'myanmar-260721.osm.pbf',
  'osm_myanmar_2026_07_21_national_dry_run_v1',
  'MM',
  NULL,
  now(),
  now(),
  jsonb_build_object(
    'purpose', 'direct_core_buildings_prep',
    'local_database', 'geo_core',
    'local_snapshot_id', 13,
    'note', 'Registered for direct-Core buildings dry-run/apply; not a remote OSM ingest'
  )
FROM system.system_source_registry AS r
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = 'osm_myanmar_2026_07_21_national_dry_run_v1'
  );

SELECT id, snapshot_version, region_code, source_registry_id, metadata
FROM system.system_source_snapshots
WHERE snapshot_version = 'osm_myanmar_2026_07_21_national_dry_run_v1';

COMMIT;
