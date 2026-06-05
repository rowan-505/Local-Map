-- =============================================================================
-- Supabase migration 091: fix PMTiles label source views
-- =============================================================================
--
-- Purpose:
--   Recreate admin-area and road tile label views before regional PMTiles rebuilds.
--
-- Admin-area problems addressed:
--   1. Duplicate labels — polygon admin_areas features fragment per tile; label
--      points must be the single stable symbol source (ST_PointOnSurface).
--   2. Null name_mm / name_en — match my/mm and en rows including script_code
--      fallback (MYMR / LATN) when language_code is missing, with primary-first
--      ordering from core_admin_area_names.
--   3. Inconsistent preferred name — one lateral pick per language slot, shared
--      by label_points_v, admin_area_labels_v, and admin_areas_v.
--
-- PMTiles pipeline (export-region.sh) should export:
--   admin_area_label_points:tiles_admin_area_label_points_v  (MapLibre source-layer)
--   admin_areas:tiles_admin_areas_v                        (polygons only, no labels)
-- Martin/dashboard may also consume tiles_admin_area_labels_v.
--
-- PMTiles labels must not use fake generated names (Unnamed*, osm:*, or
-- name_type = generated on roads). Admin names use curated core_admin_area_names.
--
-- Depends on: 030, 039, 058
--
-- =============================================================================

begin;

create schema if not exists tiles;

-- ---------------------------------------------------------------------------
-- tiles.tiles_road_labels_v — street labels from core_street_names only
--
-- Column contract (PMTiles / MapLibre): id, name, geom, layer_type, name_mm, name_en, road_class_code
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_road_labels_v as
select
    s.id,
    coalesce(
        nullif(trim(sn_mm.name), ''),
        nullif(trim(sn_en.name), '')
    ) as name,
    s.geom,
    'road_label'::text as layer_type,
    sn_mm.name as name_mm,
    sn_en.name as name_en,
    coalesce(rc.code, nullif(trim(s.road_class), ''), 'unknown'::text) as road_class_code
from core.core_streets as s
left join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and coalesce(trim(sn.name_type), '') <> 'generated'
      and sn.name not like 'Unnamed%'
      and sn.name not like 'osm:%'
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
      and coalesce(trim(sn.name_type), '') <> 'generated'
      and sn.name not like 'Unnamed%'
      and sn.name not like 'osm:%'
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
where s.is_active is true
  and s.deleted_at is null
  and s.geom is not null
  and not st_isempty(s.geom)
  and coalesce(
        nullif(trim(sn_mm.name), ''),
        nullif(trim(sn_en.name), '')
    ) is not null;

comment on view tiles.tiles_road_labels_v is
    'PMTiles road label lines from core.core_street_names only. Excludes generated/Unnamed*/osm:* placeholders and does not fall back to core_streets.canonical_name.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_area_label_points_v — exactly one label point per admin area
--
-- Column contract: id, public_id, name, name_mm, name_en, admin_level_id,
--                  admin_level_code, geom (Point)
--
-- Name priority:
--   name_mm  — primary my/mm (language_code my|mm, else script_code MYMR)
--   name_en  — primary en   (language_code en,   else script_code LATN)
--   name     — coalesce(name_mm, name_en, primary und, canonical_name)
-- ---------------------------------------------------------------------------
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
    st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))::geometry(Point, 4326) as geom
from core.core_admin_areas as a
inner join ref.ref_admin_levels as al
    on al.id = a.admin_level_id
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and btrim(coalesce(n.name, '')) <> ''
      and (
          lower(btrim(coalesce(n.language_code, ''))) in ('my', 'mm')
          or upper(btrim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        n.is_primary desc nulls last,
        case
            when n.name_type = 'official' and coalesce(n.is_primary, false) then 1
            when coalesce(n.is_primary, false) then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.id asc
    limit 1
) as an_mm on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and btrim(coalesce(n.name, '')) <> ''
      and (
          lower(btrim(coalesce(n.language_code, ''))) = 'en'
          or upper(btrim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        n.is_primary desc nulls last,
        case
            when n.name_type = 'official' and coalesce(n.is_primary, false) then 1
            when coalesce(n.is_primary, false) then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.id asc
    limit 1
) as an_en on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and btrim(coalesce(n.name, '')) <> ''
      and lower(btrim(coalesce(n.language_code, ''))) = 'und'
    order by
        n.is_primary desc nulls last,
        n.search_weight desc nulls last,
        n.id asc
    limit 1
) as an_und on true
where a.is_active is true
  and a.deleted_at is null
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom);

comment on view tiles.tiles_admin_area_label_points_v is
    'Exactly one Point label per active admin area for PMTiles/MapLibre symbol layers. Names from core_admin_area_names (primary my/mm, en, und) with canonical_name fallback. PMTiles labels must not use fake generated names.';

comment on column tiles.tiles_admin_area_label_points_v.geom is
    'Stable label placement: ST_PointOnSurface(admin geom). Do not label from polygon fragments or stored centroid.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_area_labels_v — wrapper over label points (non-village)
--
-- Column contract: id, name, geom, name_mm, name_en, admin_level_code
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_admin_area_labels_v as
select
    lp.id,
    lp.name,
    lp.geom,
    lp.name_mm,
    lp.name_en,
    lp.admin_level_code
from tiles.tiles_admin_area_label_points_v as lp
where lp.admin_level_code <> 'village';

comment on view tiles.tiles_admin_area_labels_v is
    'Non-village admin label points for PMTiles/MapLibre. Wrapper over tiles_admin_area_label_points_v; villages use tiles_village_labels_v.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_areas_v — non-village polygons, shared name selection
--
-- Column contract: id, name, geom, name_mm, name_en, admin_level_code
-- Polygon geometry only; do not use this layer for MapLibre symbol labels.
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_admin_areas_v as
select
    lp.id,
    lp.name,
    st_setsrid(a.geom, 4326)::geometry(MultiPolygon, 4326) as geom,
    lp.name_mm,
    lp.name_en,
    lp.admin_level_code
from tiles.tiles_admin_area_label_points_v as lp
inner join core.core_admin_areas as a
    on a.id = lp.id
where lp.admin_level_code <> 'village'
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom);

comment on view tiles.tiles_admin_areas_v is
    'Non-village admin area polygons for PMTiles fill/boundary context. Names delegated from tiles_admin_area_label_points_v so name joins cannot duplicate rows. Use label_points for symbol text.';

commit;

-- =============================================================================
-- Verification (read-only)
-- =============================================================================
--
-- -- a) Duplicate label check
-- select id, count(*) as row_count
-- from tiles.tiles_admin_area_label_points_v
-- group by id
-- having count(*) > 1;
--
-- select id, count(*) as row_count
-- from tiles.tiles_admin_area_labels_v
-- group by id
-- having count(*) > 1;
--
-- select id, count(*) as row_count
-- from tiles.tiles_admin_areas_v
-- group by id
-- having count(*) > 1;
--
-- -- b) Null-name check (display name should be populated when any name row exists)
-- select count(*) as label_points_with_null_name
-- from tiles.tiles_admin_area_label_points_v
-- where coalesce(trim(name), '') = '';
--
-- select count(*) as has_mm_names_but_null_name_mm
-- from tiles.tiles_admin_area_label_points_v as lp
-- where lp.name_mm is null
--   and exists (
--       select 1
--       from core.core_admin_area_names as n
--       where n.admin_area_id = lp.id
--         and btrim(coalesce(n.name, '')) <> ''
--         and (
--             lower(btrim(coalesce(n.language_code, ''))) in ('my', 'mm')
--             or upper(btrim(coalesce(n.script_code, ''))) = 'MYMR'
--         )
--   );
--
-- select count(*) as has_en_names_but_null_name_en
-- from tiles.tiles_admin_area_label_points_v as lp
-- where lp.name_en is null
--   and exists (
--       select 1
--       from core.core_admin_area_names as n
--       where n.admin_area_id = lp.id
--         and btrim(coalesce(n.name, '')) <> ''
--         and (
--             lower(btrim(coalesce(n.language_code, ''))) = 'en'
--             or upper(btrim(coalesce(n.script_code, ''))) = 'LATN'
--         )
--   );
--
-- -- c) Sample output
-- select id, public_id, name, name_mm, name_en, admin_level_code,
--        st_geometrytype(geom) as geom_type
-- from tiles.tiles_admin_area_label_points_v
-- order by admin_level_id, name
-- limit 25;
--
-- -- d) Row count comparison: core_admin_areas vs label points
-- select
--     (select count(*)
--      from core.core_admin_areas as a
--      where a.is_active is true
--        and a.deleted_at is null
--        and a.geom is not null
--        and not st_isempty(a.geom)
--        and st_isvalid(a.geom)) as core_eligible_areas,
--     (select count(*) from tiles.tiles_admin_area_label_points_v) as label_point_rows,
--     (select count(distinct id) from tiles.tiles_admin_area_label_points_v) as label_point_distinct_ids,
--     (select count(*) from tiles.tiles_admin_area_labels_v) as non_village_label_rows,
--     (select count(*) from tiles.tiles_admin_areas_v) as non_village_polygon_rows;
--
