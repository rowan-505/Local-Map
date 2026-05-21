-- =============================================================================
-- Supabase migration 030: Core Review soft delete (deleted_at) + tile filters
-- =============================================================================
--
-- Purpose:
--   Add deleted_at to all Core Review editable core tables that lack it, with
--   btree indexes for tombstone filtering. Refresh tile views that still expose
--   inactive or soft-deleted rows.
--
-- Safety:
--   - Non-destructive: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--     CREATE OR REPLACE VIEW only.
--   - Does not UPDATE existing rows (all deleted_at remain NULL = active).
--   - Skips tables that do not exist in the target database.
--   - Does not drop columns or rewrite unrelated schemas.
--
-- Already had deleted_at before this migration (column add is no-op):
--   core_places, core_map_buildings, core_streets, core_addresses
--
-- Tile views left unchanged (already filter deleted_at [+ is_active where applicable]):
--   tiles_places_v (003), tiles_buildings_v (029), tiles_streets_v (020)
--
-- Apply: Supabase SQL Editor or your usual migration workflow. Do not run from CI
-- without review.
--
-- =============================================================================

begin;

create schema if not exists core;
create schema if not exists tiles;

-- -----------------------------------------------------------------------------
-- Part A: deleted_at on Core Review entity tables
-- -----------------------------------------------------------------------------

do $$
declare
    tbl text;
    full_name text;
begin
    foreach tbl in array array[
        'core_places',
        'core_map_buildings',
        'core_streets',
        'core_bus_stops',
        'core_bus_routes',
        'core_bus_route_variants',
        'core_map_landuse',
        'core_map_water_lines',
        'core_map_water_polygons',
        'core_addresses',
        'core_admin_areas'
    ]
    loop
        full_name := 'core.' || tbl;

        if to_regclass(full_name) is null then
            raise notice 'Skipping % — table does not exist', full_name;
            continue;
        end if;

        execute format(
            'alter table core.%I add column if not exists deleted_at timestamptz null',
            tbl
        );

        execute format(
            'comment on column core.%I.deleted_at is
                ''Soft-delete tombstone (timestamptz). NULL = active in default lists/tiles; set via dashboard/API soft delete.''',
            tbl
        );

        raise notice 'Ensured deleted_at on %', full_name;
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Part B: indexes for deleted_at filtering
-- -----------------------------------------------------------------------------

do $$
declare
    tbl text;
    idx_name text;
    full_name text;
begin
    foreach tbl in array array[
        'core_places',
        'core_map_buildings',
        'core_streets',
        'core_bus_stops',
        'core_bus_routes',
        'core_bus_route_variants',
        'core_map_landuse',
        'core_map_water_lines',
        'core_map_water_polygons',
        'core_addresses',
        'core_admin_areas'
    ]
    loop
        full_name := 'core.' || tbl;
        idx_name := tbl || '_deleted_at_idx';

        if to_regclass(full_name) is null then
            continue;
        end if;

        execute format(
            'create index if not exists %I on core.%I (deleted_at)',
            idx_name,
            tbl
        );
    end loop;
end $$;

-- Partial indexes: fast default "active" lists where is_active exists (idempotent).
create index if not exists core_map_buildings_active_not_deleted_idx
    on core.core_map_buildings (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_streets_active_not_deleted_idx
    on core.core_streets (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_bus_stops_active_not_deleted_idx
    on core.core_bus_stops (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_bus_routes_active_not_deleted_idx
    on core.core_bus_routes (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_bus_route_variants_active_not_deleted_idx
    on core.core_bus_route_variants (id)
    where deleted_at is null
      and is_active is true;

create index if not exists core_map_landuse_active_not_deleted_idx
    on core.core_map_landuse (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_map_water_lines_active_not_deleted_idx
    on core.core_map_water_lines (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_map_water_polygons_active_not_deleted_idx
    on core.core_map_water_polygons (updated_at desc)
    where deleted_at is null
      and is_active is true;

create index if not exists core_admin_areas_active_not_deleted_idx
    on core.core_admin_areas (updated_at desc)
    where deleted_at is null
      and is_active is true;

-- Places and addresses have no is_active; partial index on non-deleted rows only.
create index if not exists core_places_not_deleted_idx
    on core.core_places (updated_at desc)
    where deleted_at is null;

create index if not exists core_addresses_not_deleted_idx
    on core.core_addresses (updated_at desc)
    where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Part C: tile views — exclude soft-deleted (+ is_active where column exists)
-- -----------------------------------------------------------------------------

-- Road name labels: preserve deployed column order (id, name, geom, layer_type, name_mm, name_en).
create or replace view tiles.tiles_road_labels_v as
select
    s.id,
    coalesce(
        nullif(trim(sn_mm.name), ''),
        nullif(trim(sn_en.name), ''),
        nullif(trim(s.canonical_name), '')
    ) as name,
    s.geom,
    'road_label'::text as layer_type,
    sn_mm.name as name_mm,
    sn_en.name as name_en
from core.core_streets as s
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and coalesce(trim(sn.name_type), '') <> 'generated'
      and (
          sn.language_code in ('my', 'mm')
          or upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when sn.name_type = 'official' and sn.is_primary = true then 1
            when sn.is_primary = true then 2
            when sn.name_type = 'official' then 3
            else 4
        end,
        sn.name asc
    limit 1
) as sn_mm on true
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and coalesce(trim(sn.name_type), '') <> 'generated'
      and (
          sn.language_code = 'en'
          or upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
      )
    order by
        case
            when sn.name_type = 'official' and sn.is_primary = true then 1
            when sn.is_primary = true then 2
            when sn.name_type = 'official' then 3
            else 4
        end,
        sn.name asc
    limit 1
) as sn_en on true
where s.is_active is true
  and s.deleted_at is null
  and s.canonical_name is not null
  and s.geom is not null
  and not st_isempty(s.geom);

comment on view tiles.tiles_road_labels_v is
    'Active, non-deleted street labels for symbol layers; excludes generated names.';

-- Legacy/simple roads layer (baseline tiles_roads_v).
create or replace view tiles.tiles_roads_v as
select
    s.id,
    s.canonical_name as name,
    s.geom,
    'road'::text as layer_type
from core.core_streets as s
where s.is_active is true
  and s.deleted_at is null
  and s.canonical_name is not null
  and s.geom is not null
  and not st_isempty(s.geom);

comment on view tiles.tiles_roads_v is
    'Active, non-deleted street centerlines (legacy road layer alias).';

-- Admin area polygons: preserve deployed column order and MultiPolygon geom type.
create or replace view tiles.tiles_admin_areas_v as
select
    a.id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    st_setsrid(a.geom, 4326)::geometry(MultiPolygon, 4326) as geom,
    an_mm.name as name_mm,
    an_en.name as name_en
from core.core_admin_areas as a
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_mm on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_en on true
where a.is_active is true
  and a.deleted_at is null
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom);

comment on view tiles.tiles_admin_areas_v is
    'Active, non-deleted admin area polygons (MultiPolygon WGS84) with bilingual label fields.';

-- Admin area label points (separate from polygon MVT source — do not change tiles_admin_areas_v geom type).
create or replace view tiles.tiles_admin_area_labels_v as
select
    a.id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))::geometry(Point, 4326) as geom,
    an_mm.name as name_mm,
    an_en.name as name_en
from core.core_admin_areas as a
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_mm on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_en on true
where a.is_active is true
  and a.deleted_at is null
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom);

comment on view tiles.tiles_admin_area_labels_v is
    'Active, non-deleted admin area label points (Point on surface of polygon) for symbol layers.';

-- Bus stops: preserve deployed column order (id, public_id, name, stop_code, geom, name_mm, name_en);
-- extra 003 attrs appended after name_en.
create or replace view tiles.tiles_bus_stops_v as
select
    b.id,
    b.public_id,
    coalesce(
        nullif(trim(bn_mm.name), ''),
        nullif(trim(bn_en.name), ''),
        nullif(trim(b.name), ''),
        nullif(trim(b.stop_code), '')
    ) as name,
    b.stop_code,
    b.geom,
    bn_mm.name as name_mm,
    bn_en.name as name_en,
    b.name_local,
    b.admin_area_id,
    b.source_type_id,
    b.is_active,
    b.created_at,
    b.updated_at
from core.core_bus_stops as b
left join lateral (
    select n.name
    from core.core_bus_stop_names as n
    where n.stop_id = b.id
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
    from core.core_bus_stop_names as n
    where n.stop_id = b.id
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
where b.is_active is true
  and b.deleted_at is null;

-- Bus routes MVT source: preserve deployed column order; name_mm/name_en appended at end.
create or replace view tiles.tiles_bus_routes_v as
select
    v.id,
    r.id as route_id,
    r.route_code,
    r.public_name,
    v.variant_code,
    v.geom,
    rn_mm.name as name_mm,
    rn_en.name as name_en
from core.core_bus_route_variants as v
inner join core.core_bus_routes as r
    on r.id = v.route_id
left join lateral (
    select n.name
    from core.core_bus_route_names as n
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
    from core.core_bus_route_names as n
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
where r.is_active is true
  and r.deleted_at is null
  and v.is_active is true
  and v.deleted_at is null
  and v.geom is not null
  and not st_isempty(v.geom);

-- Landuse polygons.
create or replace view tiles.tiles_landuse_v as
select
    l.id,
    l.name,
    l.class_code as landuse_class,
    l.geom
from core.core_map_landuse as l
where l.is_active is true
  and l.deleted_at is null
  and l.geom is not null
  and not st_isempty(l.geom);

-- Water lines.
create or replace view tiles.tiles_water_lines_v as
select
    w.id,
    w.name,
    w.class_code as waterway_class,
    w.geom
from core.core_map_water_lines as w
where w.is_active is true
  and w.deleted_at is null
  and w.geom is not null
  and not st_isempty(w.geom);

-- Water polygons.
create or replace view tiles.tiles_water_polygons_v as
select
    w.id,
    w.name,
    w.class_code as water_class,
    w.geom
from core.core_map_water_polygons as w
where w.is_active is true
  and w.deleted_at is null
  and w.geom is not null
  and not st_isempty(w.geom);

commit;
