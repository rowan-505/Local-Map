-- =============================================================================
-- Supabase migration 070: bus tile views → core_transport
-- =============================================================================
--
-- Purpose:
--   Repoint tiles.tiles_bus_routes_v and tiles.tiles_bus_stops_v from legacy
--   core.core_bus_* tables to core_transport.* while keeping view names and
--   column layout stable for MapLibre / Martin.
--
-- Safety:
--   - CREATE OR REPLACE VIEW only (no DROP of core.core_bus_*).
--   - Does not modify core_transport table definitions.
--
-- Depends on:
--   067_create_core_transport_schema.sql
--
-- Apply: Supabase SQL Editor or your usual migration workflow.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- tiles.tiles_bus_stops_v
-- Column order matches 030 deployment: core attrs + name_local, source_type_id
-- after name_en (MapLibre layers expect name_mm / name_en / name).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_bus_stops_v as
select
    s.id,
    s.public_id,
    coalesce(
        nullif(trim(bn_mm.name), ''),
        nullif(trim(bn_en.name), ''),
        nullif(trim(s.name), ''),
        nullif(trim(s.name_local), ''),
        nullif(trim(s.stop_code), '')
    ) as name,
    s.stop_code,
    s.geom::geometry(Point, 4326) as geom,
    bn_mm.name as name_mm,
    bn_en.name as name_en,
    s.name_local,
    s.admin_area_id,
    s.source_type_id,
    s.is_active,
    s.created_at,
    s.updated_at
from core_transport.stops as s
left join lateral (
    select n.name
    from core_transport.stop_names as n
    where n.stop_id = s.id
      and lower(trim(coalesce(n.language_code, ''))) in ('my', 'mm')
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as bn_mm on true
left join lateral (
    select n.name
    from core_transport.stop_names as n
    where n.stop_id = s.id
      and lower(trim(coalesce(n.language_code, ''))) = 'en'
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as bn_en on true
where s.is_active = true
  and s.deleted_at is null
  and s.geom is not null
  and not st_isempty(s.geom)
  and st_isvalid(s.geom);

comment on view tiles.tiles_bus_stops_v is
    'Active core_transport stops for Martin/MapLibre (replaces core.core_bus_stops).';

-- ---------------------------------------------------------------------------
-- tiles.tiles_bus_routes_v
-- id = route_variant id (unchanged). geom = variant geom or primary shape path.
-- Explicit ::geometry(LineString, 4326) cast required: CREATE OR REPLACE VIEW cannot
-- change column type from geometry(LineString,4326) to untyped geometry (42P16).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_bus_routes_v as
with route_line_geom as (
    select
        v.id as route_variant_id,
        coalesce(
            case
                when v.geom is not null
                     and not st_isempty(v.geom)
                     and st_isvalid(v.geom)
                then v.geom
            end,
            shape_path.geom
        )::geometry(LineString, 4326) as geom
    from core_transport.route_variants as v
    left join lateral (
        select p.geom
        from core_transport.route_paths as p
        where p.route_variant_id = v.id
          and p.path_kind = 'shape'
          and p.is_active = true
          and p.deleted_at is null
          and p.geom is not null
          and not st_isempty(p.geom)
          and st_isvalid(p.geom)
        order by p.updated_at desc, p.id
        limit 1
    ) as shape_path on true
)
select
    v.id,
    r.id as route_id,
    r.route_code,
    r.public_name,
    v.variant_code,
    line_geom.geom,
    rn_mm.name as name_mm,
    rn_en.name as name_en
from core_transport.route_variants as v
inner join core_transport.routes as r
    on r.id = v.route_id
inner join route_line_geom as line_geom
    on line_geom.route_variant_id = v.id
left join lateral (
    select n.name
    from core_transport.route_names as n
    where n.route_id = r.id
      and lower(trim(coalesce(n.language_code, ''))) in ('my', 'mm')
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as rn_mm on true
left join lateral (
    select n.name
    from core_transport.route_names as n
    where n.route_id = r.id
      and lower(trim(coalesce(n.language_code, ''))) = 'en'
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as rn_en on true
where r.is_active = true
  and r.deleted_at is null
  and v.is_active = true
  and v.deleted_at is null
  and line_geom.geom is not null
  and not st_isempty(line_geom.geom);

comment on view tiles.tiles_bus_routes_v is
    'Active core_transport route variants with line geom for Martin/MapLibre '
    '(replaces core.core_bus_route_variants + core_bus_routes).';

commit;
