-- =============================================================================
-- Supabase migration 047: spatial indexes for reverse address resolver
-- =============================================================================

begin;

create index if not exists core_addresses_entrance_geom_gix
    on core.core_addresses using gist (entrance_geom)
    where entrance_geom is not null;

create index if not exists core_map_landuse_geom_gix
    on core.core_map_landuse using gist (geom)
    where geom is not null;

comment on index core.core_addresses_entrance_geom_gix is
    'Reverse geocode: nearest entrance_geom within radius.';

comment on index core.core_map_landuse_geom_gix is
    'Reverse geocode: landuse polygon at click point.';

commit;
