-- =============================================================================
-- Supabase migration 123: route_stop review display geometry
-- =============================================================================
--
-- Adds route-specific placeholder display points on transport.route_stops without
-- overwriting transport.stops.geom (shared stops keep their physical location).
--
-- Dashboard/API map markers use coalesce(route_stops.review_geom, stops.geom).
-- =============================================================================

begin;

alter table transport.route_stops
    add column if not exists review_geom geometry(Point, 4326);

alter table transport.route_stops
    add column if not exists review_geometry_data jsonb not null default '{}'::jsonb;

create index if not exists route_stops_review_geom_gix
    on transport.route_stops
    using gist (review_geom);

commit;
