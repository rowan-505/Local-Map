-- tiles.tiles_streets_v — Martin / MapLibre line layer source.
--
-- Exposes normalized road_class + road_class_code (same value) for MapLibre match/get expressions,
-- plus administrative / lifecycle columns. Geometry is forced to 2D LineString, SRID 4326.
--
-- Prerequisites (from earlier migrations): core.core_streets.deleted_at, road_class_id, geom as LineString WGS84.
-- Does not modify routing graphs.

begin;

create schema if not exists tiles;

create or replace view tiles.tiles_streets_v as
select
    s.id,
    s.public_id::text as public_id,
    coalesce(
        nullif(trim(mm.name), ''),
        nullif(trim(en.name), ''),
        nullif(trim(s.canonical_name), '')
    ) as name,
    s.canonical_name,
    s.admin_area_id,
    s.is_active,
    s.updated_at,
    st_force2d(st_setsrid(s.geom, 4326))::geometry (LineString, 4326) as geom,
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
  and st_geometrytype(st_force2d(st_setsrid(s.geom, 4326))) = 'ST_LineString'::text
  and st_isvalid(st_force2d(st_setsrid(s.geom, 4326)))
  and not st_isempty(st_force2d(st_setsrid(s.geom, 4326)));

comment on view tiles.tiles_streets_v is
    'Active LineString streets for MVT (EPSG:4326, 2D): MM→EN→canonical display name; road_class + road_class_code from ref.ref_road_classes.code with legacy core.core_streets.road_class then unknown; excludes generated names and soft-deleted rows.';

-- ---------------------------------------------------------------------------
-- Grants — optional Martin / tile reader roles (skip if role missing).
-- ---------------------------------------------------------------------------
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

/*
-------------------------------------------------------------------------------
Manual QA (run in SQL editor after applying migration)

-- 1) Columns present (expect road_class + road_class_code):
select column_name, data_type
from information_schema.columns
where table_schema = 'tiles'
  and table_name = 'tiles_streets_v'
order by ordinal_position;

-- 2) road_class population (expect non-null codes):
select road_class, road_class_code, count(*) as n
from tiles.tiles_streets_v
group by road_class, road_class_code
order by n desc
limit 25;

-- 3) Sample row (expect road_class = road_class_code, geom type LineString):
select id,
       public_id,
       road_class,
       road_class_code,
       sort_rank,
       st_srid(geom) as srid,
       st_ndims(geom) as ndims,
       st_geometrytype(geom) as gtype
from tiles.tiles_streets_v
limit 5;

-- 4) Join sanity: ref-driven vs fallback vs unknown
select case
           when road_class_id is not null then 'has_road_class_id'
           when nullif(trim(road_class_legacy), '') is not null then 'legacy_text_only'
           else 'unknown_fallback'
       end as bucket,
       count(*) as n
from (
         select s.id,
                s.road_class_id,
                s.road_class as road_class_legacy,
                v.road_class
         from core.core_streets s
                  join tiles.tiles_streets_v v on v.id = s.id
         where s.is_active is true
           and s.deleted_at is null
     ) q
group by 1
order by n desc;
-------------------------------------------------------------------------------
*/
