-- Register national routing-turn-restrictions dry-run snapshot on Supabase.
-- Source extract: myanmar-260811-routing-turn-restrictions.osm.pbf
-- Parent: myanmar-260811.osm.pbf
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO system.system_import_batches (
  source_registry_id,
  batch_name,
  trigger_type,
  status,
  finished_at,
  note
)
SELECT
  r.id,
  'myanmar_national_routing_turn_restrictions_dry_run_2026_08_13',
  'manual',
  'completed',
  now(),
  'Register immutable Geofabrik myanmar-260811 turn-restriction extract for promote'
FROM system.system_source_registry r
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM system.system_import_batches b
    WHERE b.batch_name = 'myanmar_national_routing_turn_restrictions_dry_run_2026_08_13'
  );

INSERT INTO system.system_source_snapshots (
  source_registry_id,
  import_batch_id,
  snapshot_ref,
  snapshot_version,
  region_code,
  checksum,
  captured_at,
  metadata
)
SELECT
  r.id,
  b.id,
  'myanmar-260811-routing-turn-restrictions.osm.pbf',
  'osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1',
  'MM',
  '42eb8281c94c3ebd2bf4b19c93d258d29b66bacd2ff66731c2da92fb0ac11d38',
  timestamptz '2026-08-11 20:22:05+00',
  jsonb_build_object(
    'provider', 'geofabrik',
    'parent_pbf', 'myanmar-260811.osm.pbf',
    'parent_sha256', '8cc8dfdfa16d589d988cec1ab46a7e4bac01a977c774c92197644a4393759850',
    'families', ARRAY['routing_turn_restrictions'],
    'local_snapshot_id', 17,
    'filter', 'r/type=restriction + complete member ways/nodes via osmium getid -r'
  )
FROM system.system_source_registry r
JOIN system.system_import_batches b
  ON b.source_registry_id = r.id
 AND b.batch_name = 'myanmar_national_routing_turn_restrictions_dry_run_2026_08_13'
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM system.system_source_snapshots s
    WHERE s.snapshot_version = 'osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1'
  );

SELECT
  s.id,
  s.snapshot_version,
  s.snapshot_ref,
  s.checksum,
  s.captured_at,
  b.batch_name
FROM system.system_source_snapshots s
JOIN system.system_import_batches b ON b.id = s.import_batch_id
WHERE s.snapshot_version = 'osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1';

COMMIT;
