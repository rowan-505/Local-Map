-- =============================================================================
-- Supabase migration 051: import_review.road_candidates list query indexes
-- =============================================================================
--
-- Composite / partial indexes for GET /api/import-review/roads list + count.
--
-- Suggested EXPLAIN for list shape:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT ...
-- FROM import_review.road_candidates AS r
-- WHERE r.review_batch_id = $1 AND r.entity_family = 'roads'
--   AND r.promotion_status IS DISTINCT FROM 'promoted'
-- ORDER BY r.updated_at DESC
-- LIMIT 50 OFFSET 0;
--
-- =============================================================================

begin;

create index if not exists irr_road_rbid_entity_family_idx
    on import_review.road_candidates (review_batch_id, entity_family);

create index if not exists irr_road_rbid_entity_family_updated_desc_idx
    on import_review.road_candidates (review_batch_id, entity_family, updated_at desc);

create index if not exists irr_road_rbid_road_class_id_idx
    on import_review.road_candidates (review_batch_id, road_class_id)
    where road_class_id is not null;

create index if not exists irr_road_rbid_match_status_idx
    on import_review.road_candidates (review_batch_id, match_status);

create index if not exists irr_road_rbid_entity_family_not_promoted_idx
    on import_review.road_candidates (review_batch_id, entity_family)
    where promotion_status <> 'promoted';

do $migration$
begin
    if exists (select 1 from pg_extension where extname = 'pg_trgm') then
        execute $idx$
            create index if not exists irr_road_canonical_name_trgm_idx
            on import_review.road_candidates using gin (canonical_name gin_trgm_ops)
        $idx$;

        execute $idx$
            create index if not exists irr_road_external_id_trgm_idx
            on import_review.road_candidates using gin (external_id gin_trgm_ops)
        $idx$;

        execute $idx$
            create index if not exists irr_road_road_class_trgm_idx
            on import_review.road_candidates using gin (road_class gin_trgm_ops)
        $idx$;
    end if;
end
$migration$;

commit;
