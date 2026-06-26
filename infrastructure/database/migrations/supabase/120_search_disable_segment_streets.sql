-- =============================================================================
-- Supabase migration 120: deprecate the per-segment street search path
-- =============================================================================
--
-- WHY: search.v_search_streets_source has ~823k rows (one document per road
-- *segment*). A full street rebuild takes 35-50 minutes and is not an acceptable
-- long-term indexing strategy. We are moving to GROUPED street search documents
-- (one document per road, not per segment). This migration disables the old
-- heavy per-segment path so it cannot be triggered accidentally.
--
-- This migration does NOT:
--   * delete core street data (core.core_streets etc. untouched),
--   * drop any search table,
--   * drop search.v_search_streets_source or search.rebuild_streets_batch
--     (kept TEMPORARILY for reference only -- see comments below).
--
-- It DOES:
--   1. Make search.rebuild_search_documents(NULL) rebuild LIGHT views only and
--      refuse/skip 'streets' with a warning (so a default rebuild is fast).
--   2. Tag the deprecated street objects with warning comments.
--   3. Remove the partial / half-populated per-segment street rows that a killed
--      legacy rebuild left in search.search_documents (cascades to names).
-- =============================================================================

begin;

-- 1. Rebuild function: light views only by default; 'streets' is deprecated.
create or replace function search.rebuild_search_documents(p_views text[] default null)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    -- NOTE: 'streets' intentionally removed from the default set. The per-segment
    -- street index is deprecated (use the grouped street search index instead).
    v_all_views   text[] := array[
        'places', 'admin_areas', 'addresses', 'bus_stops',
        'bus_routes', 'buildings', 'water_lines', 'water_polygons', 'landuse'
    ];
    v_known       text[] := v_all_views || array['streets'];  -- 'streets' accepted but skipped
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
                select x from unnest(v_views) as x where x <> all (v_known)
            );
            if array_length(v_invalid, 1) is not null then
                raise exception 'Unknown search source view(s): %', array_to_string(v_invalid, ', ')
                    using hint = 'Valid views: ' || array_to_string(v_all_views, ', ');
            end if;
        end if;
    end if;

    -- DEPRECATED per-segment street path: skip with a warning. Use the grouped
    -- street search index instead.
    if 'streets' = any (v_views) then
        raise warning 'Per-segment street rebuild is deprecated and was skipped. Use the grouped street search index instead.';
        v_views := array_remove(v_views, 'streets');
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
    'Rebuild search.search_documents + search.search_document_names from the light search.v_search_*_source views. DEPRECATED: the per-segment "streets" view is NOT rebuilt here (skipped with a warning) -- it is ~823k rows and too slow; use the grouped street search index instead.';

-- 2. Tag the deprecated street objects (kept for reference only -- do NOT drop).
comment on view search.v_search_streets_source is
    'DEPRECATED / reference only. One row per road SEGMENT (~823k rows). Do not use for normal search indexing; use the grouped street search index instead.';
comment on function search.rebuild_streets_batch(bigint, bigint) is
    'DEPRECATED / reference only. Per-segment street rebuild helper (~823k rows, 35-50 min). Do not use for normal search indexing; use the grouped street search index instead.';

-- 3. Remove partial per-segment street docs left by a killed legacy rebuild.
--    (Cascades to search.search_document_names. core street data is untouched.)
delete from search.search_documents where entity_type = 'street';

commit;

-- =============================================================================
-- End 120_search_disable_segment_streets.sql
-- =============================================================================
