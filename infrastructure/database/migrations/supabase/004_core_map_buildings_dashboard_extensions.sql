-- Extend core.core_map_buildings for dashboard-created building polygons.
-- Single source of truth: no duplicate building tables.
-- Keeps geom as geometry(MultiPolygon, 4326).
-- Tile view refresh: migrations/005_tiles_buildings_v.sql (after columns exist).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Columns (idempotent)
-- ---------------------------------------------------------------------------
alter table core.core_map_buildings
    add column if not exists public_id uuid,
    add column if not exists building_type text,
    add column if not exists centroid geometry(Point, 4326),
    add column if not exists area_m2 numeric,
    add column if not exists levels integer,
    add column if not exists height_m numeric,
    add column if not exists confidence_score numeric not null default 80,
    add column if not exists is_verified boolean not null default false,
    add column if not exists created_by bigint,
    add column if not exists updated_by bigint,
    add column if not exists deleted_at timestamptz;

-- Stable public identifiers (backfill before NOT NULL + unique).
update core.core_map_buildings as b
set public_id = gen_random_uuid()
where b.public_id is null;

alter table core.core_map_buildings
    alter column public_id set default gen_random_uuid(),
    alter column public_id set not null;

create unique index if not exists core_map_buildings_public_id_uidx
    on core.core_map_buildings (public_id);

-- ---------------------------------------------------------------------------
-- Spatial indexes
-- ---------------------------------------------------------------------------
create index if not exists core_map_buildings_geom_gix
    on core.core_map_buildings using gist (geom);

create index if not exists core_map_buildings_centroid_gix
    on core.core_map_buildings using gist (centroid)
    where centroid is not null;

-- ---------------------------------------------------------------------------
-- Backfills (safe for MultiPolygon 4326)
-- ---------------------------------------------------------------------------
update core.core_map_buildings as b
set building_type = b.class_code
where b.building_type is null;

update core.core_map_buildings as b
set centroid = st_pointonsurface(st_makevalid(b.geom))::geometry(Point, 4326)
where b.centroid is null
  and b.geom is not null
  and not st_isempty(b.geom);

update core.core_map_buildings as b
set area_m2 = st_area(b.geom::geography)
where b.area_m2 is null
  and b.geom is not null
  and not st_isempty(b.geom);
