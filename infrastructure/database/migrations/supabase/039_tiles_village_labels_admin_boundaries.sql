-- =============================================================================
-- Supabase migration 039: village label points + admin boundary tile filtering
-- =============================================================================
--
-- Purpose:
--   - Villages render as name-only labels (tiles_village_labels_v), not as
--     prominent settlement_extent / approximate polygon boundaries on the basemap.
--   - Higher admin levels (township, ward, village_tract, etc.) keep boundary
--     lines via tiles_admin_boundaries_v with village clutter excluded.
--   - tiles_admin_areas_v / tiles_admin_area_labels_v exclude villages so labels
--     are not duplicated once village_labels is in the style.
--
-- Requires: 030 (tile views), 037/038 (boundary metadata columns).
--
-- =============================================================================

begin;

create schema if not exists tiles;

-- PostgreSQL cannot change view column names/order via CREATE OR REPLACE VIEW.
drop view if exists tiles.tiles_village_labels_v cascade;
drop view if exists tiles.tiles_admin_area_labels_v cascade;
drop view if exists tiles.tiles_admin_areas_v cascade;
drop view if exists tiles.tiles_admin_boundaries_v cascade;

-- ---------------------------------------------------------------------------
-- tiles.tiles_village_labels_v — one Point per village for MapLibre symbols
-- ---------------------------------------------------------------------------
create view tiles.tiles_village_labels_v as
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
    al.code as admin_level_code,
    a.boundary_status,
    a.address_usage,
    a.is_official_boundary,
    a.boundary_confidence_score::float8 as boundary_confidence_score,
    st_setsrid(
        coalesce(
            case
                when a.centroid is not null
                     and not st_isempty(a.centroid)
                     and st_isvalid(a.centroid)
                    then a.centroid
                else null
            end,
            case
                when a.geom is not null
                     and not st_isempty(a.geom)
                     and st_isvalid(a.geom)
                    then st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
                else null
            end
        ),
        4326
    )::geometry(Point, 4326) as geom
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
where a.is_active is true
  and a.deleted_at is null
  and a.address_usage <> 'disabled'
  and al.code = 'village'
  and a.boundary_status in (
      'official',
      'surveyed',
      'approximate',
      'settlement_extent'
  )
  and coalesce(
        case
            when a.centroid is not null
                 and not st_isempty(a.centroid)
                 and st_isvalid(a.centroid)
                then a.centroid
            else null
        end,
        case
            when a.geom is not null
                 and not st_isempty(a.geom)
                 and st_isvalid(a.geom)
                then st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
            else null
        end
    ) is not null;

comment on view tiles.tiles_village_labels_v is
    'Village label points for MapLibre symbol layers. No boundary_status in label text — metadata is for filters/address only.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_boundaries_v — higher levels + optional official/surveyed villages
-- ---------------------------------------------------------------------------
create view tiles.tiles_admin_boundaries_v as
select
    a.id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(an_und.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    a.admin_level_id,
    al.code as admin_level_code,
    a.boundary_status,
    a.address_usage,
    a.is_official_boundary,
    st_setsrid(a.geom, 4326)::geometry(MultiPolygon, 4326) as geom
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
where a.is_active is true
  and a.deleted_at is null
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom)
  and (
      al.code <> 'village'
      or a.boundary_status in ('official', 'surveyed')
  );

comment on view tiles.tiles_admin_boundaries_v is
    'Admin boundary outlines for map tiles. Excludes approximate/settlement_extent/unknown village polygons.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_areas_v — non-village polygons (legacy layer name / PMTiles)
-- ---------------------------------------------------------------------------
create view tiles.tiles_admin_areas_v as
select
    a.id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(an_und.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    st_setsrid(a.geom, 4326)::geometry(MultiPolygon, 4326) as geom,
    an_mm.name as name_mm,
    an_en.name as name_en,
    al.code as admin_level_code
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
where a.is_active is true
  and a.deleted_at is null
  and al.code <> 'village'
  and a.geom is not null
  and not st_isempty(a.geom)
  and st_isvalid(a.geom);

comment on view tiles.tiles_admin_areas_v is
    'Non-village admin area polygons for PMTiles. Village names use tiles_village_labels_v instead.';

-- ---------------------------------------------------------------------------
-- tiles.tiles_admin_area_labels_v — non-village label points (township, ward, …)
-- ---------------------------------------------------------------------------
create view tiles.tiles_admin_area_labels_v as
select
    a.id,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(an_und.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    st_setsrid(
        coalesce(
            case
                when a.centroid is not null
                     and not st_isempty(a.centroid)
                     and st_isvalid(a.centroid)
                    then a.centroid
                else null
            end,
            case
                when a.geom is not null
                     and not st_isempty(a.geom)
                     and st_isvalid(a.geom)
                    then st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
                else null
            end
        ),
        4326
    )::geometry(Point, 4326) as geom,
    an_mm.name as name_mm,
    an_en.name as name_en,
    al.code as admin_level_code
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
where a.is_active is true
  and a.deleted_at is null
  and al.code <> 'village'
  and coalesce(
        case
            when a.centroid is not null
                 and not st_isempty(a.centroid)
                 and st_isvalid(a.centroid)
                then a.centroid
            else null
        end,
        case
            when a.geom is not null
                 and not st_isempty(a.geom)
                 and st_isvalid(a.geom)
                then st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
            else null
        end
    ) is not null;

comment on view tiles.tiles_admin_area_labels_v is
    'Label points for non-village admin areas (township, ward, village_tract, etc.).';

commit;

-- =============================================================================
-- Verification (read-only)
-- =============================================================================
--
-- SELECT table_schema, table_name
-- FROM information_schema.views
-- WHERE table_schema = 'tiles'
-- ORDER BY table_name;
--
