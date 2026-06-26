-- =============================================================================
-- Supabase migration 116: search source views (index rebuild only)
-- =============================================================================
--
-- Read-only source views the search INDEXER reads to (re)build the unified
-- runtime store from migration 115 (search.search_documents /
-- search.search_document_names). These views are NOT meant for runtime search
-- queries -- they intentionally do per-row name/hierarchy lookups and geometry
-- math that are only acceptable during a batch rebuild.
--
-- Rules honored:
--   * Only public / active / not-deleted rows are exposed.
--   * Multilingual names (my / en) plus all aliases (as jsonb in `names`).
--   * Only lightweight geometry: centroid (Point), bbox (envelope),
--     geometry_type label, has_geometry flag. No heavy geometry is selected.
--   * Points get a small bbox envelope around the point; lines/polygons use
--     ST_Envelope(geom). Centroid uses an existing centroid column when present,
--     else ST_PointOnSurface(geom).
--   * Scores on the 0-100 scale.
--   * supports_plus_code is a capability hint (centroid exists); no plus_code
--     string is emitted and search never matches a stored plus code.
--
-- ADDITIVE + idempotent: create-or-replace functions and views only. Existing
-- search.* tables (search_names / search_addresses / address_index) untouched.
--
-- Views created (entity_type in parentheses):
--   search.v_search_places_source          (place)
--   search.v_search_admin_areas_source     (admin_area)
--   search.v_search_streets_source         (street)
--   search.v_search_addresses_source       (address)
--   search.v_search_bus_stops_source       (bus_stop)
--   search.v_search_bus_routes_source       (bus_route, bus_route_variant)
--   search.v_search_buildings_source       (building)
--   search.v_search_water_lines_source     (water_line)
--   search.v_search_water_polygons_source  (water_polygon)
--   search.v_search_landuse_source         (landuse)
-- =============================================================================

begin;

create schema if not exists search;

-- ---------------------------------------------------------------------------
-- Shared geometry helpers (lightweight only)
-- ---------------------------------------------------------------------------
-- Point-safe centroid: existing point passes through; lines/polygons get a
-- guaranteed on-surface point. NULL/empty -> NULL.
create or replace function search.safe_centroid(p_geom geometry)
returns geometry
language sql
stable
as $$
    select case
        when p_geom is null or st_isempty(p_geom) then null
        when geometrytype(p_geom) in ('POINT', 'MULTIPOINT') then st_centroid(p_geom)
        else st_pointonsurface(p_geom)
    end;
$$;

-- Lightweight bbox: points get a small ~100m envelope so a "bbox" always exists;
-- lines/polygons use the true envelope. NULL/empty -> NULL.
create or replace function search.safe_bbox(p_geom geometry)
returns geometry
language sql
stable
as $$
    select case
        when p_geom is null or st_isempty(p_geom) then null
        when geometrytype(p_geom) in ('POINT', 'MULTIPOINT')
            then st_envelope(st_expand(p_geom, 0.0009))
        else st_envelope(p_geom)
    end;
$$;

-- ---------------------------------------------------------------------------
-- Admin-area name + hierarchy helpers
-- ---------------------------------------------------------------------------
create or replace function search.admin_area_name(p_admin_area_id bigint, p_lang text)
returns text
language sql
stable
as $$
    select n.name
    from core.core_admin_area_names n
    where n.admin_area_id = p_admin_area_id
      and (
          (p_lang = 'my' and (n.language_code = 'my'
              or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'))
          or (p_lang = 'en' and (n.language_code = 'en'
              or upper(trim(coalesce(n.script_code, ''))) = 'LATN'))
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary then 1
            when n.is_primary then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1;
$$;

-- Flat { level_code: name } hierarchy by climbing parent_id. Value prefers
-- English, then Myanmar, then canonical_name.
create or replace function search.admin_area_hierarchy(p_admin_area_id bigint)
returns jsonb
language sql
stable
as $$
    with recursive chain as (
        select a.id, a.parent_id, a.admin_level_id, a.canonical_name
        from core.core_admin_areas a
        where a.id = p_admin_area_id
        union all
        select pa.id, pa.parent_id, pa.admin_level_id, pa.canonical_name
        from core.core_admin_areas pa
        join chain c on pa.id = c.parent_id
    )
    select coalesce(
        jsonb_object_agg(
            lvl.code,
            coalesce(
                search.admin_area_name(c.id, 'en'),
                search.admin_area_name(c.id, 'my'),
                c.canonical_name
            )
        ) filter (where lvl.code is not null and (
            search.admin_area_name(c.id, 'en') is not null
            or search.admin_area_name(c.id, 'my') is not null
            or c.canonical_name is not null
        )),
        '{}'::jsonb
    )
    from chain c
    left join ref.ref_admin_levels lvl on lvl.id = c.admin_level_id;
$$;

-- Concatenate all hierarchy values into one searchable string.
create or replace function search.hierarchy_text(p jsonb)
returns text
language sql
immutable
as $$
    select nullif(string_agg(distinct value, ' '), '')
    from jsonb_each_text(coalesce(p, '{}'::jsonb));
$$;

-- =============================================================================
-- 1. Places
-- =============================================================================
create or replace view search.v_search_places_source as
select
    'place'::text as entity_type,
    p.id as entity_id,
    p.public_id::text as public_id,
    coalesce(nullif(btrim(p.display_name), ''), p.primary_name, nm.name_en, nm.name_my) as display_name,
    cat.name as subtitle,
    coalesce(nm.name_my, p.primary_name) as primary_name_my,
    coalesce(nm.name_en, p.display_name) as primary_name_en,
    coalesce(p.display_name, p.primary_name) as primary_name_und,
    null::text as code,
    p.external_id,
    cat.code as category_code,
    cat.name_mm as category_name_my,
    cat.name as category_name_en,
    p.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    'POINT'::text as geometry_type,
    geom.centroid,
    search.safe_bbox(geom.centroid) as bbox,
    geom.centroid is not null as has_geometry,
    geom.centroid is not null as supports_plus_code,
    concat_ws(' ',
        p.display_name, p.primary_name, nm.all_names,
        cat.name, cat.name_mm, ctx.adm_en, ctx.adm_my,
        search.hierarchy_text(ctx.hierarchy), p.external_id
    ) as searchable_text,
    coalesce(p.importance_score, 0) as importance_score,
    coalesce(p.popularity_score, 0) as popularity_score,
    coalesce(p.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(p.is_verified, false) as is_verified,
    coalesce(p.is_public, false) as is_public,
    (p.deleted_at is null) as is_active,
    p.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_places p
left join ref.ref_poi_categories cat on cat.id = p.category_id
cross join lateral (
    select coalesce(p.point_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326)) as centroid
) geom
left join lateral (
    select search.admin_area_name(p.admin_area_id, 'my') as adm_my,
           search.admin_area_name(p.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(p.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    select
        (select x.name from core.core_place_names x
            where x.place_id = p.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_place_names x
            where x.place_id = p.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_place_names x where x.place_id = p.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_place_names x where x.place_id = p.id) as all_names
) nm on true
where p.deleted_at is null
  and p.is_public = true
  and coalesce(p.point_geom, st_setsrid(st_makepoint(p.lng, p.lat), 4326)) is not null;

-- =============================================================================
-- 2. Admin areas
-- =============================================================================
create or replace view search.v_search_admin_areas_source as
select
    'admin_area'::text as entity_type,
    a.id as entity_id,
    a.public_id::text as public_id,
    coalesce(nm.name_en, nm.name_my, a.canonical_name) as display_name,
    coalesce(lvl.name, lvl.code) as subtitle,
    coalesce(nm.name_my, a.canonical_name) as primary_name_my,
    coalesce(nm.name_en, a.canonical_name) as primary_name_en,
    a.canonical_name as primary_name_und,
    a.slug as code,
    a.external_id,
    lvl.code as category_code,
    null::text as category_name_my,
    lvl.name as category_name_en,
    a.id as admin_area_id,
    nm.name_my as admin_area_name_my,
    nm.name_en as admin_area_name_en,
    search.admin_area_hierarchy(a.id) as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(a.geom) as geometry_type,
    coalesce(a.centroid, search.safe_centroid(a.geom)) as centroid,
    search.safe_bbox(a.geom) as bbox,
    (coalesce(a.centroid, search.safe_centroid(a.geom)) is not null) as has_geometry,
    (coalesce(a.centroid, search.safe_centroid(a.geom)) is not null) as supports_plus_code,
    concat_ws(' ',
        a.canonical_name, nm.all_names, lvl.name,
        search.hierarchy_text(search.admin_area_hierarchy(a.id))
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(a.address_confidence_score, 0)::numeric as confidence_score,
    coalesce(a.boundary_confidence_score, 0) as boundary_confidence_score,
    coalesce(a.is_verified, false) as is_verified,
    true as is_public,
    coalesce(a.is_active, false) as is_active,
    a.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_admin_areas a
inner join ref.ref_admin_levels lvl on lvl.id = a.admin_level_id
left join lateral (
    select
        (select x.name from core.core_admin_area_names x
            where x.admin_area_id = a.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_admin_area_names x
            where x.admin_area_id = a.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_admin_area_names x where x.admin_area_id = a.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_admin_area_names x where x.admin_area_id = a.id) as all_names
) nm on true
where a.deleted_at is null
  and a.is_active = true
  and coalesce(a.address_usage, '') <> 'disabled'
  and coalesce(a.centroid, search.safe_centroid(a.geom)) is not null;

-- =============================================================================
-- 3. Streets
-- =============================================================================
create or replace view search.v_search_streets_source as
select
    'street'::text as entity_type,
    s.id as entity_id,
    s.public_id::text as public_id,
    coalesce(nm.name_en, nm.name_my, s.canonical_name) as display_name,
    coalesce(nullif(btrim(s.road_class), ''), 'Street') as subtitle,
    coalesce(nm.name_my, s.canonical_name) as primary_name_my,
    coalesce(nm.name_en, s.canonical_name) as primary_name_en,
    s.canonical_name as primary_name_und,
    null::text as code,
    s.external_id,
    s.road_class as category_code,
    null::text as category_name_my,
    null::text as category_name_en,
    s.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(s.geom) as geometry_type,
    search.safe_centroid(s.geom) as centroid,
    search.safe_bbox(s.geom) as bbox,
    (search.safe_centroid(s.geom) is not null) as has_geometry,
    (search.safe_centroid(s.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        s.canonical_name, nm.all_names, ctx.adm_en, ctx.adm_my,
        search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    0::numeric as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(s.is_verified, false) as is_verified,
    true as is_public,
    coalesce(s.is_active, false) as is_active,
    s.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_streets s
left join lateral (
    select search.admin_area_name(s.admin_area_id, 'my') as adm_my,
           search.admin_area_name(s.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(s.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    -- core_street_names has no search_weight column.
    select
        (select x.name from core.core_street_names x
            where x.street_id = s.id
              and lower(trim(coalesce(x.name_type, ''))) <> 'generated'
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.name limit 1) as name_my,
        (select x.name from core.core_street_names x
            where x.street_id = s.id
              and lower(trim(coalesce(x.name_type, ''))) <> 'generated'
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', 0)
                    order by x.is_primary desc, x.name)
            from core.core_street_names x
            where x.street_id = s.id
              and lower(trim(coalesce(x.name_type, ''))) <> 'generated') as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_street_names x
            where x.street_id = s.id
              and lower(trim(coalesce(x.name_type, ''))) <> 'generated') as all_names
) nm on true
where s.deleted_at is null
  and s.is_active = true
  and s.geom is not null
  and not st_isempty(s.geom);

-- =============================================================================
-- 4. Addresses
-- Supports "village, township, district" and partial "ward, township" queries:
-- structured parts -> address_parts, admin levels -> admin_hierarchy, and the
-- composed multilingual lines feed searchable_text (reuses migration 048 fns).
-- =============================================================================
create or replace view search.v_search_addresses_source as
select
    'address'::text as entity_type,
    a.id as entity_id,
    a.public_id::text as public_id,
    coalesce(nullif(btrim(a.full_address), ''), parts.composed) as display_name,
    'Address'::text as subtitle,
    null::text as primary_name_my,
    null::text as primary_name_en,
    coalesce(nullif(btrim(a.full_address), ''), parts.composed) as primary_name_und,
    nullif(btrim(coalesce(parts.postcode, a.postal_code, a.postcode)), '') as code,
    null::text as external_id,
    null::text as category_code,
    null::text as category_name_my,
    null::text as category_name_en,
    a.admin_area_id,
    search.admin_area_name(a.admin_area_id, 'my') as admin_area_name_my,
    search.admin_area_name(a.admin_area_id, 'en') as admin_area_name_en,
    jsonb_strip_nulls(jsonb_build_object(
        'village', parts.village,
        'ward', parts.ward,
        'village_tract', parts.village_tract,
        'township', coalesce(parts.township, nullif(btrim(a.township), '')),
        'district', coalesce(parts.district, nullif(btrim(a.district), '')),
        'region_state', coalesce(parts.region, nullif(btrim(a.state_region), '')),
        'country', coalesce(parts.country, nullif(btrim(a.country), ''))
    )) as admin_hierarchy,
    coalesce(
        nullif(btrim(a.full_address), ''),
        search.build_address_search_line(a.id, 'en'),
        search.build_address_search_line(a.id, 'my'),
        parts.composed
    ) as address_text,
    jsonb_strip_nulls(jsonb_build_object(
        'house_number', coalesce(parts.house_number, nullif(btrim(a.house_number), '')),
        'unit_number', nullif(btrim(a.unit_number), ''),
        'street', coalesce(parts.street, nullif(btrim(a.street_name), '')),
        'quarter', nullif(btrim(a.quarter), ''),
        'suburb', nullif(btrim(a.suburb), ''),
        'city', coalesce(parts.city, nullif(btrim(a.city), '')),
        'postcode', nullif(btrim(coalesce(parts.postcode, a.postal_code, a.postcode)), ''),
        'full_address', nullif(btrim(a.full_address), '')
    )) as address_parts,
    'POINT'::text as geometry_type,
    search.safe_centroid(coalesce(a.entrance_geom, a.point_geom, a.geom)) as centroid,
    search.safe_bbox(coalesce(a.entrance_geom, a.point_geom, a.geom)) as bbox,
    (coalesce(a.entrance_geom, a.point_geom, a.geom) is not null) as has_geometry,
    (coalesce(a.entrance_geom, a.point_geom, a.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        a.full_address,
        search.build_address_search_line(a.id, 'en'),
        search.build_address_search_line(a.id, 'my'),
        search.build_address_search_line(a.id, 'und'),
        a.street_name, a.quarter, a.suburb, a.township, a.city, a.district,
        a.state_region, a.country,
        search.admin_area_name(a.admin_area_id, 'en'),
        search.admin_area_name(a.admin_area_id, 'my'),
        search.hierarchy_text(search.admin_area_hierarchy(a.admin_area_id))
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(a.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(a.is_verified, false) as is_verified,
    coalesce(a.is_public, false) as is_public,
    (a.deleted_at is null) as is_active,
    a.updated_at as source_updated_at,
    '[]'::jsonb as names
from core.core_addresses a
left join lateral (
    select
        search.pick_address_component_value(a.id, 'house_number') as house_number,
        search.pick_address_field_text(a.id, 'en', 'street') as street,
        search.pick_address_component_value(a.id, 'village') as village,
        search.pick_address_component_value(a.id, 'ward') as ward,
        search.pick_address_component_value(a.id, 'village_tract') as village_tract,
        search.pick_address_component_value(a.id, 'town') as town,
        search.pick_address_component_value(a.id, 'city') as city,
        search.pick_address_component_value(a.id, 'township') as township,
        search.pick_address_component_value(a.id, 'district') as district,
        search.pick_address_component_value(a.id, 'region') as region,
        search.pick_address_component_value(a.id, 'postcode') as postcode,
        search.pick_address_component_value(a.id, 'country') as country,
        search.build_address_search_line(a.id, 'en') as composed
) parts on true
where a.deleted_at is null
  and a.is_public = true
  and coalesce(a.entrance_geom, a.point_geom, a.geom) is not null;

-- =============================================================================
-- 5. Bus stops
-- =============================================================================
create or replace view search.v_search_bus_stops_source as
select
    'bus_stop'::text as entity_type,
    st.id as entity_id,
    st.public_id::text as public_id,
    coalesce(st.name_en, nm.name_en, st.name_mm, nm.name_my, st.name) as display_name,
    coalesce(nullif(btrim(st.stop_type), ''), 'Bus stop') as subtitle,
    coalesce(nm.name_my, st.name_mm, st.name) as primary_name_my,
    coalesce(nm.name_en, st.name_en, st.name) as primary_name_en,
    coalesce(st.name, st.name_en, st.name_mm) as primary_name_und,
    st.stop_code as code,
    null::text as external_id,
    st.stop_type as category_code,
    null::text as category_name_my,
    null::text as category_name_en,
    st.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    'POINT'::text as geometry_type,
    search.safe_centroid(st.geom) as centroid,
    search.safe_bbox(st.geom) as bbox,
    (search.safe_centroid(st.geom) is not null) as has_geometry,
    (search.safe_centroid(st.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        st.name, st.name_mm, st.name_en, nm.all_names, st.stop_code,
        ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(st.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    false as is_verified,
    true as is_public,
    coalesce(st.is_active, false) as is_active,
    st.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from transport.stops st
left join lateral (
    select search.admin_area_name(st.admin_area_id, 'my') as adm_my,
           search.admin_area_name(st.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(st.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    select
        (select x.name from transport.stop_names x
            where x.stop_id = st.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from transport.stop_names x
            where x.stop_id = st.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from transport.stop_names x where x.stop_id = st.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from transport.stop_names x where x.stop_id = st.id) as all_names
) nm on true
where st.deleted_at is null
  and st.is_active = true
  and st.geom is not null
  and not st_isempty(st.geom);

-- =============================================================================
-- 6. Bus routes (+ variants)
--   route-level rows  -> entity_type 'bus_route' (geometry aggregated from
--                        all active variant paths)
--   variant-level rows -> entity_type 'bus_route_variant' (primary path geom)
-- =============================================================================
create or replace view search.v_search_bus_routes_source as
-- 6a. Routes
select
    'bus_route'::text as entity_type,
    r.id as entity_id,
    r.public_id::text as public_id,
    coalesce(nullif(btrim(r.public_name), ''), nm.name_en, nm.name_my, r.route_code) as display_name,
    nullif(concat_ws(' · ',
        coalesce(r.route_kind, r.mode),
        nullif(concat_ws(' → ', r.origin_name, r.destination_name), '')
    ), '') as subtitle,
    coalesce(nm.name_my, r.public_name, r.route_code) as primary_name_my,
    coalesce(nm.name_en, r.public_name, r.route_code) as primary_name_en,
    coalesce(r.public_name, r.route_code) as primary_name_und,
    r.route_code as code,
    null::text as external_id,
    r.mode as category_code,
    null::text as category_name_my,
    r.route_kind as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(g.geom) as geometry_type,
    search.safe_centroid(g.geom) as centroid,
    search.safe_bbox(g.geom) as bbox,
    (g.geom is not null and not st_isempty(g.geom)) as has_geometry,
    (search.safe_centroid(g.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        r.public_name, r.route_code, nm.all_names,
        r.origin_name, r.destination_name, r.description, r.mode, r.route_kind
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(r.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    false as is_verified,
    true as is_public,
    coalesce(r.is_active, false) as is_active,
    r.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from transport.routes r
left join lateral (
    select st_collect(rp.geom) as geom
    from transport.route_variants v
    join transport.route_paths rp
        on rp.route_variant_id = v.id and rp.is_active = true and rp.deleted_at is null
    where v.route_id = r.id and v.is_active = true and v.deleted_at is null
) g on true
left join lateral (
    select
        (select x.name from transport.route_names x
            where x.route_id = r.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from transport.route_names x
            where x.route_id = r.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from transport.route_names x where x.route_id = r.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from transport.route_names x where x.route_id = r.id) as all_names
) nm on true
where r.deleted_at is null
  and r.is_active = true

union all

-- 6b. Variants
select
    'bus_route_variant'::text as entity_type,
    v.id as entity_id,
    v.public_id::text as public_id,
    coalesce(nullif(btrim(v.headsign), ''), nullif(btrim(v.direction_name), ''),
        nullif(btrim(concat_ws(' ', r.public_name, v.variant_code)), ''),
        concat_ws(' ', r.route_code, v.variant_code)) as display_name,
    coalesce(nullif(btrim(r.public_name), ''), r.route_code) as subtitle,
    nm.name_my as primary_name_my,
    nm.name_en as primary_name_en,
    coalesce(v.headsign, v.direction_name, r.public_name, r.route_code) as primary_name_und,
    v.variant_code as code,
    null::text as external_id,
    r.mode as category_code,
    null::text as category_name_my,
    r.route_kind as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(g.geom) as geometry_type,
    search.safe_centroid(g.geom) as centroid,
    search.safe_bbox(g.geom) as bbox,
    (g.geom is not null and not st_isempty(g.geom)) as has_geometry,
    (search.safe_centroid(g.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        v.headsign, v.direction_name, v.variant_code, v.origin_name, v.destination_name,
        r.public_name, r.route_code, nm.all_names, r.mode, r.route_kind
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(v.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    false as is_verified,
    true as is_public,
    coalesce(v.is_active, false) as is_active,
    v.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from transport.route_variants v
inner join transport.routes r on r.id = v.route_id
left join lateral (
    select rp.geom
    from transport.route_paths rp
    where rp.route_variant_id = v.id and rp.is_active = true and rp.deleted_at is null
    order by case when rp.path_kind = 'primary' then 0 else 1 end, rp.id
    limit 1
) g on true
left join lateral (
    select
        (select x.name from transport.route_names x
            where x.route_id = r.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from transport.route_names x
            where x.route_id = r.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from transport.route_names x where x.route_id = r.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from transport.route_names x where x.route_id = r.id) as all_names
) nm on true
where v.deleted_at is null
  and v.is_active = true
  and r.deleted_at is null
  and r.is_active = true;

-- =============================================================================
-- 7. Buildings (named only -- unnamed footprints are not useful search targets)
-- =============================================================================
create or replace view search.v_search_buildings_source as
select
    'building'::text as entity_type,
    b.id as entity_id,
    b.public_id::text as public_id,
    coalesce(nm.name_en, nm.name_my, b.name) as display_name,
    bt.name as subtitle,
    coalesce(nm.name_my, b.name) as primary_name_my,
    coalesce(nm.name_en, b.name) as primary_name_en,
    b.name as primary_name_und,
    null::text as code,
    b.external_id,
    bt.code as category_code,
    bt.name_mm as category_name_my,
    bt.name as category_name_en,
    b.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(b.geom) as geometry_type,
    coalesce(b.centroid, search.safe_centroid(b.geom)) as centroid,
    search.safe_bbox(b.geom) as bbox,
    (coalesce(b.centroid, search.safe_centroid(b.geom)) is not null) as has_geometry,
    (coalesce(b.centroid, search.safe_centroid(b.geom)) is not null) as supports_plus_code,
    concat_ws(' ',
        b.name, nm.all_names, bt.name, bt.name_mm,
        ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(b.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(b.is_verified, false) as is_verified,
    true as is_public,
    coalesce(b.is_active, false) as is_active,
    b.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_map_buildings b
left join ref.ref_building_types bt on bt.id = b.building_type_id
left join lateral (
    select search.admin_area_name(b.admin_area_id, 'my') as adm_my,
           search.admin_area_name(b.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(b.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    select
        (select x.name from core.core_map_building_names x
            where x.building_id = b.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_map_building_names x
            where x.building_id = b.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_map_building_names x where x.building_id = b.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_map_building_names x where x.building_id = b.id) as all_names
) nm on true
where b.deleted_at is null
  and b.is_active = true
  and b.geom is not null
  and not st_isempty(b.geom)
  and (
      nullif(btrim(b.name), '') is not null
      or exists (select 1 from core.core_map_building_names x where x.building_id = b.id)
  );

-- =============================================================================
-- 8. Water lines (named only)
-- =============================================================================
create or replace view search.v_search_water_lines_source as
select
    'water_line'::text as entity_type,
    w.id as entity_id,
    null::text as public_id,
    coalesce(nm.name_en, nm.name_my, w.name) as display_name,
    coalesce(nullif(btrim(w.class_code), ''), 'Waterway') as subtitle,
    coalesce(nm.name_my, w.name) as primary_name_my,
    coalesce(nm.name_en, w.name) as primary_name_en,
    w.name as primary_name_und,
    w.class_code as code,
    w.external_id,
    w.class_code as category_code,
    null::text as category_name_my,
    null::text as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(w.geom) as geometry_type,
    search.safe_centroid(w.geom) as centroid,
    search.safe_bbox(w.geom) as bbox,
    (search.safe_centroid(w.geom) is not null) as has_geometry,
    (search.safe_centroid(w.geom) is not null) as supports_plus_code,
    concat_ws(' ', w.name, nm.all_names, w.class_code) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    0::numeric as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(w.is_verified, false) as is_verified,
    true as is_public,
    coalesce(w.is_active, false) as is_active,
    w.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_map_water_lines w
left join lateral (
    select
        (select x.name from core.core_map_water_line_names x
            where x.water_line_id = w.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_map_water_line_names x
            where x.water_line_id = w.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_map_water_line_names x where x.water_line_id = w.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_map_water_line_names x where x.water_line_id = w.id) as all_names
) nm on true
where w.deleted_at is null
  and w.is_active = true
  and w.geom is not null
  and not st_isempty(w.geom)
  and (
      nullif(btrim(w.name), '') is not null
      or exists (select 1 from core.core_map_water_line_names x where x.water_line_id = w.id)
  );

-- =============================================================================
-- 9. Water polygons (named only)
-- =============================================================================
create or replace view search.v_search_water_polygons_source as
select
    'water_polygon'::text as entity_type,
    w.id as entity_id,
    null::text as public_id,
    coalesce(nm.name_en, nm.name_my, w.name) as display_name,
    coalesce(nullif(btrim(w.class_code), ''), 'Water') as subtitle,
    coalesce(nm.name_my, w.name) as primary_name_my,
    coalesce(nm.name_en, w.name) as primary_name_en,
    w.name as primary_name_und,
    w.class_code as code,
    w.external_id,
    w.class_code as category_code,
    null::text as category_name_my,
    null::text as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(w.geom) as geometry_type,
    search.safe_centroid(w.geom) as centroid,
    search.safe_bbox(w.geom) as bbox,
    (search.safe_centroid(w.geom) is not null) as has_geometry,
    (search.safe_centroid(w.geom) is not null) as supports_plus_code,
    concat_ws(' ', w.name, nm.all_names, w.class_code) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    0::numeric as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(w.is_verified, false) as is_verified,
    true as is_public,
    coalesce(w.is_active, false) as is_active,
    w.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_map_water_polygons w
left join lateral (
    select
        (select x.name from core.core_map_water_polygon_names x
            where x.water_polygon_id = w.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_map_water_polygon_names x
            where x.water_polygon_id = w.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_map_water_polygon_names x where x.water_polygon_id = w.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_map_water_polygon_names x where x.water_polygon_id = w.id) as all_names
) nm on true
where w.deleted_at is null
  and w.is_active = true
  and w.geom is not null
  and not st_isempty(w.geom)
  and (
      nullif(btrim(w.name), '') is not null
      or exists (select 1 from core.core_map_water_polygon_names x where x.water_polygon_id = w.id)
  );

-- =============================================================================
-- 10. Landuse (named only)
-- =============================================================================
create or replace view search.v_search_landuse_source as
select
    'landuse'::text as entity_type,
    lu.id as entity_id,
    lu.public_id::text as public_id,
    coalesce(nm.name_en, nm.name_my, lu.name, lc.name_en) as display_name,
    coalesce(lc.name_en, lu.class_code) as subtitle,
    coalesce(nm.name_my, lu.name, lc.name_mm) as primary_name_my,
    coalesce(nm.name_en, lu.name, lc.name_en) as primary_name_en,
    coalesce(lu.name, lc.name_en) as primary_name_und,
    coalesce(lc.code, lu.class_code) as code,
    lu.external_id,
    coalesce(lc.code, lu.class_code) as category_code,
    lc.name_mm as category_name_my,
    lc.name_en as category_name_en,
    lu.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    null::jsonb as address_parts,
    geometrytype(lu.geom) as geometry_type,
    coalesce(lu.centroid, search.safe_centroid(lu.geom)) as centroid,
    search.safe_bbox(lu.geom) as bbox,
    (coalesce(lu.centroid, search.safe_centroid(lu.geom)) is not null) as has_geometry,
    (coalesce(lu.centroid, search.safe_centroid(lu.geom)) is not null) as supports_plus_code,
    concat_ws(' ',
        lu.name, nm.all_names, lc.name_en, lc.name_mm, lu.class_code,
        ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(lu.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    coalesce(lu.is_verified, false) as is_verified,
    true as is_public,
    coalesce(lu.is_active, false) as is_active,
    lu.updated_at as source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from core.core_map_landuse lu
left join ref.ref_landuse_classes lc on lc.id = lu.landuse_class_id
left join lateral (
    select search.admin_area_name(lu.admin_area_id, 'my') as adm_my,
           search.admin_area_name(lu.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(lu.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    select
        (select x.name from core.core_map_landuse_names x
            where x.landuse_id = lu.id
              and (x.language_code = 'my' or upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_my,
        (select x.name from core.core_map_landuse_names x
            where x.landuse_id = lu.id
              and (x.language_code = 'en' or upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            order by case when x.name_type = 'official' and x.is_primary then 1
                          when x.is_primary then 2
                          when x.name_type = 'official' then 3 else 4 end,
                     x.search_weight desc nulls last, x.name limit 1) as name_en,
        (select jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    order by x.is_primary desc, x.name)
            from core.core_map_landuse_names x where x.landuse_id = lu.id) as names_json,
        (select string_agg(distinct x.name, ' ')
            from core.core_map_landuse_names x where x.landuse_id = lu.id) as all_names
) nm on true
where lu.deleted_at is null
  and lu.is_active = true
  and lu.geom is not null
  and not st_isempty(lu.geom)
  and (
      nullif(btrim(lu.name), '') is not null
      or exists (select 1 from core.core_map_landuse_names x where x.landuse_id = lu.id)
  );

commit;

-- =============================================================================
-- Rollback (manual; run only if reverting this migration):
--   begin;
--     drop view if exists search.v_search_landuse_source;
--     drop view if exists search.v_search_water_polygons_source;
--     drop view if exists search.v_search_water_lines_source;
--     drop view if exists search.v_search_buildings_source;
--     drop view if exists search.v_search_bus_routes_source;
--     drop view if exists search.v_search_bus_stops_source;
--     drop view if exists search.v_search_addresses_source;
--     drop view if exists search.v_search_streets_source;
--     drop view if exists search.v_search_admin_areas_source;
--     drop view if exists search.v_search_places_source;
--     drop function if exists search.hierarchy_text(jsonb);
--     drop function if exists search.admin_area_hierarchy(bigint);
--     drop function if exists search.admin_area_name(bigint, text);
--     drop function if exists search.safe_bbox(geometry);
--     drop function if exists search.safe_centroid(geometry);
--   commit;
-- Note: helper functions are CREATE OR REPLACE and shared only by these views.
-- Existing search.search_names / search.search_addresses / search.address_index
-- (and the migration 048 address helper functions reused here) are untouched.
-- =============================================================================
-- End 116_search_source_views.sql
-- =============================================================================
