-- =============================================================================
-- Supabase migration 127: transport search review visibility policy
-- =============================================================================
--
-- Applies read-only search indexer eligibility for transport stops, routes, and
-- variants based on review_status. Does not change canonical transport rows or
-- map/tile visibility.
--
-- Searchable (indexed, is_public = true):
--   reviewed, verified, manual_protected, needs_review
--
-- Excluded from unified search index:
--   imported_unreviewed, rejected, deleted, inactive
--
-- needs_review rows carry quality metadata in address_parts for downstream use.
-- Ranking weights are unchanged in this migration.
-- =============================================================================

begin;

-- Shared review-status gate for transport search source views.
create or replace function search.transport_search_review_status_searchable(p_review_status text)
returns boolean
language sql
immutable
parallel safe
as $$
    select coalesce(p_review_status, '') in (
        'reviewed',
        'verified',
        'manual_protected',
        'needs_review'
    );
$$;

comment on function search.transport_search_review_status_searchable(text) is
    'True when a transport row review_status is eligible for unified public search indexing.';

-- Quality metadata for needs_review transport documents (stored in address_parts).
create or replace function search.transport_search_quality_metadata(
    p_review_status text,
    p_confidence_score numeric
)
returns jsonb
language sql
immutable
parallel safe
as $$
    select case
        when coalesce(p_review_status, '') = 'needs_review' then jsonb_build_object(
            'review_status', p_review_status,
            'confidence_score', least(100, greatest(0, coalesce(p_confidence_score, 0))),
            'search_visibility', 'needs_review'
        )
        else null::jsonb
    end;
$$;

comment on function search.transport_search_quality_metadata(text, numeric) is
    'Optional search document quality metadata for transport rows that are searchable but not fully reviewed.';

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
    search.transport_search_quality_metadata(st.review_status, st.confidence_score) as address_parts,
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
    (st.review_status in ('verified', 'manual_protected')) as is_verified,
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
  and not st_isempty(st.geom)
  and search.transport_search_review_status_searchable(st.review_status);

comment on view search.v_search_bus_stops_source is
    'Search indexer source for transport stops (bus_stop). Includes reviewed, verified, manual_protected, and needs_review active stops with geometry. Excludes imported_unreviewed and rejected.';

create or replace view search.v_search_bus_routes_source as
-- Routes
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
    search.transport_search_quality_metadata(r.review_status, r.confidence_score) as address_parts,
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
    (r.review_status in ('verified', 'manual_protected')) as is_verified,
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
  and search.transport_search_review_status_searchable(r.review_status)

union all

-- Variants (parent route must also be searchable)
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
    search.transport_search_quality_metadata(v.review_status, v.confidence_score) as address_parts,
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
    (v.review_status in ('verified', 'manual_protected')) as is_verified,
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
  and r.is_active = true
  and search.transport_search_review_status_searchable(v.review_status)
  and search.transport_search_review_status_searchable(r.review_status);

comment on view search.v_search_bus_routes_source is
    'Search indexer source for transport routes and variants. Includes reviewed, verified, manual_protected, and needs_review rows. Excludes imported_unreviewed and rejected. Variants require a searchable parent route.';

commit;
