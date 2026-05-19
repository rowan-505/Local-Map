-- Extend tiles.tiles_buildings_v with ref taxonomy fields (no id — use building_type_code for MVT styling).
-- Same active / non-deleted filter as migration 009.

create or replace view tiles.tiles_buildings_v as
select
    b.id,
    b.public_id,
    b.name,
    coalesce(b.building_type, b.class_code, 'yes'::text) as building_type,
    b.class_code,
    b.levels,
    b.height_m,
    b.area_m2,
    b.confidence_score,
    b.is_verified,
    bt.code as building_type_code,
    bt.name as building_type_name,
    bt.name_mm as building_type_name_mm,
    b.geom
from core.core_map_buildings as b
left join ref.ref_building_types as bt
    on bt.id = b.building_type_id
where b.is_active is true
  and b.deleted_at is null;
