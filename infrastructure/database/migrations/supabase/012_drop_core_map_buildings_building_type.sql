-- Drop legacy text column core.core_map_buildings.building_type (superseded by building_type_id + ref).
-- class_code is unchanged.
--
-- Pre-deploy verification (manual):
--   SELECT building_type, COUNT(*)
--   FROM core.core_map_buildings
--   WHERE building_type IS NOT NULL
--   GROUP BY building_type;
--
-- Abort if non-empty legacy text exists without an FK — data would be lost.

do $$
declare
    v_orphan bigint;
begin
    select count(*) into v_orphan
    from core.core_map_buildings as b
    where b.building_type is not null
      and btrim(b.building_type) <> ''
      and b.building_type_id is null;

    if v_orphan > 0 then
        raise exception
            using message = format(
                '012: %s row(s) have non-null building_type but null building_type_id; backfill before drop.',
                v_orphan
            ),
            hint =
                'Run: SELECT building_type, count(*) FROM core.core_map_buildings '
                || 'WHERE building_type IS NOT NULL GROUP BY building_type;';
    end if;
end $$;

-- View must not reference b.building_type before column drop (replaces migration 011 expression).
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
    b.geom
from core.core_map_buildings as b
left join ref.ref_building_types as bt
    on bt.id = b.building_type_id
where b.is_active is true
  and b.deleted_at is null;

alter table core.core_map_buildings
    drop column if exists building_type;
