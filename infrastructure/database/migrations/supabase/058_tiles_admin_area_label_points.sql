-- =============================================================================
-- Supabase migration 058: unified admin area label point tile view
-- =============================================================================
--
-- Purpose:
--   Create one point label feature per active admin area for PMTiles/MapLibre
--   symbol placement. This avoids repeated labels from polygon/tile fragments.
--
-- Notes:
--   - This view is for label placement only; it intentionally outputs Point
--     geometry and does not replace existing boundary or polygon tile views.
--   - PMTiles generation and MapLibre style layers should use this point source
--     for admin text labels instead of polygon geometry.
--
-- =============================================================================

begin;

create schema if not exists tiles;

create or replace view tiles.tiles_admin_area_label_points_v as
select
    a.id,
    a.public_id::text as public_id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(an_und.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    an_mm.name as name_mm,
    an_en.name as name_en,
    a.admin_level_id,
    al.code as admin_level_code,
    label_point.geom as geom
from core.core_admin_areas as a
inner join ref.ref_admin_levels as al
    on al.id = a.admin_level_id
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_mm on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_en on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and n.language_code = 'und'
    order by
        case when n.is_primary = true then 1 else 2 end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_und on true
cross join lateral (
    select st_makevalid(st_setsrid(a.geom, 4326)) as valid_geom
) as admin_geom
cross join lateral (
    select st_setsrid(
        coalesce(
            case
                when a.centroid is not null
                     and not st_isempty(a.centroid)
                     and st_isvalid(a.centroid)
                     and admin_geom.valid_geom is not null
                     and not st_isempty(admin_geom.valid_geom)
                     and st_covers(admin_geom.valid_geom, st_setsrid(a.centroid, 4326))
                    then st_setsrid(a.centroid, 4326)
                else null
            end,
            case
                when admin_geom.valid_geom is not null
                     and not st_isempty(admin_geom.valid_geom)
                    then st_pointonsurface(admin_geom.valid_geom)
                else null
            end
        ),
        4326
    )::geometry(Point, 4326) as geom
) as label_point
where a.is_active is true
  and a.deleted_at is null
  and a.geom is not null
  and label_point.geom is not null;

comment on view tiles.tiles_admin_area_label_points_v is
    'One Point label feature per active admin area for PMTiles/MapLibre symbol placement only. Use for admin text labels to avoid repeated polygon-fragment labels.';

comment on column tiles.tiles_admin_area_label_points_v.geom is
    'Point geometry for label placement only: valid centroid if covered by admin geometry, else ST_PointOnSurface(admin geom).';

commit;

-- =============================================================================
-- Verification (read-only)
-- =============================================================================
--
-- select count(*) from tiles.tiles_admin_area_label_points_v;
--
-- select id, public_id, name, name_mm, name_en, admin_level_id, admin_level_code, st_geometrytype(geom)
-- from tiles.tiles_admin_area_label_points_v
-- order by admin_level_id, name
-- limit 20;
--
