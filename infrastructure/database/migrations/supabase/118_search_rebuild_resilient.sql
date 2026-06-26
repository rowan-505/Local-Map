-- =============================================================================
-- Supabase migration 118: resilient, per-view search index rebuild
-- =============================================================================
--
-- Replaces the single all-or-nothing rebuild from migration 117. The old
-- function materialized ALL 10 source views into one temp table inside ONE
-- transaction. The street source view alone is ~823k rows and materializes in
-- ~35 minutes (each row reads a line geometry and computes centroid + bbox), so
-- the rebuild always tripped statement_timeout and never populated anything --
-- search.search_documents / search.search_document_names stayed empty.
--
-- This version fixes that operationally without changing the data model:
--
--   * Parameterized: rebuild_search_documents(p_views text[] default null).
--       - NULL / empty  => rebuild ALL views.
--       - e.g. ARRAY['places','admin_areas'] => rebuild only those.
--     This lets the tiny views (places, admin, bus, buildings, water, landuse)
--     be populated instantly, and the heavy 'streets' view be rebuilt on its own
--     from a persistent connection (npm run rebuild:search-index).
--
--   * Per-view processing: each view is materialized + upserted independently
--     inside its own BEGIN/EXCEPTION sub-block. A heavy/broken view fails on its
--     own without rolling back the views that already succeeded. Only the entity
--     types produced by the processed views are replaced (delete + insert); the
--     name rows cascade via the ON DELETE CASCADE FK.
--
--   * The caller MUST disable statement_timeout before invoking this for the
--     heavy 'streets' view: statement_timeout is armed when the SELECT
--     rebuild_search_documents(...) call begins, so changing it from inside the
--     function does not relax the enclosing call. The npm rebuild script does
--     `SET LOCAL statement_timeout = 0` on the connection first, then calls this.
--     (The function also sets it defensively for any nested EXECUTE work.)
--
-- Unchanged guarantees (see migrations 115/116):
--   * Only lightweight geometry is stored: centroid (Point) + bbox envelope +
--     geometry_type + has_geometry. No full geometry in the index.
--   * search_vector is a GENERATED column; we never write it directly.
--   * trigram_text = normalized (lower/trim) searchable_text.
--   * Scores clamped to the 0-100 scale.
--   * Every run is recorded in search.search_index_runs with per-view + per-type
--     counts. A run that has any failing view is marked 'failed' but the views
--     that succeeded are still committed.
-- =============================================================================

begin;

-- Keep the broadened status set introduced in migration 117.
alter table search.search_index_runs
    drop constraint if exists search_index_runs_status_chk;

alter table search.search_index_runs
    add constraint search_index_runs_status_chk
    check (status in ('pending', 'running', 'completed', 'success', 'failed'));

-- Drop the old single-arg signature so the parameterized one is canonical.
drop function if exists search.rebuild_search_documents();

create or replace function search.rebuild_search_documents(p_views text[] default null)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_all_views   text[] := array[
        'places', 'admin_areas', 'streets', 'addresses', 'bus_stops',
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
    -- Defensive only: affects nested EXECUTE statements. It does NOT relax the
    -- timeout already armed for the enclosing rebuild call -- the caller must
    -- `SET statement_timeout = 0` before invoking for the heavy street rebuild.
    set local statement_timeout = 0;

    -- Resolve + validate the requested view set. NULL / empty => all views.
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
            -- Materialize just this one view (cheap for all but 'streets').
            execute 'drop table if exists tmp_search_src';
            execute format(
                'create temp table tmp_search_src on commit drop as select * from %s',
                v_view_rel
            );

            -- Replace only the entity_type(s) this view produces. Name rows for
            -- those documents cascade-delete via the FK.
            delete from search.search_documents d
            where d.entity_type in (
                select distinct t.entity_type from tmp_search_src t
            );

            -- Insert documents. search_vector is generated; trigram_text is the
            -- normalized searchable text. Scores clamped to 0-100.
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

            -- Fan the per-row names jsonb out into search_document_names.
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
                v_view, jsonb_build_object(
                    'status', 'ok',
                    'documents', v_doc_count,
                    'names', v_name_count
                )
            );

        exception when others then
            -- This view's changes rolled back to the sub-block savepoint; views
            -- already processed in this run remain intact.
            v_failed := v_failed + 1;
            v_err := coalesce(sqlstate, '') || ': ' || coalesce(sqlerrm, 'unknown error');
            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object('status', 'failed', 'error', v_err)
            );
        end;
    end loop;

    -- Final per-entity_type counts over the whole index (+ totals + per-view).
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
    'Resilient full / partial rebuild of search.search_documents + search.search_document_names from search.v_search_*_source. Pass an array of view keys (places, admin_areas, streets, addresses, bus_stops, bus_routes, buildings, water_lines, water_polygons, landuse) or NULL for all. Per-view sub-transactions: a failing view does not roll back the others. statement_timeout disabled for long street rebuilds. Records the run in search.search_index_runs.';

commit;

-- =============================================================================
-- Usage (run AFTER migrations 115, 116, 117, 118 are applied):
--   -- Light views only (instant):
--   SELECT search.rebuild_search_documents(ARRAY[
--     'places','admin_areas','bus_stops','bus_routes',
--     'buildings','water_lines','water_polygons','landuse']);
--
--   -- Streets only (heavy ~35 min; run over a persistent connection):
--   SELECT search.rebuild_search_documents(ARRAY['streets']);
--
--   -- Everything:
--   SELECT search.rebuild_search_documents();
--
--   -- Inspect latest run:
--   SELECT id, status, started_at, finished_at, entity_counts, error_message
--   FROM search.search_index_runs ORDER BY id DESC LIMIT 1;
-- =============================================================================
-- Rollback (manual): restore the single-arg function from migration 117.
-- =============================================================================
-- End 118_search_rebuild_resilient.sql
-- =============================================================================
