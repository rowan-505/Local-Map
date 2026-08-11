-- =============================================================================
-- Local-only: allow Core lineage on basemap_source.buildings
-- Target: geo_core. Never apply to Supabase.
--
-- Extends 010_basemap_source_buildings.sql so managed Core-only buildings can
-- be inserted without inventing OSM way/relation identities.
-- =============================================================================

ALTER TABLE basemap_source.buildings
  ADD COLUMN IF NOT EXISTS core_id bigint,
  ADD COLUMN IF NOT EXISTS core_public_id uuid,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_feature_type text,
  ADD COLUMN IF NOT EXISTS source_feature_id text,
  ADD COLUMN IF NOT EXISTS is_managed_in_core boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS core_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- OSM fields become optional for managed CoreMap rows.
ALTER TABLE basemap_source.buildings
  ALTER COLUMN osm_feature_type DROP NOT NULL,
  ALTER COLUMN osm_id DROP NOT NULL,
  ALTER COLUMN source_snapshot_id DROP NOT NULL;

ALTER TABLE basemap_source.buildings
  DROP CONSTRAINT IF EXISTS basemap_buildings_osm_feature_type_chk,
  DROP CONSTRAINT IF EXISTS basemap_buildings_osm_id_chk,
  DROP CONSTRAINT IF EXISTS basemap_buildings_osm_identity_pair_chk;

ALTER TABLE basemap_source.buildings
  ADD CONSTRAINT basemap_buildings_osm_identity_pair_chk CHECK (
    (osm_feature_type IS NULL AND osm_id IS NULL)
    OR (
      osm_feature_type IN ('way', 'relation')
      AND osm_id IS NOT NULL
      AND osm_id > 0
    )
  );

DROP INDEX IF EXISTS basemap_source.basemap_buildings_identity_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS basemap_buildings_identity_uidx
  ON basemap_source.buildings (osm_feature_type, osm_id)
  WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS basemap_buildings_core_public_id_uidx
  ON basemap_source.buildings (core_public_id)
  WHERE core_public_id IS NOT NULL;

COMMENT ON COLUMN basemap_source.buildings.core_id IS
  'Supabase core.core_map_buildings.id when linked; one-time Core→basemap merge.';
COMMENT ON COLUMN basemap_source.buildings.core_public_id IS
  'Supabase core.core_map_buildings.public_id when linked.';
COMMENT ON COLUMN basemap_source.buildings.is_managed_in_core IS
  'True when this footprint is represented in Supabase Core.';
COMMENT ON COLUMN basemap_source.buildings.core_metadata IS
  'Merged Core metadata (names, verification, type, admin, source_refs, etc.).';
