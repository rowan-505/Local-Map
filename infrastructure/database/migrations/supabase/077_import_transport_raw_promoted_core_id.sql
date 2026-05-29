-- Track promoted core row on import_transport raw candidates

begin;

alter table import_transport.raw_routes
    add column if not exists promoted_core_id bigint null;

alter table import_transport.raw_stops
    add column if not exists promoted_core_id bigint null;

alter table import_transport.raw_route_variants
    add column if not exists promoted_core_id bigint null;

alter table import_transport.raw_route_stops
    add column if not exists promoted_core_id bigint null;

create index if not exists raw_routes_promoted_core_id_idx
    on import_transport.raw_routes (promoted_core_id)
    where promoted_core_id is not null;

create index if not exists raw_stops_promoted_core_id_idx
    on import_transport.raw_stops (promoted_core_id)
    where promoted_core_id is not null;

create index if not exists raw_route_variants_promoted_core_id_idx
    on import_transport.raw_route_variants (promoted_core_id)
    where promoted_core_id is not null;

create index if not exists raw_route_stops_promoted_core_id_idx
    on import_transport.raw_route_stops (promoted_core_id)
    where promoted_core_id is not null;

commit;
