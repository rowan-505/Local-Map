-- =============================================================================
-- Supabase migration 121: grouped street search source (MVP)
-- =============================================================================
--
-- WHY THIS REPLACES PER-SEGMENT STREET SEARCH
-- -------------------------------------------------------------------------
-- The previous street source (migrations 116/119, deprecated by 120) emitted one
-- search document per core_streets row: ~823,006 active segments, a 35-50 minute
-- rebuild, and duplicate results (e.g. "Pyay Road" returned 200+ times -- once
-- per segment).
--
-- Measured against production data:
--   * 823,006 active street segments.
--   * ~96.8% (796,727) have auto-generated "road-<number>" placeholder names --
--     they are UNNAMED roads with no searchable identity.
--   * Only ~26,279 segments carry a real name.
--   * Those named segments collapse to ~14,819 logical street groups when grouped
--     by  normalize(name) + admin_area_id + road_class.
--
-- So a grouped source gives one logical street result instead of many tiny
-- segments, AND shrinks the street index from ~823k rows to ~14.8k (~98.2% fewer)
-- so it rebuilds in seconds inside the normal rebuild path.
--
-- GROUPING RULE (medium-aggressive)
-- -------------------------------------------------------------------------
--   Group key = normalize(name) + admin_area_id + road_class
--     - keeps "Pyay Road, Sanchaung" separate from "Pyay Road, Kamayut"
--       (never merges same-named roads across townships / classes).
--     - a long highway crossing townships becomes one row per township; that
--       reads well ("Yangon-Mandalay Expressway, <township>").
--   Include: streets with a real name (my / en / und).
--   Exclude: generated "road-<number>" names, blank names, "Unnamed ..."
--            placeholders -- i.e. unnamed minor roads / service paths with no
--            searchable identity. (No OSM `ref`/`code` is stored on
--            core_streets.source_tags, so code/ref is always null here.)
--
-- PERFORMANCE
-- -------------------------------------------------------------------------
--   * ST_Collect (NOT ST_Union): we only need a centroid pin + bbox, so we avoid
--     the expensive topological union. Grouped geom = ST_Multi(ST_Collect(geom)).
--   * No full geometry is stored in search.search_documents -- only centroid +
--     bbox + geometry_type. Full road geometry is fetched live from
--     core.core_streets by the API geometry endpoint on click.
--   * ~14.8k groups over ~26k named segments -> the view materializes in seconds.
--
-- This migration does NOT touch core street data (core.core_streets is untouched).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Shared street-name normalization.
--    Lower-cases, strips zero-width characters, collapses whitespace. Used by
--    BOTH the grouping view and the API street geometry endpoint so the group
--    key is computed identically in both places.
-- -----------------------------------------------------------------------------
create or replace function search.norm_street_name(p_name text)
returns text
language sql
immutable
as $fn$
    select nullif(
        btrim(
            regexp_replace(
                lower(regexp_replace(coalesce(p_name, ''), E'[\\u200B\\u200C\\u200D\\uFEFF]', '', 'g')),
                '\s+', ' ', 'g'
            )
        ),
        ''
    )
$fn$;

comment on function search.norm_street_name(text) is
    'Normalize a street name for grouping/search: lowercase, strip zero-width chars, collapse whitespace. Shared by search.v_search_street_groups_source and the API street geometry endpoint so group keys match.';

-- -----------------------------------------------------------------------------
-- 2. Grouped street search source: search.v_search_street_groups_source
--    One row per (normalize(name), admin_area_id, road_class). ~14.8k rows.
--    Output column shape matches search.search_documents / the other
--    search.v_search_*_source views so the rebuild path is unchanged.
-- -----------------------------------------------------------------------------
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
    coalesce(nullif(btrim(g.road_class), ''), 'Street') as subtitle,
    coalesce(nm.name_my, g.rep_canonical) as primary_name_my,
    coalesce(nm.name_en, g.rep_canonical) as primary_name_en,
    g.rep_canonical as primary_name_und,
    null::text as code,                                       -- no OSM ref/code stored
    null::text as external_id,
    g.road_class as category_code,
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
    'Grouped street search source (~14.8k rows): one row per logical road = normalize(name)+admin_area_id+road_class. Excludes generated/unnamed placeholders. Replaces the deprecated per-segment search.v_search_streets_source (~823k rows). entity_type=street_group; entity_id=representative street id; geometry = ST_Multi(ST_Collect(member geoms)) for centroid/bbox only.';

-- -----------------------------------------------------------------------------
-- 3. Rebuild function: 'street_groups' replaces the deprecated 'streets' view in
--    the default rebuild set (small/fast now). Per-view sub-transactions kept.
-- -----------------------------------------------------------------------------
create or replace function search.rebuild_search_documents(p_views text[] default null)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_all_views   text[] := array[
        'places', 'admin_areas', 'street_groups', 'addresses', 'bus_stops',
        'bus_routes', 'buildings', 'water_lines', 'water_polygons', 'landuse'
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
                coalesce((n->>'search_weight')::numeric, 0)
            from tmp_search_src t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where coalesce(btrim(n->>'name'), '') <> '';

            get diagnostics v_name_count = row_count;

            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object('status', 'ok', 'documents', v_doc_count, 'names', v_name_count)
            );
        exception when others then
            v_failed := v_failed + 1;
            v_err := coalesce(sqlstate, '') || ': ' || coalesce(sqlerrm, 'unknown error');
            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object('status', 'failed', 'error', v_err)
            );
        end;
    end loop;

    select coalesce(jsonb_object_agg(s.entity_type, s.cnt), '{}'::jsonb)
    into v_counts
    from (
        select entity_type, count(*)::bigint as cnt
        from search.search_documents
        group by entity_type
    ) s;

    v_counts := v_counts || jsonb_build_object(
        'total_documents', (select count(*) from search.search_documents),
        'total_document_names', (select count(*) from search.search_document_names),
        'views', v_view_results
    );

    v_status := case when v_failed > 0 then 'failed' else 'completed' end;

    update search.search_index_runs
    set status = v_status,
        finished_at = now(),
        entity_counts = v_counts,
        error_message = case when v_failed > 0
            then v_failed || ' view(s) failed; see entity_counts.views'
            else null end
    where id = v_run_id;

    return jsonb_build_object(
        'run_id', v_run_id,
        'status', v_status,
        'requested_views', v_views,
        'entity_counts', v_counts
    );
end;
$fn$;

comment on function search.rebuild_search_documents(text[]) is
    'Rebuild search.search_documents + search.search_document_names from search.v_search_*_source. Default views: places, admin_areas, street_groups (grouped roads), addresses, bus_stops, bus_routes, buildings, water_lines, water_polygons, landuse. Per-view sub-transactions; a failing view does not roll back the others.';

-- -----------------------------------------------------------------------------
-- 4. Drop the deprecated per-segment street objects (legacy path removed) and
--    purge any leftover per-segment street docs. The grouped rows are written by
--    the next search.rebuild_search_documents(['street_groups']).
-- -----------------------------------------------------------------------------
drop function if exists search.rebuild_streets_batch(bigint, bigint);
drop view if exists search.v_search_streets_source;

delete from search.search_documents where entity_type in ('street', 'street_group');

commit;

-- =============================================================================
-- Usage (after applying):
--   SELECT search.rebuild_search_documents();                       -- all (fast)
--   SELECT search.rebuild_search_documents(ARRAY['street_groups']); -- streets only
--   SELECT entity_type, count(*) FROM search.search_documents GROUP BY 1 ORDER BY 1;
-- =============================================================================
-- End 121_search_street_groups.sql
-- =============================================================================
