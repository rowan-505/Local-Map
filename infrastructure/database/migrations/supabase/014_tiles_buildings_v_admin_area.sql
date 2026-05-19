-- tiles.tiles_buildings_v: optional admin area fields for MVT styling / labels.
-- Column order matches migration 012 through b.geom; new columns are appended only.

create or replace view tiles.tiles_buildings_v as
select
    b.id,
    b.public_id,
    b.name,
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
where b.is_active is true
  and b.deleted_at is null;
