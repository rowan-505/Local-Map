-- tiles.tiles_streets_v: core streets for Martin / MapLibre line layers.
-- Replaces definitions from 017 (adds deleted_at gate, routing-style attrs, road ref).
-- Does not modify routing graphs.

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
    mm.name as name_mm,
    en.name as name_en,
    coalesce(rc.code, nullif(trim(s.road_class), ''), 'unknown'::text) as road_class,
    coalesce(rc.rank, unk.rank, 100)::integer as sort_rank,
    coalesce(rc.min_zoom, unk.min_zoom, 12::numeric) as min_zoom,
    s.surface,
    s.is_oneway,
    s.bridge,
    s.tunnel,
    s.layer,
    s.geom
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
  and st_isvalid(s.geom)
  and not st_isempty(s.geom);

comment on view tiles.tiles_streets_v is
    'Active core streets for MVT: names exclude name_type=generated; display name prefers MM, then EN, then canonical_name; road_class from ref with unknown fallback.';

commit;
