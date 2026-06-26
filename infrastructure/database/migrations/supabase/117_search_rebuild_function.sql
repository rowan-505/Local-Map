-- =============================================================================
-- Supabase migration 117: search.rebuild_search_documents() full rebuild
-- =============================================================================
--
-- A single, explicit full-rebuild function that repopulates the unified runtime
-- search store (migration 115) from the source views (migration 116).
--
-- Behavior:
--   * No triggers. This is a manual / scheduled full rebuild only.
--   * Records the run in search.search_index_runs (running -> completed/failed).
--   * Safely truncates search_document_names + search_documents, then reinserts
--     from the 10 source views (places, admin areas, streets, addresses, bus
--     stops, bus routes + variants, named buildings, named water lines, named
--     water polygons, named landuse).
--   * Fans the per-row `names` jsonb out into search_document_names.
--   * search_vector is a GENERATED column (to_tsvector('simple', searchable_text))
--     so it is built automatically on insert -- we never write it directly.
--   * trigram_text is set to the normalized (lowercased, trimmed) searchable text.
--   * entity_counts is tracked per entity_type in search_index_runs.
--
-- Important:
--   * No stored plus_code is used for matching. Plus Code search is handled in
--     the API by decoding/expanding to coordinates.
--   * No full geometry is stored: only centroid + bbox come from the views.
--
-- Failure handling: the body runs inside a BEGIN/EXCEPTION block (a subtransaction).
-- The run row is inserted BEFORE that block, so on error the data changes
-- (truncate + inserts) roll back to the savepoint -- leaving the PREVIOUS index
-- intact -- while the run row is updated to status='failed' with the error and
-- the function returns normally (so that 'failed' record is committed).
-- =============================================================================

begin;

-- Allow the 'completed' status used by the rebuild (keep prior values too).
alter table search.search_index_runs
    drop constraint if exists search_index_runs_status_chk;

alter table search.search_index_runs
    add constraint search_index_runs_status_chk
    check (status in ('pending', 'running', 'completed', 'success', 'failed'));

create or replace function search.rebuild_search_documents()
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_run_id bigint;
    v_counts jsonb;
begin
    -- 1. Open a run record (committed even if the rebuild later fails).
    insert into search.search_index_runs (status, started_at)
    values ('running', now())
    returning id into v_run_id;

    begin
        -- 2. Materialize all source rows once (views are expensive per row).
        drop table if exists tmp_search_src;
        create temp table tmp_search_src on commit drop as
            select * from search.v_search_places_source
            union all select * from search.v_search_admin_areas_source
            union all select * from search.v_search_streets_source
            union all select * from search.v_search_addresses_source
            union all select * from search.v_search_bus_stops_source
            union all select * from search.v_search_bus_routes_source
            union all select * from search.v_search_buildings_source
            union all select * from search.v_search_water_lines_source
            union all select * from search.v_search_water_polygons_source
            union all select * from search.v_search_landuse_source;

        -- 3. Safe truncate: both tables together satisfies the FK.
        truncate table search.search_documents, search.search_document_names
            restart identity cascade;

        -- 4. Insert documents. search_vector is generated; trigram_text is the
        --    normalized searchable text. Scores are clamped to the 0-100 scale.
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

        -- 5. Fan the names jsonb array out into search_document_names.
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

        -- 6. Per-entity_type counts (+ totals).
        select coalesce(jsonb_object_agg(s.entity_type, s.cnt), '{}'::jsonb)
        into v_counts
        from (
            select entity_type, count(*)::bigint as cnt
            from search.search_documents
            group by entity_type
        ) s;

        v_counts := v_counts || jsonb_build_object(
            'total_documents', (select count(*) from search.search_documents),
            'total_document_names', (select count(*) from search.search_document_names)
        );

        -- 7. Success.
        update search.search_index_runs
        set status = 'completed', finished_at = now(), entity_counts = v_counts
        where id = v_run_id;

        return jsonb_build_object(
            'run_id', v_run_id,
            'status', 'completed',
            'entity_counts', v_counts
        );

    exception when others then
        -- Data changes since BEGIN rolled back; previous index preserved.
        update search.search_index_runs
        set status = 'failed',
            finished_at = now(),
            error_message = coalesce(sqlstate, '') || ': ' || coalesce(sqlerrm, 'unknown error')
        where id = v_run_id;

        return jsonb_build_object(
            'run_id', v_run_id,
            'status', 'failed',
            'error', coalesce(sqlstate, '') || ': ' || coalesce(sqlerrm, 'unknown error')
        );
    end;
end;
$fn$;

comment on function search.rebuild_search_documents() is
    'Full rebuild of search.search_documents + search.search_document_names from the search.v_search_*_source views. Records the run in search.search_index_runs. No triggers; safe to re-run.';

commit;

-- =============================================================================
-- Testing commands (run AFTER migrations 115, 116, 117 are applied):
-- =============================================================================
--   -- 1. Run the full rebuild (returns run_id, status, entity_counts):
--   SELECT search.rebuild_search_documents();
--
--   -- 2. Per-entity_type document counts:
--   SELECT entity_type, COUNT(*)
--   FROM search.search_documents
--   GROUP BY entity_type
--   ORDER BY entity_type;
--
--   -- 3. Total multilingual name rows:
--   SELECT COUNT(*) FROM search.search_document_names;
--
--   -- 4. (Optional) inspect the latest run record:
--   SELECT id, status, started_at, finished_at, entity_counts, error_message
--   FROM search.search_index_runs
--   ORDER BY id DESC
--   LIMIT 1;
-- =============================================================================

-- =============================================================================
-- Rollback (manual; run only if reverting this migration):
--   begin;
--     drop function if exists search.rebuild_search_documents();
--     alter table search.search_index_runs
--       drop constraint if exists search_index_runs_status_chk;
--     alter table search.search_index_runs
--       add constraint search_index_runs_status_chk
--       check (status in ('pending', 'running', 'success', 'failed'));
--   commit;
-- =============================================================================
-- End 117_search_rebuild_function.sql
-- =============================================================================
