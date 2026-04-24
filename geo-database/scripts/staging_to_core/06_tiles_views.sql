create schema if not exists tiles;

-- active admin areas for tiles
create or replace view tiles.v_admin_areas as
select
    a.id,
    a.canonical_name as name,
    st_setsrid(a.geom, 4326) as geom
from core.core_admin_areas as a
where a.is_active = true
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom)
  and st_srid(st_setsrid(a.geom, 4326)) = 4326;

-- active places for tiles
create or replace view tiles.v_places as
select
    p.id,
    p.primary_name as name,
    st_setsrid(p.point_geom, 4326) as geom
from core.core_places as p
where p.is_public = true
  and p.deleted_at is null
  and p.point_geom is not null
  and not st_isempty(p.point_geom)
  and st_isvalid(p.point_geom)
  and st_srid(st_setsrid(p.point_geom, 4326)) = 4326;

-- active streets for tiles
create or replace view tiles.v_streets as
select
    s.id,
    s.canonical_name as name,
    st_setsrid(s.geom, 4326) as geom
from core.core_streets as s
where s.is_active = true
  and s.geom is not null
  and not st_isempty(s.geom)
  and st_isvalid(s.geom)
  and st_srid(st_setsrid(s.geom, 4326)) = 4326;

-- row counts
select
    'tiles.v_admin_areas'::text as view_name,
    count(*) as row_count
from tiles.v_admin_areas
union all
select
    'tiles.v_places'::text as view_name,
    count(*) as row_count
from tiles.v_places
union all
select
    'tiles.v_streets'::text as view_name,
    count(*) as row_count
from tiles.v_streets
order by view_name;
