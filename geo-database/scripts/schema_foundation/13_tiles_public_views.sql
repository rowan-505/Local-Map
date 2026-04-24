create schema if not exists tiles;

-- public POI features for vector tile and map API consumption
create or replace view tiles.tiles_poi_public_v as
select
    p.id,
    p.public_id,
    p.display_name as name,
    c.code as category_code,
    p.importance_score,
    p.point_geom as geom
from core.core_places as p
join ref.ref_poi_categories as c
    on c.id = p.category_id
where p.is_public = true
  and p.deleted_at is null
  and p.publish_status_id = (
      select id
      from ref.ref_publish_statuses
      where code = 'published'
  );

-- public active bus stop features for vector tile and map API consumption
create or replace view tiles.tiles_bus_stops_public_v as
select
    s.id,
    s.public_id,
    s.name,
    s.stop_code,
    s.geom
from core.core_bus_stops as s
where s.is_active = true;

-- public active bus route geometries for vector tile and map API consumption
create or replace view tiles.tiles_bus_routes_public_v as
select
    v.id,
    r.id as route_id,
    r.route_code,
    r.public_name,
    v.variant_code,
    v.geom
from core.core_bus_route_variants as v
join core.core_bus_routes as r
    on r.id = v.route_id
where r.is_active = true
  and v.is_active = true;
