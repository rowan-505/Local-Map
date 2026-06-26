-- =============================================================================
-- Verify grouped street search rebuild (migration 121)
-- =============================================================================
-- Run AFTER applying migration 121_search_street_groups.sql.
-- Confirms search.rebuild_search_documents() uses the grouped street source
-- (search.v_search_street_groups_source, entity_type = 'street_group') instead of
-- the deprecated per-segment source (~823k rows).
-- =============================================================================

-- 1. Rebuild ONLY grouped streets (fast: ~14.8k rows, not ~823k segments).
SELECT search.rebuild_search_documents(ARRAY['street_groups']);

-- 2. Document counts per entity type. Expect a 'street_group' row (~14.8k) and
--    NO 'street' rows (the per-segment path is removed).
SELECT entity_type, COUNT(*) AS documents
FROM search.search_documents
GROUP BY entity_type
ORDER BY entity_type;

-- 3. Sanity: grouped street docs carry MultiLineString geometry hints + centroid,
--    and importance seeded from road_class (motorway > residential, etc.).
SELECT entity_type, geometry_type, has_geometry,
       count(*) AS docs,
       round(avg(importance_score), 1) AS avg_importance
FROM search.search_documents
WHERE entity_type = 'street_group'
GROUP BY entity_type, geometry_type, has_geometry;

-- 4. Multilingual names were fanned into search_document_names for street groups.
SELECT count(*) AS street_group_name_rows
FROM search.search_document_names n
JOIN search.search_documents d ON d.id = n.search_document_id
WHERE d.entity_type = 'street_group';

-- 5. The legacy per-segment objects are gone (both should return NULL / 0 rows).
SELECT to_regclass('search.v_search_streets_source') AS legacy_view_should_be_null;
SELECT count(*) AS legacy_rebuild_fn_should_be_zero
FROM pg_proc
WHERE proname = 'rebuild_streets_batch';

-- 6. Passing the removed 'streets' key is now rejected (expect an error:
--    "Unknown search source view(s): streets"). Uncomment to test:
-- SELECT search.rebuild_search_documents(ARRAY['streets']);

-- 7. Latest run summary (status + per-view + per-type counts).
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
ORDER BY id DESC
LIMIT 1;
-- =============================================================================
