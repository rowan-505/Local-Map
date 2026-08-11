-- Staging table for Core→basemap export CSV (local geo_core only).
-- Recreated by the runner before each load.

DROP TABLE IF EXISTS basemap_source.core_buildings_export CASCADE;

CREATE TABLE basemap_source.core_buildings_export (
  core_id                         bigint PRIMARY KEY,
  core_public_id                  uuid NOT NULL,
  external_id                     text,
  source_feature_type             text,
  source_feature_id               text,
  source_registry_id              bigint,
  building_type_code              text,
  admin_area_id                   bigint,
  levels                          integer,
  height_m                        double precision,
  confidence                      integer,
  verification_status             text,
  is_active                       boolean,
  is_soft_deleted                 boolean,
  deleted_at                      timestamptz,
  is_geometry_manually_edited     boolean,
  is_attributes_manually_edited   boolean,
  core_name                       text,
  source_refs                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom_ewkt                       text NOT NULL,
  geom_hash                       text NOT NULL,
  geom_type                       text,
  geom_srid                       integer,
  names_json                      jsonb NOT NULL DEFAULT '[]'::jsonb,
  place_link_count                bigint NOT NULL DEFAULT 0
);

CREATE INDEX core_buildings_export_typed_idx
  ON basemap_source.core_buildings_export (source_feature_type, source_feature_id)
  WHERE source_feature_type IS NOT NULL AND source_feature_id IS NOT NULL;

CREATE INDEX core_buildings_export_public_id_idx
  ON basemap_source.core_buildings_export (core_public_id);

COMMENT ON TABLE basemap_source.core_buildings_export IS
  'Transient one-time Core export for basemap merge. Safe to DROP after merge.';
