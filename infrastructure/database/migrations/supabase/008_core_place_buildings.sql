-- Link POIs (core_places) to building footprints (core_map_buildings).
-- Does not alter core.core_places.footprint_geom.

create table if not exists core.core_place_buildings (
    place_id bigint not null
        references core.core_places (id) on delete cascade,
    building_id bigint not null
        references core.core_map_buildings (id) on delete cascade,
    relation_type text default 'inside',
    is_primary boolean default false,
    created_at timestamptz default now(),
    constraint core_place_buildings_pkey primary key (place_id, building_id)
);

create index if not exists core_place_buildings_building_id_idx
    on core.core_place_buildings (building_id);

create index if not exists core_place_buildings_place_id_idx
    on core.core_place_buildings (place_id);

create index if not exists core_place_buildings_is_primary_idx
    on core.core_place_buildings (is_primary);
