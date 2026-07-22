-- Prompt 12 — Register legacy lineage honestly (no fabricated checksums/versions)
-- Source registry already has osm_myanmar (id=1).
-- Import batches + snapshots were empty on production; register historical waves only.

SET statement_timeout = '5min';

BEGIN;

-- Legacy national admin fast-core (review pipeline bypassed)
INSERT INTO system.system_import_batches (source_registry_id, batch_name, trigger_type, status, started_at, finished_at, note)
SELECT 1, 'legacy_national_admin_fast_core', 'manual', 'completed',
       '2026-05-01'::timestamptz, '2026-05-01'::timestamptz,
       'historically registered after import; review pipeline bypassed; exact start unknown'
WHERE NOT EXISTS (
  SELECT 1 FROM system.system_import_batches WHERE batch_name = 'legacy_national_admin_fast_core'
);

INSERT INTO system.system_source_snapshots (
  source_registry_id, import_batch_id, snapshot_ref, snapshot_version, region_code, checksum, captured_at, metadata
)
SELECT 1, b.id,
  'legacy-admin-fast-core',
  'legacy_admin_fast_core_unknown',
  'MM',
  NULL,
  '2026-05-01'::timestamptz,
  jsonb_build_object(
    'registration', 'historical_after_the_fact',
    'pipeline', 'admin-fast-core',
    'review_pipeline', 'bypassed',
    'checksum', 'unknown',
    'source_version', 'unknown'
  )
FROM system.system_import_batches b
WHERE b.batch_name = 'legacy_national_admin_fast_core'
  AND NOT EXISTS (
    SELECT 1 FROM system.system_source_snapshots s WHERE s.snapshot_version = 'legacy_admin_fast_core_unknown'
  );

-- Legacy national road fast-core
INSERT INTO system.system_import_batches (source_registry_id, batch_name, trigger_type, status, started_at, finished_at, note)
SELECT 1, 'legacy_national_road_fast_core', 'manual', 'completed',
       '2026-05-01'::timestamptz, '2026-05-01'::timestamptz,
       'historically registered after import; review pipeline bypassed; exact start unknown'
WHERE NOT EXISTS (
  SELECT 1 FROM system.system_import_batches WHERE batch_name = 'legacy_national_road_fast_core'
);

INSERT INTO system.system_source_snapshots (
  source_registry_id, import_batch_id, snapshot_ref, snapshot_version, region_code, checksum, captured_at, metadata
)
SELECT 1, b.id,
  'legacy-road-fast-core',
  'legacy_road_fast_core_unknown',
  'MM',
  NULL,
  '2026-05-01'::timestamptz,
  jsonb_build_object(
    'registration', 'historical_after_the_fact',
    'pipeline', 'road-fast-core',
    'review_pipeline', 'bypassed',
    'checksum', 'unknown',
    'source_version', 'unknown'
  )
FROM system.system_import_batches b
WHERE b.batch_name = 'legacy_national_road_fast_core'
  AND NOT EXISTS (
    SELECT 1 FROM system.system_source_snapshots s WHERE s.snapshot_version = 'legacy_road_fast_core_unknown'
  );

-- Current-production repair waves (2026-07-22)
INSERT INTO system.system_import_batches (source_registry_id, batch_name, trigger_type, status, started_at, finished_at, note)
SELECT 1, v.batch_name, 'manual', 'completed', now(), now(), v.note
FROM (VALUES
  ('repair_admin_foundation_20260722', 'current_production admin hierarchy clear fixes'),
  ('repair_admin_links_20260722', 'current_production entity township admin links'),
  ('repair_road_class_20260722', 'current_production road class text/FK + unclassified ref'),
  ('repair_road_attributes_20260722', 'current_production oneway/bridge/tunnel/layer/surface'),
  ('repair_street_names_20260722', 'current_production generated name flags'),
  ('repair_small_core_20260722', 'current_production places/buildings/landuse/water mechanical'),
  ('repair_review_backlog_20260722', 'current_production publish backlog classify/archive')
) AS v(batch_name, note)
WHERE NOT EXISTS (
  SELECT 1 FROM system.system_import_batches b WHERE b.batch_name = v.batch_name
);

INSERT INTO system.system_source_snapshots (
  source_registry_id, import_batch_id, snapshot_ref, snapshot_version, region_code, checksum, captured_at, metadata
)
SELECT 1, b.id,
  replace(b.batch_name, '_', '-'),
  b.batch_name,
  'MM',
  NULL,
  now(),
  jsonb_build_object(
    'registration', 'current_production_repair',
    'checksum', 'n/a',
    'note', b.note
  )
FROM system.system_import_batches b
WHERE b.batch_name LIKE 'repair_%_20260722'
  AND NOT EXISTS (
    SELECT 1 FROM system.system_source_snapshots s WHERE s.snapshot_version = b.batch_name
  );

COMMIT;

SELECT 'import_batches' AS metric, count(*)::text FROM system.system_import_batches
UNION ALL
SELECT 'source_snapshots', count(*)::text FROM system.system_source_snapshots
UNION ALL
SELECT 'source_registry', count(*)::text FROM system.system_source_registry;

SELECT id, batch_name, status FROM system.system_import_batches ORDER BY id;
SELECT id, snapshot_version, checksum IS NULL AS checksum_unknown, metadata->>'pipeline' AS pipeline
FROM system.system_source_snapshots ORDER BY id;
