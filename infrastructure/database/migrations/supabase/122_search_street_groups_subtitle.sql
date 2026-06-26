-- =============================================================================
-- 122_search_street_groups_subtitle.sql
--
-- Improve street_group search-result subtitle quality.
--
-- Before: subtitle = raw road_class ("primary", "residential", "tertiary").
--         Not user-friendly and tells the user nothing about WHERE the road is.
--
-- After:  subtitle = "Road · {best_admin_label}" where best_admin_label uses a
--         locality-first fallback:
--           township  ->  district  ->  town  ->  state/region
--           ->  admin_area_name_en/my  ->  road_class (final fallback only)
--
-- Only the `subtitle` expression of search.v_search_street_groups_source changes.
-- Grouping logic, geometry, names, scoring, and all other columns are identical
-- to migration 121. road_class remains available via category_code.
--
-- Apply via a persistent connection, then rebuild ONLY street_groups:
--   npm --prefix apps/api run rebuild:search-index:street-groups
-- =============================================================================

create or replace view search.v_search_street_groups_source as
with base as (
    select
        s.id,
        s.public_id,
        s.canonical_name,
        s.admin_area_id,
        s.road_class,
        coalesce(s.is_verified, false) as is_verified,
        s.updated_at,
        s.geom,
        search.norm_street_name(s.canonical_name) as norm_name
    from core.core_streets s
    where s.is_active = true
      and s.deleted_at is null
      and s.geom is not null
      and not st_isempty(s.geom)
      and s.canonical_name !~ '^road-[0-9]+$'   -- generated unnamed placeholder
      and s.canonical_name !~* '^unnamed'        -- legacy "Unnamed ..." placeholder
      and search.norm_street_name(s.canonical_name) is not null
),
grp as (
    select
        b.norm_name,
        b.admin_area_id,
        b.road_class,
        min(b.id) as rep_id,                                   -- representative street id (stable)
        (array_agg(b.public_id order by b.id))[1] as rep_public_id,
        (array_agg(b.canonical_name order by b.id))[1] as rep_canonical,
        array_agg(b.id) as member_ids,
        count(*)::int as segment_count,
        bool_or(b.is_verified) as is_verified,
        max(b.updated_at) as source_updated_at,
        st_multi(st_collect(b.geom)) as grp_geom              -- ST_Collect, not ST_Union
    from base b
    group by b.norm_name, b.admin_area_id, b.road_class
)
select
    'street_group'::text as entity_type,
    g.rep_id as entity_id,
    g.rep_public_id::text as public_id,
    coalesce(nm.name_en, nm.name_my, g.rep_canonical) as display_name,
    -- "Road · {best_admin_label}": locality-first so users see WHERE the road is.
    -- road_class is only the final fallback (e.g. roads with no admin context).
    'Road · ' || coalesce(
        ctx.hierarchy ->> 'township',
        ctx.hierarchy ->> 'district',
        ctx.hierarchy ->> 'town',
        ctx.hierarchy ->> 'state_region',
        ctx.adm_en,
        ctx.adm_my,
        nullif(btrim(g.road_class), ''),
        'Street'
    ) as subtitle,
    coalesce(nm.name_my, g.rep_canonical) as primary_name_my,
    coalesce(nm.name_en, g.rep_canonical) as primary_name_en,
    g.rep_canonical as primary_name_und,
    null::text as code,                                       -- no OSM ref/code stored
    null::text as external_id,
    g.road_class as category_code,                           -- road_class kept available
    null::text as category_name_my,
    null::text as category_name_en,
    g.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    '{}'::jsonb as address_parts,
    'MultiLineString'::text as geometry_type,
    st_pointonsurface(g.grp_geom) as centroid,               -- guaranteed-on-line point
    st_envelope(g.grp_geom) as bbox,                          -- ST_Envelope of ST_Collect
    true as has_geometry,
    false as supports_plus_code,
    concat_ws(' ',
        g.rep_canonical, nm.all_names, ctx.adm_en, ctx.adm_my,
        search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    (case g.road_class
        when 'motorway' then 90
        when 'trunk' then 80
        when 'primary' then 70
        when 'secondary' then 60
        when 'tertiary' then 50
        when 'unclassified' then 30
        when 'residential' then 25
        when 'service' then 15
        when 'track' then 10
        when 'path' then 5
        else 20
    end)::numeric as importance_score,
    0::numeric as popularity_score,
    0::numeric as confidence_score,
    null::numeric as boundary_confidence_score,
    g.is_verified,
    true as is_public,
    true as is_active,
    g.source_updated_at,
    coalesce(nm.names_json, '[]'::jsonb) as names
from grp g
left join lateral (
    select search.admin_area_name(g.admin_area_id, 'my') as adm_my,
           search.admin_area_name(g.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(g.admin_area_id) as hierarchy
) ctx on true
left join lateral (
    -- Aggregate localized names from every member segment (excluding generated
    -- placeholders), always including the representative canonical name as `und`.
    with mn as (
        select n.name,
               n.language_code,
               n.script_code,
               n.name_type,
               coalesce(n.is_primary, false) as is_primary
        from core.core_street_names n
        where n.street_id = any (g.member_ids)
          and lower(trim(coalesce(n.name_type, ''))) <> 'generated'
          and coalesce(btrim(n.name), '') <> ''
        union
        select g.rep_canonical, 'und', null::text, 'primary', true
    )
    select
        (select name from mn
            where language_code = 'my' or upper(coalesce(script_code, '')) = 'MYMR'
            order by is_primary desc, name limit 1) as name_my,
        (select name from mn
            where language_code = 'en' or upper(coalesce(script_code, '')) = 'LATN'
            order by is_primary desc, name limit 1) as name_en,
        string_agg(distinct name, ' ') as all_names,
        jsonb_agg(distinct jsonb_build_object(
            'name', name,
            'language_code', language_code,
            'script_code', script_code,
            'name_type', name_type,
            'is_primary', is_primary,
            'search_weight', 0
        )) as names_json
    from mn
) nm on true;

comment on view search.v_search_street_groups_source is
    'Grouped street search source (~14.8k rows): one row per logical road = normalize(name)+admin_area_id+road_class. Subtitle = "Road · {best_admin_label}" (township>district>town>state/region>admin name>road_class). road_class stays in category_code. Geometry = ST_Multi(ST_Collect(member geoms)) for centroid/bbox only.';
