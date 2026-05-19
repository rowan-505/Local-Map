-- tiles.tiles_buildings_v: all active, non-deleted rows from core.core_map_buildings only.
-- Includes dashboard-created polygons (source_refs not filtered). Excludes inactive / soft-deleted rows.
-- Strict `is_active IS TRUE` matches API list filters.

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
where b.is_active is true
  and b.deleted_at is null;
