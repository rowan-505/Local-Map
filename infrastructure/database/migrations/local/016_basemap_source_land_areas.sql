-- =============================================================================
-- Local-only: persistent basemap land-area archive (PMTiles input).
-- Target DB: geo_core. Never apply to Supabase.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS basemap_source;

CREATE TABLE IF NOT EXISTS basemap_source.land_areas (
  id                   bigserial PRIMARY KEY,
  external_id          text NOT NULL,
  osm_feature_type     text NOT NULL,
  osm_id               bigint NOT NULL,
  source_snapshot_id   bigint NOT NULL,
  raw_id               bigint,
  source_staging_id    bigint,
  class_code           text NOT NULL,
  land_area_class_id   bigint,
  canonical_name       text,
  import_class         text NOT NULL DEFAULT 'pmtiles_only',
  pmtiles_only_reason  text,
  normalized_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_refs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom                 geometry(MultiPolygon, 4326) NOT NULL,
  geometry_hash        text,
  content_hash         text,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basemap_land_areas_external_id_chk
    CHECK (btrim(external_id) <> ''),
  CONSTRAINT basemap_land_areas_class_code_chk
    CHECK (btrim(class_code) <> ''),
  CONSTRAINT basemap_land_areas_osm_feature_type_chk
    CHECK (osm_feature_type IN ('way', 'relation')),
  CONSTRAINT basemap_land_areas_osm_id_chk
    CHECK (osm_id > 0),
  CONSTRAINT basemap_land_areas_import_class_chk
    CHECK (import_class = 'pmtiles_only')
);

CREATE UNIQUE INDEX IF NOT EXISTS basemap_land_areas_identity_uidx
  ON basemap_source.land_areas (osm_feature_type, osm_id);

CREATE UNIQUE INDEX IF NOT EXISTS basemap_land_areas_external_id_uidx
  ON basemap_source.land_areas (external_id);

CREATE INDEX IF NOT EXISTS basemap_land_areas_geom_gix
  ON basemap_source.land_areas USING gist (geom);

CREATE INDEX IF NOT EXISTS basemap_land_areas_class_code_idx
  ON basemap_source.land_areas (class_code);

CREATE INDEX IF NOT EXISTS basemap_land_areas_snapshot_idx
  ON basemap_source.land_areas (source_snapshot_id);

COMMENT ON TABLE basemap_source.land_areas IS
  'PMTiles-only national land-area polygons archived from staging. Not Core.';
