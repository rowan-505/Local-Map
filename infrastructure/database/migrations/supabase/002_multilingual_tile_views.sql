-- Expose bilingual fields on POI and road-label tile sources for MapLibre `text-field` expressions.
-- Requires core_place_names / core_street_names with language_code or script_code.

create schema if not exists tiles;

create or replace view tiles.tiles_places_v as
select
    p.id,
    p.public_id,
    p.display_name,
    p.primary_name,
    mm.name as name_mm,
    en.name as name_en,
    p.category_id,
    c.code as category,
    c.name as category_name,
    p.importance_score,
    p.is_public,
    p.is_verified,
    p.updated_at,
    p.point_geom as geom
from core.core_places as p
left join ref.ref_poi_categories as c
    on c.id = p.category_id
left join lateral (
    select pn.name
    from core.core_place_names as pn
    where pn.place_id = p.id
      and (
          pn.language_code in ('my', 'mm')
          or upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when pn.name_type = 'official' and pn.is_primary = true then 1
            when pn.is_primary = true then 2
            when pn.name_type = 'official' then 3
            else 4
        end,
        pn.search_weight desc nulls last,
        pn.name asc
    limit 1
) as mm on true
left join lateral (
    select pn.name
    from core.core_place_names as pn
    where pn.place_id = p.id
      and (
          pn.language_code = 'en'
          or upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
      )
    order by
        case
            when pn.name_type = 'official' and pn.is_primary = true then 1
            when pn.is_primary = true then 2
            when pn.name_type = 'official' then 3
            else 4
        end,
        pn.search_weight desc nulls last,
        pn.name asc
    limit 1
) as en on true
where p.deleted_at is null
  and p.is_public = true
  and p.point_geom is not null
  and not st_isempty(p.point_geom)
  and st_isvalid(p.point_geom);

create or replace view tiles.tiles_road_labels_v as
select
    s.id,
    s.canonical_name as name,
    sn_mm.name as name_mm,
    sn_en.name as name_en,
    s.geom,
    'road_label'::text as layer_type
from core.core_streets as s
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
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
where s.is_active = true
  and s.canonical_name is not null
  and s.geom is not null;
