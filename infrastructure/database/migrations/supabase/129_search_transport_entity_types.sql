-- =============================================================================
-- Supabase migration 129: mode-agnostic transport search entity types
-- =============================================================================
--
-- Normalizes unified search entity_type values for transport:
--   bus_stop            -> transport_stop
--   bus_route           -> transport_route
--   bus_route_variant   -> transport_route_variant
--   (new)               -> transport_terminal
--
-- Does NOT rename canonical transport tables. Search source views keep their
-- existing names (v_search_bus_stops_source, etc.) but emit canonical entity_type
-- values and richer address_parts metadata (mode, stop_type, review_status).
--
-- After applying: rebuild transport search families, e.g.
--   npm --prefix apps/api run search:reconcile -- --repair
-- =============================================================================

begin;

create or replace function search.transport_search_document_metadata(
    p_mode text,
    p_stop_type text default null,
    p_terminal_role text default null,
    p_review_status text default null,
    p_confidence_score numeric default null
)
returns jsonb
language sql
immutable
parallel safe
as $$
    select nullif(
        coalesce(
            search.transport_search_quality_metadata(p_review_status, p_confidence_score),
            '{}'::jsonb
        ) || jsonb_strip_nulls(jsonb_build_object(
            'mode', nullif(lower(btrim(coalesce(p_mode, ''))), ''),
            'stop_type', nullif(lower(btrim(coalesce(p_stop_type, ''))), ''),
            'terminal_role', nullif(lower(btrim(coalesce(p_terminal_role, ''))), ''),
            'review_status', nullif(lower(btrim(coalesce(p_review_status, ''))), ''),
            'verification_status', case
                when coalesce(p_review_status, '') in ('verified', 'manual_protected') then 'verified'
                when coalesce(p_review_status, '') = 'reviewed' then 'reviewed'
                when coalesce(p_review_status, '') = 'needs_review' then 'needs_review'
                else null
            end
        )),
        '{}'::jsonb
    );
$$;

comment on function search.transport_search_document_metadata(text, text, text, text, numeric) is
    'Unified search address_parts payload for transport rows: mode, stop_type/terminal_role, review_status, optional needs_review quality metadata.';

create or replace view search.v_search_bus_stops_source as
select
    'transport_stop'::text as entity_type,
    st.id as entity_id,
    st.public_id::text as public_id,
    coalesce(st.name_en, nm.name_en, st.name_mm, nm.name_my, st.name) as display_name,
    nullif(concat_ws(' · ',
        initcap(coalesce(nullif(btrim(st.mode), ''), 'other')),
        coalesce(nullif(btrim(st.stop_type), ''), 'stop')
    ), '') as subtitle,
    coalesce(nm.name_my, st.name_mm, st.name) as primary_name_my,
    coalesce(nm.name_en, st.name_en, st.name) as primary_name_en,
    coalesce(st.name, st.name_en, st.name_mm) as primary_name_und,
    st.stop_code as code,
    null::text as external_id,
    coalesce(nullif(btrim(st.mode), ''), 'other') as category_code,
    null::text as category_name_my,
    coalesce(nullif(btrim(st.stop_type), ''), 'stop') as category_name_en,
    st.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    search.transport_search_document_metadata(
        st.mode, st.stop_type, null, st.review_status, st.confidence_score
    ) as address_parts,
    'POINT'::text as geometry_type,
    search.safe_centroid(st.geom) as centroid,
    search.safe_bbox(st.geom) as bbox,
    (search.safe_centroid(st.geom) is not null) as has_geometry,
    (search.safe_centroid(st.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        st.name, st.name_mm, st.name_en, nm.all_names, st.stop_code,
        st.mode, st.stop_type,
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
    'Search indexer source for transport stops (entity_type=transport_stop). All modes (bus, train, ferry, express, flight, other). Excludes imported_unreviewed and rejected.';

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
    search.transport_search_document_metadata(
        r.mode, null, null, r.review_status, r.confidence_score
    ) as address_parts,
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

select
    'transport_route_variant'::text as entity_type,
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
    coalesce(nullif(btrim(r.mode), ''), 'other') as category_code,
    null::text as category_name_my,
    r.route_kind as category_name_en,
    null::bigint as admin_area_id,
    null::text as admin_area_name_my,
    null::text as admin_area_name_en,
    '{}'::jsonb as admin_hierarchy,
    null::text as address_text,
    search.transport_search_document_metadata(
        r.mode, null, null, v.review_status, v.confidence_score
    ) as address_parts,
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
    'Search indexer source for transport routes/variants (entity_type=transport_route|transport_route_variant). All modes.';

create or replace view search.v_search_transport_terminals_source as
select
    'transport_terminal'::text as entity_type,
    t.id as entity_id,
    t.public_id::text as public_id,
    coalesce(t.name_en, t.name_mm, t.name) as display_name,
    nullif(concat_ws(' · ',
        initcap(coalesce(nullif(btrim(t.mode), ''), 'other')),
        coalesce(nullif(btrim(t.terminal_role), ''), 'terminal')
    ), '') as subtitle,
    coalesce(t.name_mm, t.name) as primary_name_my,
    coalesce(t.name_en, t.name) as primary_name_en,
    coalesce(t.name, t.name_en, t.name_mm) as primary_name_und,
    t.terminal_code as code,
    null::text as external_id,
    coalesce(nullif(btrim(t.mode), ''), 'other') as category_code,
    null::text as category_name_my,
    coalesce(nullif(btrim(t.terminal_role), ''), 'terminal') as category_name_en,
    t.admin_area_id,
    ctx.adm_my as admin_area_name_my,
    ctx.adm_en as admin_area_name_en,
    ctx.hierarchy as admin_hierarchy,
    null::text as address_text,
    search.transport_search_document_metadata(
        t.mode, 'terminal', t.terminal_role, t.review_status, t.confidence_score
    ) as address_parts,
    'POINT'::text as geometry_type,
    search.safe_centroid(t.geom) as centroid,
    search.safe_bbox(t.geom) as bbox,
    (search.safe_centroid(t.geom) is not null) as has_geometry,
    (search.safe_centroid(t.geom) is not null) as supports_plus_code,
    concat_ws(' ',
        t.name, t.name_mm, t.name_en, t.terminal_code,
        t.mode, t.terminal_role,
        ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) as searchable_text,
    0::numeric as importance_score,
    0::numeric as popularity_score,
    coalesce(t.confidence_score, 0) as confidence_score,
    0::numeric as boundary_confidence_score,
    (t.review_status in ('verified', 'manual_protected')) as is_verified,
    true as is_public,
    coalesce(t.is_active, false) as is_active,
    t.updated_at as source_updated_at,
  '[]'::jsonb as names
from transport.terminals t
left join lateral (
    select search.admin_area_name(t.admin_area_id, 'my') as adm_my,
           search.admin_area_name(t.admin_area_id, 'en') as adm_en,
           search.admin_area_hierarchy(t.admin_area_id) as hierarchy
) ctx on true
where t.deleted_at is null
  and t.is_active = true
  and t.geom is not null
  and not st_isempty(t.geom)
  and search.transport_search_review_status_searchable(t.review_status);

comment on view search.v_search_transport_terminals_source is
    'Search indexer source for transport terminals (entity_type=transport_terminal). All modes.';

-- Rewrite existing indexed transport rows to canonical entity types.
update search.search_documents
set entity_type = 'transport_stop'
where entity_type = 'bus_stop';

update search.search_documents
set entity_type = 'transport_route'
where entity_type = 'bus_route';

update search.search_documents
set entity_type = 'transport_route_variant'
where entity_type = 'bus_route_variant';

create or replace function search.sync_search_documents(
    p_entity_type text,
    p_entity_ids bigint[]
)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_input_type text := lower(btrim(coalesce(p_entity_type, '')));
    v_entity_type text;
    v_entity_id bigint;
    v_view_rel text;
    v_synced int := 0;
    v_removed int := 0;
    v_row_count int;
    v_legacy_types text[];
begin
    if p_entity_ids is null or cardinality(p_entity_ids) = 0 then
        return jsonb_build_object(
            'entity_type', v_input_type,
            'synced', 0,
            'removed', 0,
            'entity_ids', '[]'::jsonb
        );
    end if;

    v_entity_type := case v_input_type
        when 'bus_stop' then 'transport_stop'
        when 'bus_route' then 'transport_route'
        when 'bus_route_variant' then 'transport_route_variant'
        else v_input_type
    end;

    v_view_rel := case v_entity_type
        when 'place' then 'search.v_search_places_source'
        when 'admin_area' then 'search.v_search_admin_areas_source'
        when 'transport_stop' then 'search.v_search_bus_stops_source'
        when 'transport_terminal' then 'search.v_search_transport_terminals_source'
        when 'transport_route' then 'search.v_search_bus_routes_source'
        when 'transport_route_variant' then 'search.v_search_bus_routes_source'
        when 'street_group' then 'search.v_search_street_groups_source'
        else null
    end;

    if v_view_rel is null then
        raise exception 'Unsupported search sync entity_type: %', p_entity_type
            using hint = 'Supported: place, admin_area, transport_stop, transport_terminal, transport_route, transport_route_variant, street_group (legacy bus_* aliases accepted)';
    end if;

    v_legacy_types := case v_entity_type
        when 'transport_stop' then array['transport_stop', 'bus_stop']
        when 'transport_route' then array['transport_route', 'bus_route']
        when 'transport_route_variant' then array['transport_route_variant', 'bus_route_variant']
        else array[v_entity_type]
    end;

    foreach v_entity_id in array p_entity_ids loop
        delete from search.search_documents
        where entity_id = v_entity_id
          and entity_type = any (v_legacy_types);

        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            v_removed := v_removed + v_row_count;
        end if;

        drop table if exists tmp_search_one;
        if v_entity_type in ('transport_route', 'transport_route_variant') then
            execute format(
                'create temp table tmp_search_one on commit drop as
                 select * from %I where entity_type = $1 and entity_id = $2',
                v_view_rel
            ) using v_entity_type, v_entity_id;
        else
            execute format(
                'create temp table tmp_search_one on commit drop as
                 select * from %I where entity_id = $1',
                v_view_rel
            ) using v_entity_id;
        end if;

        insert into search.search_documents (
            entity_type, entity_id, public_id, display_name, subtitle,
            primary_name_my, primary_name_en, primary_name_und, code, external_id,
            category_code, category_name_my, category_name_en,
            admin_area_id, admin_area_name_my, admin_area_name_en, admin_hierarchy,
            address_text, address_parts,
            geometry_type, centroid, bbox, has_geometry, supports_plus_code,
            searchable_text, trigram_text,
            importance_score, popularity_score, confidence_score, boundary_confidence_score,
            is_verified, is_public, is_active, source_updated_at, indexed_at
        )
        select
            t.entity_type, t.entity_id, t.public_id, t.display_name, t.subtitle,
            t.primary_name_my, t.primary_name_en, t.primary_name_und, t.code, t.external_id,
            t.category_code, t.category_name_my, t.category_name_en,
            t.admin_area_id, t.admin_area_name_my, t.admin_area_name_en,
            coalesce(t.admin_hierarchy, '{}'::jsonb),
            t.address_text, t.address_parts,
            t.geometry_type, t.centroid, t.bbox,
            coalesce(t.has_geometry, false), coalesce(t.supports_plus_code, false),
            t.searchable_text,
            nullif(lower(btrim(coalesce(t.searchable_text, ''))), ''),
            least(100, greatest(0, coalesce(t.importance_score, 0))),
            least(100, greatest(0, coalesce(t.popularity_score, 0))),
            least(100, greatest(0, coalesce(t.confidence_score, 0))),
            least(100, greatest(0, coalesce(t.boundary_confidence_score, 0))),
            coalesce(t.is_verified, false), coalesce(t.is_public, true),
            coalesce(t.is_active, true), t.source_updated_at, now()
        from tmp_search_one t;

        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            v_synced := v_synced + v_row_count;

            insert into search.search_document_names (
                search_document_id, language_code, script_code, name,
                normalized_name, name_type, is_primary, search_weight
            )
            select
                d.id,
                coalesce(nullif(btrim(n->>'language_code'), ''), 'und'),
                nullif(btrim(n->>'script_code'), ''),
                btrim(n->>'name'),
                nullif(lower(btrim(n->>'name')), ''),
                nullif(btrim(n->>'name_type'), ''),
                coalesce((n->>'is_primary')::boolean, false),
                least(100, greatest(0, coalesce((n->>'search_weight')::numeric, 0)))
            from tmp_search_one t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where btrim(coalesce(n->>'name', '')) <> '';
        end if;
    end loop;

    return jsonb_build_object(
        'entity_type', v_entity_type,
        'synced', v_synced,
        'removed', v_removed,
        'entity_ids', to_jsonb(p_entity_ids)
    );
end;
$fn$;

create or replace function search.rebuild_search_documents(p_views text[] default null)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_all_views   text[] := array[
        'places', 'admin_areas', 'street_groups', 'addresses', 'bus_stops',
        'bus_routes', 'transport_terminals', 'buildings', 'water_lines', 'water_polygons', 'landuse'
    ];
    v_views       text[];
    v_invalid     text[];
    v_view        text;
    v_view_rel    text;
    v_run_id      bigint;
    v_doc_count   bigint;
    v_name_count  bigint;
    v_view_results jsonb := '{}'::jsonb;
    v_failed      int := 0;
    v_err         text;
    v_counts      jsonb;
    v_status      text;
begin
    set local statement_timeout = 0;

    if p_views is null or array_length(p_views, 1) is null then
        v_views := v_all_views;
    else
        v_views := array(
            select distinct lower(btrim(x))
            from unnest(p_views) as x
            where btrim(coalesce(x, '')) <> ''
        );
        if array_length(v_views, 1) is null then
            v_views := v_all_views;
        else
            v_invalid := array(
                select x from unnest(v_views) as x where x <> all (v_all_views)
            );
            if array_length(v_invalid, 1) is not null then
                raise exception 'Unknown search source view(s): %', array_to_string(v_invalid, ', ')
                    using hint = 'Valid views: ' || array_to_string(v_all_views, ', ');
            end if;
        end if;
    end if;

    insert into search.search_index_runs (status, started_at)
    values ('running', now())
    returning id into v_run_id;

    foreach v_view in array v_views loop
        v_view_rel := format('search.v_search_%s_source', v_view);
        begin
            execute 'drop table if exists tmp_search_src';
            execute format(
                'create temp table tmp_search_src on commit drop as select * from %s',
                v_view_rel
            );

            delete from search.search_documents d
            where d.entity_type in (select distinct t.entity_type from tmp_search_src t);

            insert into search.search_documents (
                entity_type, entity_id, public_id, display_name, subtitle,
                primary_name_my, primary_name_en, primary_name_und, code, external_id,
                category_code, category_name_my, category_name_en,
                admin_area_id, admin_area_name_my, admin_area_name_en, admin_hierarchy,
                address_text, address_parts,
                geometry_type, centroid, bbox, has_geometry, supports_plus_code,
                searchable_text, trigram_text,
                importance_score, popularity_score, confidence_score, boundary_confidence_score,
                is_verified, is_public, is_active, source_updated_at, indexed_at
            )
            select
                t.entity_type, t.entity_id, t.public_id, t.display_name, t.subtitle,
                t.primary_name_my, t.primary_name_en, t.primary_name_und, t.code, t.external_id,
                t.category_code, t.category_name_my, t.category_name_en,
                t.admin_area_id, t.admin_area_name_my, t.admin_area_name_en,
                coalesce(t.admin_hierarchy, '{}'::jsonb),
                t.address_text, t.address_parts,
                t.geometry_type, t.centroid, t.bbox,
                coalesce(t.has_geometry, false), coalesce(t.supports_plus_code, false),
                t.searchable_text,
                nullif(lower(btrim(coalesce(t.searchable_text, ''))), ''),
                least(100, greatest(0, coalesce(t.importance_score, 0))),
                least(100, greatest(0, coalesce(t.popularity_score, 0))),
                least(100, greatest(0, coalesce(t.confidence_score, 0))),
                least(100, greatest(0, coalesce(t.boundary_confidence_score, 0))),
                coalesce(t.is_verified, false), coalesce(t.is_public, true),
                coalesce(t.is_active, true), t.source_updated_at, now()
            from tmp_search_src t;

            get diagnostics v_doc_count = row_count;

            insert into search.search_document_names (
                search_document_id, language_code, script_code, name,
                normalized_name, name_type, is_primary, search_weight
            )
            select
                d.id,
                coalesce(nullif(btrim(n->>'language_code'), ''), 'und'),
                nullif(btrim(n->>'script_code'), ''),
                btrim(n->>'name'),
                nullif(lower(btrim(n->>'name')), ''),
                nullif(btrim(n->>'name_type'), ''),
                coalesce((n->>'is_primary')::boolean, false),
                least(100, greatest(0, coalesce((n->>'search_weight')::numeric, 0)))
            from tmp_search_src t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where btrim(coalesce(n->>'name', '')) <> '';

            get diagnostics v_name_count = row_count;

            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object(
                    'documents', v_doc_count,
                    'names', v_name_count
                )
            );
        exception when others then
            v_failed := v_failed + 1;
            v_err := SQLERRM;
            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object('error', v_err)
            );
        end;
    end loop;

    select coalesce(jsonb_object_agg(entity_type, cnt), '{}'::jsonb)
    into v_counts
    from (
        select entity_type, count(*)::bigint as cnt
        from search.search_documents
        group by entity_type
    ) s;

    v_status := case when v_failed > 0 then 'failed' else 'completed' end;

    update search.search_index_runs
    set status = v_status,
        finished_at = now(),
        entity_counts = v_counts,
        error_message = case when v_failed > 0 then format('%s view(s) failed', v_failed) else null end
    where id = v_run_id;

    return jsonb_build_object(
        'run_id', v_run_id,
        'status', v_status,
        'requested_views', to_jsonb(v_views),
        'view_results', v_view_results,
        'entity_counts', v_counts
    );
end;
$fn$;

commit;
