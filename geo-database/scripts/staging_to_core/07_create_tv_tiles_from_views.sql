create or replace function tiles.get_admin_areas_tile(z int, x int, y int)
returns bytea
language sql
stable
as $$
with
bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        a.id,
        a.name,
        ST_AsMVTGeom(
            a.geom,
            b.tile_geom,
            4096,
            64,
            true
        ) as geom
    from tiles.v_admin_areas a
    cross join bounds b
    where a.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'admin_areas', 4096, 'geom')
from mvtgeom;
$$;

-- streets
create or replace function tiles.get_streets_tile(z int, x int, y int)
returns bytea
language sql
stable
as $$
with bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        s.id,
        s.name,
        ST_AsMVTGeom(s.geom, b.tile_geom, 4096, 64, true) as geom
    from tiles.v_streets s
    cross join bounds b
    where s.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'streets', 4096, 'geom')
from mvtgeom;
$$;

-- places
create or replace function tiles.get_places_tile(z int, x int, y int)
returns bytea
language sql
stable
as $$
with bounds as (
    select ST_TileEnvelope(z, x, y) as tile_geom
),
mvtgeom as (
    select
        p.id,
        p.name,
        ST_AsMVTGeom(p.geom, b.tile_geom, 4096, 64, true) as geom
    from tiles.v_places p
    cross join bounds b
    where p.geom && b.tile_geom
)
select ST_AsMVT(mvtgeom, 'places', 4096, 'geom')
from mvtgeom;
$$;