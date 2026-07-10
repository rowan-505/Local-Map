-- =============================================================================
-- Supabase migration 130: transport route variant search eligibility
-- =============================================================================
--
-- Completes transport search coverage policy:
--   - Index route variants only when they have meaningful public identity
--     (headsign, direction name, or distinct origin/destination).
--   - Fold other variant labels into the parent route searchable_text.
--   - Never create top-level search documents for transport.route_paths.
--
-- Depends on migration 129 (canonical transport_* entity types).
--
-- After applying:
--   npm --prefix apps/api run rebuild:search-index -- --views bus_stops,bus_routes,transport_terminals
--   npm --prefix apps/api run search:health
-- =============================================================================

begin;

create or replace function search.transport_search_label_norm(p text)
returns text
language sql
immutable
parallel safe
as $$
    select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

comment on function search.transport_search_label_norm(text) is
    'Lowercase trimmed label for transport search identity comparisons.';

create or replace function search.transport_route_variant_has_public_identity(
    p_headsign text,
    p_direction_name text,
    p_variant_code text,
    p_variant_origin text,
    p_variant_destination text,
    p_route_public_name text,
    p_route_code text,
    p_route_origin text,
    p_route_destination text
)
returns boolean
language sql
immutable
parallel safe
as $$
    with norm as (
        select
            search.transport_search_label_norm(p_headsign) as headsign,
            search.transport_search_label_norm(p_direction_name) as direction_name,
            search.transport_search_label_norm(p_variant_code) as variant_code,
            search.transport_search_label_norm(p_route_public_name) as route_public_name,
            search.transport_search_label_norm(p_route_code) as route_code,
            search.transport_search_label_norm(p_variant_origin) as variant_origin,
            search.transport_search_label_norm(p_variant_destination) as variant_destination,
            search.transport_search_label_norm(p_route_origin) as route_origin,
            search.transport_search_label_norm(p_route_destination) as route_destination
    )
    select case
        when headsign <> ''
             and headsign is distinct from nullif(route_public_name, '')
             and headsign is distinct from nullif(route_code, '')
             and headsign is distinct from nullif(variant_code, '')
            then true
        when direction_name <> ''
             and direction_name is distinct from nullif(route_public_name, '')
             and direction_name is distinct from nullif(route_code, '')
             and direction_name is distinct from nullif(variant_code, '')
             and direction_name is distinct from nullif(headsign, '')
            then true
        when variant_origin <> ''
             and variant_destination <> ''
             and (
                 variant_origin is distinct from route_origin
                 or variant_destination is distinct from route_destination
             )
            then true
        else false
    end
    from norm;
$$;

comment on function search.transport_route_variant_has_public_identity(
    text, text, text, text, text, text, text, text, text
) is
    'True when a route variant deserves its own search document (headsign, direction, or distinct O-D). Variant code alone is never sufficient.';

create or replace view search.v_search_bus_routes_source as
select
    'transport_route'::text as entity_type,
    r.id as entity_id,
    r.public_id::text as public_id,
    coalesce(nullif(btrim(r.public_name), ''), nm.name_en, nm.name_my, r.route_code) as display_name,
    nullif(concat_ws(' · ',
        initcap(coalesce(nullif(btrim(r.mode), ''), 'other')),
        coalesce(r.route_kind, r.mode),
        nullif(concat_ws(' → ', r.origin_name, r.destination_name), '')
    ), '') as subtitle,
    coalesce(nm.name_my, r.public_name, r.route_code) as primary_name_my,
    coalesce(nm.name_en, r.public_name, r.route_code) as primary_name_en,
    coalesce(r.public_name, r.route_code) as primary_name_und,
    r.route_code as code,
    null::text as external_id,
    coalesce(nullif(btrim(r.mode), ''), 'other') as category_code,
    null::text as category_name_my,
    r.route_kind as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    coalesce(
        search.transport_search_document_metadata(
            r.mode, null, null, r.review_status, r.confidence_score
        ),
        '{}'::jsonb
    ) || jsonb_strip_nulls(jsonb_build_object(
        'route_code', nullif(btrim(r.route_code), ''),
        'origin_name', nullif(btrim(r.origin_name), ''),
        'destination_name', nullif(btrim(r.destination_name), '')
    )) as address_parts,
    geometrytype(g.geom) as geometry_type,
    search.safe_centroid(g.geom) as centroid,
    search.safe_bbox(g.geom) as bbox,
    (g.geom is not null and not st_isempty(g.geom)) as has_geometry,
    (search.safe_centroid(g.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        r.public_name, r.route_code, nm.all_names,
        r.origin_name, r.destination_name, r.description, r.mode, r.route_kind,
        vf.folded_labels
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
left join lateral (
    select string_agg(distinct lbl, ' ' order by lbl) as folded_labels
    from (
        select coalesce(
            nullif(btrim(v2.headsign), ''),
            nullif(btrim(v2.direction_name), ''),
            nullif(btrim(v2.variant_code), '')
        ) as lbl
        from transport.route_variants v2
        where v2.route_id = r.id
          and v2.deleted_at is null
          and v2.is_active = true
          and search.transport_search_review_status_searchable(v2.review_status)
    ) folded
    where lbl is not null and lbl <> ''
) vf on true
where r.deleted_at is null
  and r.is_active = true
  and search.transport_search_review_status_searchable(r.review_status)

union all

select
    'transport_route_variant'::text as entity_type,
    v.id as entity_id,
    v.public_id::text as public_id,
    coalesce(
        nullif(btrim(v.headsign), ''),
        nullif(btrim(v.direction_name), ''),
        nullif(btrim(concat_ws(' ', r.public_name, v.variant_code)), ''),
        concat_ws(' ', r.route_code, v.variant_code)
    ) as display_name,
    coalesce(nullif(btrim(r.public_name), ''), r.route_code) as subtitle,
    nm.name_my as primary_name_my,
    nm.name_en as primary_name_en,
    coalesce(v.headsign, v.direction_name, r.public_name, r.route_code) as primary_name_und,
    v.variant_code as code,
    null::text as external_id,
    coalesce(nullif(btrim(r.mode), ''), 'other') as category_code,
    null::text as category_name_my,
    r.route_kind as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    coalesce(
        search.transport_search_document_metadata(
            r.mode, null, null, v.review_status, v.confidence_score
        ),
        '{}'::jsonb
    ) || jsonb_strip_nulls(jsonb_build_object(
        'route_code', nullif(btrim(r.route_code), ''),
        'parent_route_public_id', r.public_id::text,
        'variant_code', nullif(btrim(v.variant_code), ''),
        'headsign', nullif(btrim(v.headsign), ''),
        'direction_name', nullif(btrim(v.direction_name), ''),
        'origin_name', nullif(btrim(v.origin_name), ''),
        'destination_name', nullif(btrim(v.destination_name), '')
    )) as address_parts,
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
  and search.transport_search_review_status_searchable(r.review_status)
  and search.transport_route_variant_has_public_identity(
      v.headsign,
      v.direction_name,
      v.variant_code,
      v.origin_name,
      v.destination_name,
      r.public_name,
      r.route_code,
      r.origin_name,
      r.destination_name
  );

comment on view search.v_search_bus_routes_source is
    'Search indexer source for transport routes/variants. Variants indexed only with meaningful headsign/direction/O-D; route_paths never indexed. Parent routes fold variant labels into searchable_text.';

-- Remove variant documents that no longer qualify (rebuild will refresh the rest).
delete from search.search_documents d
where d.entity_type in ('transport_route_variant', 'bus_route_variant')
  and not exists (
      select 1
      from search.v_search_bus_routes_source s
      where s.entity_type = 'transport_route_variant'
        and s.entity_id = d.entity_id
  );

commit;
