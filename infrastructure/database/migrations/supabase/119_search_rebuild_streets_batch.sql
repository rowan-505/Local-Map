-- =============================================================================
-- Supabase migration 119: chunked, resumable street index rebuild
-- =============================================================================
--
-- !!! DEPRECATED -- reference only (see migration 120) !!!
-- Do not use for normal search indexing; use the grouped street search index
-- instead. This per-segment path (~823k rows, 35-50 min) is no longer wired into
-- the default rebuild. Kept temporarily for reference.
--
-- The street source view is ~823k rows and each row reads a line geometry and
-- computes centroid + bbox (~35-40 min to materialize in full). Rebuilding it in
-- ONE transaction (migration 117/118 full path) is fragile: it trips the role
-- statement_timeout and any client/connection drop rolls back the entire run.
--
-- This adds a small batch function so the indexer can rebuild streets in id-range
-- chunks. Each call is meant to run in its own short transaction (well under
-- statement_timeout), commits its slice, and is idempotent/resumable: re-running
-- a range simply replaces it. (Legacy driver:
-- npm run rebuild:search-index:streets:LEGACY-DEPRECATED.)
--
-- Range is half-open: entity_id in [p_min_id, p_max_id).
-- Returns the number of street documents written for the range.
-- =============================================================================

begin;

create or replace function search.rebuild_streets_batch(p_min_id bigint, p_max_id bigint)
returns bigint
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_docs bigint;
begin
    -- Materialize just this id slice of the street view once (so the per-row
    -- PostGIS centroid/bbox is computed a single time, reused for docs + names).
    drop table if exists tmp_streets_batch;
    create temp table tmp_streets_batch on commit drop as
        select *
        from search.v_search_streets_source
        where entity_id >= p_min_id and entity_id < p_max_id;

    -- Replace this slice (idempotent / resumable). Name rows cascade-delete.
    delete from search.search_documents d
    where d.entity_type = 'street'
      and d.entity_id >= p_min_id
      and d.entity_id < p_max_id;

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
    from tmp_streets_batch t;

    get diagnostics v_docs = row_count;

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
    from tmp_streets_batch t
    join search.search_documents d
        on d.entity_type = t.entity_type and d.entity_id = t.entity_id
    cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
    where coalesce(btrim(n->>'name'), '') <> '';

    return v_docs;
end;
$fn$;

comment on function search.rebuild_streets_batch(bigint, bigint) is
    'DEPRECATED / reference only. Rebuild search.search_documents street rows for entity_id in [p_min_id, p_max_id). Do not use for normal search indexing; use the grouped street search index instead. (Migration 120 disables the default per-segment street path.)';

commit;

-- =============================================================================
-- End 119_search_rebuild_streets_batch.sql
-- =============================================================================
