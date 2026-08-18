-- =============================================================================
-- Rollback for migration 149 (typed building source identity).
-- Use ONLY if you must undo 149 on an environment where it was applied and
-- no dependent importer/data relies on the new columns.
--
-- WARNING: Dropping columns destroys typed identity values. Prefer restoring
-- from backup over destructive rollback when production data exists.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DROP INDEX IF EXISTS core.core_buildings_source_identity_uidx;

ALTER TABLE core.core_buildings
  DROP CONSTRAINT IF EXISTS core_buildings_source_feature_type_chk,
  DROP CONSTRAINT IF EXISTS core_buildings_source_snapshot_id_fkey,
  DROP CONSTRAINT IF EXISTS core_buildings_source_registry_id_fkey;

ALTER TABLE core.core_buildings
  DROP COLUMN IF EXISTS is_attributes_manually_edited,
  DROP COLUMN IF EXISTS is_geometry_manually_edited,
  DROP COLUMN IF EXISTS region_code,
  DROP COLUMN IF EXISTS source_feature_id,
  DROP COLUMN IF EXISTS source_feature_type,
  DROP COLUMN IF EXISTS source_snapshot_id,
  DROP COLUMN IF EXISTS source_registry_id;

COMMIT;
