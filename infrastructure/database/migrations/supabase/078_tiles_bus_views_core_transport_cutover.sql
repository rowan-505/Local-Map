-- =============================================================================
-- Supabase migration 078: bus tile views → core_transport (production cutover)
-- =============================================================================
--
-- Purpose:
--   Repoint tiles.tiles_bus_routes_v and tiles.tiles_bus_stops_v from deprecated
--   core.core_bus_* tables to core_transport.* for Martin / MapLibre tile builds.
--   View names and column layout match the deployed 030 tile contract.
--
-- Deprecated sources (do not use for new tile builds):
--   core.core_bus_routes
--   core.core_bus_route_variants
--   core.core_bus_route_names
--   core.core_bus_stops
--   core.core_bus_stop_names
--
-- New sources:
--   core_transport.routes
--   core_transport.route_variants
--   core_transport.route_names
--   core_transport.route_paths (shape fallback when variant.geom is null)
--   core_transport.stops
--   core_transport.stop_names
--
-- Safety:
--   - CREATE OR REPLACE VIEW only (does not drop core.core_bus_*).
--   - Does not modify core_transport table definitions or frontend styles.
--
-- Depends on:
--   067_create_core_transport_schema.sql
--   (070_tiles_bus_views_core_transport.sql is superseded by this migration when
--    both are applied; this file is the authoritative cutover step.)
--
-- Apply: Supabase SQL Editor or your usual migration workflow.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- tiles.tiles_bus_stops_v
--
-- MapLibre / Martin contract (leading columns, order preserved from 030):
--   id, public_id, name, stop_code, geom, name_mm, name_en
-- Extra attrs (name_local, admin_area_id, …) appended for dashboard/debug parity.
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
    'Active core_transport.stops for Martin/MapLibre bus stop tiles. '
    'DEPRECATED source: core.core_bus_stops + core.core_bus_stop_names '
    '(legacy tables retained until 073 cutover). '
    'Filters: is_active = true, deleted_at IS NULL, valid non-empty Point geom.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_bus_routes_v
--
-- MapLibre / Martin contract (column order preserved from 030):
--   id (route_variant id), route_id, route_code, public_name, variant_code,
--   geom, name_mm, name_en
-- id remains route_variant.id so existing vector tile feature ids stay stable.
-- geom = variant.geom or primary active shape path from core_transport.route_paths.
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
    'Active core_transport route variants with LineString geom for Martin/MapLibre. '
    'DEPRECATED source: core.core_bus_routes + core.core_bus_route_variants '
    '+ core.core_bus_route_names (legacy tables retained until 073 cutover). '
    'Filters: route/variant is_active = true, deleted_at IS NULL, valid non-empty geom.';

commit;

-- =============================================================================
-- Smoke queries (run manually after migration; not executed by migration)
-- =============================================================================
--
-- 1) Views exist
-- select table_name, table_type
-- from information_schema.tables
-- where table_schema = 'tiles'
--   and table_name in ('tiles_bus_routes_v', 'tiles_bus_stops_v')
-- order by table_name;
--
-- 2) Required columns (leading contract columns)
-- select table_name, column_name, ordinal_position, udt_name
-- from information_schema.columns
-- where table_schema = 'tiles'
--   and table_name in ('tiles_bus_routes_v', 'tiles_bus_stops_v')
-- order by table_name, ordinal_position;
--
-- 3) Row counts (expect >= 0; promoted core_transport data only)
-- select 'tiles_bus_stops_v' as view_name, count(*)::bigint as row_count
-- from tiles.tiles_bus_stops_v
-- union all
-- select 'tiles_bus_routes_v', count(*)::bigint
-- from tiles.tiles_bus_routes_v;
--
-- 4) No dependency on deprecated core.core_bus_* (expect 0 rows)
-- select vn.nspname as view_schema, v.relname as view_name,
--        refn.nspname as ref_schema, ref.relname as ref_name
-- from pg_depend as d
-- join pg_class as v on v.oid = d.objid
-- join pg_namespace as vn on vn.oid = v.relnamespace
-- join pg_class as ref on ref.oid = d.refobjid
-- join pg_namespace as refn on refn.oid = ref.relnamespace
-- where vn.nspname = 'tiles'
--   and v.relname in ('tiles_bus_stops_v', 'tiles_bus_routes_v')
--   and v.relkind = 'v'
--   and d.deptype in ('n', 'a')
--   and refn.nspname = 'core'
--   and ref.relname in (
--       'core_bus_routes', 'core_bus_route_variants', 'core_bus_route_names',
--       'core_bus_stops', 'core_bus_stop_names'
--   );
--
-- 5) Depends on core_transport (expect >= 1 row per view)
-- select v.relname as view_name, refn.nspname || '.' || ref.relname as source_table
-- from pg_depend as d
-- join pg_class as v on v.oid = d.objid
-- join pg_namespace as vn on vn.oid = v.relnamespace
-- join pg_class as ref on ref.oid = d.refobjid
-- join pg_namespace as refn on refn.oid = ref.relnamespace
-- where vn.nspname = 'tiles'
--   and v.relname in ('tiles_bus_stops_v', 'tiles_bus_routes_v')
--   and refn.nspname = 'core_transport'
-- order by view_name, source_table;
--
-- 6) Geometry types
-- select 'routes' as layer,
--        count(*) filter (where geom is not null)::bigint as with_geom,
--        min(st_geometrytype(geom)) as geom_type
-- from tiles.tiles_bus_routes_v
-- union all
-- select 'stops',
--        count(*) filter (where geom is not null)::bigint,
--        min(st_geometrytype(geom))
-- from tiles.tiles_bus_stops_v;
--
-- 7) Sample rows
-- select id, route_id, route_code, variant_code, name_mm, name_en
-- from tiles.tiles_bus_routes_v
-- order by id
-- limit 5;
--
-- select id, public_id, name, stop_code, name_mm, name_en
-- from tiles.tiles_bus_stops_v
-- order by id
-- limit 5;
