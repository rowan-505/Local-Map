-- tiles.tiles_buildings_v: keep legacy/OSM rows where is_active was never set (NULL).
-- "is distinct from false" includes TRUE and NULL, excludes FALSE.

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
    b.geom
from core.core_map_buildings as b
where b.is_active is distinct from false
  and b.deleted_at is null;
