-- =============================================================================
-- Local-only: persistent basemap building archive.
--
-- Target DB: geo_core (local). Never apply to Supabase.
-- Purpose: hold the full national building footprint set after Core-eligible
-- rows are promoted, so Stage 05 staging reset can discard temporary
-- staging.staging_building_candidates without losing PMTiles input.
--
-- Scope: one schema + one table. No partitions, queues, or lifecycle tables.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS basemap_source;

CREATE TABLE IF NOT EXISTS basemap_source.buildings (
  id                 bigserial PRIMARY KEY,
  external_id        text NOT NULL,
  osm_feature_type   text NOT NULL,
  osm_id             bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  raw_id             bigint,
  source_staging_id  bigint,
  class_code         text NOT NULL,
  canonical_name     text,
  normalized_data    jsonb NOT NULL,
  source_refs        jsonb NOT NULL,
  geom               geometry(MultiPolygon, 4326) NOT NULL,
  geometry_hash      text,
  content_hash       text,
  imported_at        timestamptz,
  updated_at         timestamptz,
  CONSTRAINT basemap_buildings_external_id_chk
    CHECK (btrim(external_id) <> ''),
  CONSTRAINT basemap_buildings_class_code_chk
    CHECK (btrim(class_code) <> ''),
  CONSTRAINT basemap_buildings_osm_feature_type_chk
    CHECK (osm_feature_type IN ('way', 'relation')),
  CONSTRAINT basemap_buildings_osm_id_chk
    CHECK (osm_id > 0),
  CONSTRAINT basemap_buildings_canonical_name_chk
    CHECK (canonical_name IS NULL OR btrim(canonical_name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS basemap_buildings_identity_uidx
  ON basemap_source.buildings (osm_feature_type, osm_id);

CREATE UNIQUE INDEX IF NOT EXISTS basemap_buildings_external_id_uidx
  ON basemap_source.buildings (external_id);

CREATE INDEX IF NOT EXISTS basemap_buildings_geom_gix
  ON basemap_source.buildings USING gist (geom);

COMMENT ON SCHEMA basemap_source IS
  'Persistent local basemap source archive. Not touched by Stage 05 staging reset.';

COMMENT ON TABLE basemap_source.buildings IS
  'Full national building footprints (all import classes). PMTiles export should read this table.';
