-- Fix tiles.tiles_streets_v after 019: roads vanished because the view allowed only ST_LineString
-- and cast geom to geometry(LineString,4326). Many rows are ST_MultiLineString (and the cast would fail).
--
-- This migration:
-- - Keeps CREATE OR REPLACE VIEW (no DROP CASCADE).
-- - Includes LineString + MultiLineString centerlines.
-- - Normalizes to 2D SRID 4326 via ST_Multi(...)::geometry(MultiLineString,4326) (Martin-friendly line features).
-- - Preserves public_id column type from core.core_streets (no ::text cast).
-- - Retains road_class, road_class_code, inactive/deleted filters, generated-name exclusion.
--
-- Does not modify routing tables.

begin;

create schema if not exists tiles;

create or replace view tiles.tiles_streets_v as
select
    s.id,
    s.public_id,
    coalesce(
        nullif(trim(mm.name), ''),
        nullif(trim(en.name), ''),
        nullif(trim(s.canonical_name), '')
    ) as name,
    s.canonical_name,
    s.admin_area_id,
    s.is_active,
    s.updated_at,
    st_multi(st_force2d(st_setsrid(s.geom, 4326)))::geometry (MultiLineString, 4326) as geom,
    mm.name as name_mm,
    en.name as name_en,
    coalesce(rc.code, nullif(trim(s.road_class), ''), 'unknown'::text) as road_class,
    coalesce(rc.code, nullif(trim(s.road_class), ''), 'unknown'::text) as road_class_code,
    coalesce(rc.rank, unk.rank, 100)::integer as sort_rank,
    coalesce(rc.min_zoom, unk.min_zoom, 12::numeric) as min_zoom,
    s.surface,
    s.is_oneway,
    s.bridge,
    s.tunnel,
    s.layer
from core.core_streets as s
left join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
left join lateral (
    select r.rank, r.min_zoom
    from ref.ref_road_classes as r
    where r.code = 'unknown'
    limit 1
) as unk on true
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
        sn.is_primary desc nulls last,
        case sn.name_type when 'official' then 0 else 1 end,
        sn.id asc
    limit 1
) as mm on true
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and coalesce(trim(sn.name_type), '') <> 'generated'
      and (
          lower(trim(sn.language_code)) = 'en'
          or upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
      )
    order by
        sn.is_primary desc nulls last,
        case sn.name_type when 'official' then 0 else 1 end,
        sn.id asc
    limit 1
) as en on true
where s.is_active is true
  and s.deleted_at is null
  and s.geom is not null
  and st_geometrytype(st_force2d(st_setsrid(s.geom, 4326))) in ('ST_LineString'::text, 'ST_MultiLineString'::text)
  and st_isvalid(st_force2d(st_setsrid(s.geom, 4326)))
  and not st_isempty(st_force2d(st_setsrid(s.geom, 4326)));

comment on view tiles.tiles_streets_v is
    'Active street centerlines for MVT (EPSG:4326, 2D): LineString + MultiLineString as MultiLineString; MM→EN→canonical name; road_class + road_class_code; excludes generated names and soft-deleted/inactive rows.';

do $$
declare
    r text;
begin
    foreach r in array [
        'martin'::text,
        'martin_reader'::text,
        'tiles_reader'::text
    ]
        loop
            if exists (select 1 from pg_roles where rolname = r) then
                execute format('grant usage on schema tiles to %I', r);
                execute format('grant select on tiles.tiles_streets_v to %I', r);
            end if;
        end loop;
end $$;

commit;
