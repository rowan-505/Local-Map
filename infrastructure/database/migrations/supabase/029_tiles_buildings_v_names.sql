-- tiles.tiles_buildings_v: expose name_mm / name_en from core_map_building_names (migration 028).
-- Keeps admin area + ref taxonomy columns from 014; replaces bare b.name with coalesced label.

create or replace view tiles.tiles_buildings_v as
select
    b.id,
    b.public_id,
    bn_mm.name as name_mm,
    bn_en.name as name_en,
    coalesce(
        nullif(trim(bn_mm.name), ''),
        nullif(trim(bn_en.name), ''),
        nullif(trim(b.name), '')
    ) as name,
    coalesce(bt.code, b.class_code, 'yes'::text) as building_type,
    b.class_code,
    b.levels,
    b.height_m,
    b.area_m2,
    b.confidence_score,
    b.is_verified,
    bt.code as building_type_code,
    bt.name as building_type_name,
    bt.name_mm as building_type_name_mm,
    b.geom,
    b.admin_area_id,
    aa.canonical_name as admin_area_name
from core.core_map_buildings as b
left join ref.ref_building_types as bt
    on bt.id = b.building_type_id
left join core.core_admin_areas as aa
    on aa.id = b.admin_area_id
left join lateral (
    select n.name
    from core.core_map_building_names as n
    where n.building_id = b.id
      and n.is_primary is true
      and n.name_type = 'official'
      and (
          lower(trim(n.language_code)) in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        case lower(trim(n.language_code))
            when 'my' then 0
            when 'mm' then 1
            else 2
        end,
        n.search_weight desc,
        n.id asc
    limit 1
) as bn_mm on true
left join lateral (
    select n.name
    from core.core_map_building_names as n
    where n.building_id = b.id
      and n.is_primary is true
      and n.name_type = 'official'
      and (
          lower(trim(n.language_code)) = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by n.search_weight desc, n.id asc
    limit 1
) as bn_en on true
where b.is_active is true
  and b.deleted_at is null;
