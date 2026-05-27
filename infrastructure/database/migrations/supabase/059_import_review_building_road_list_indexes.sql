-- =============================================================================
-- Supabase migration 059: import_review building + road list query indexes
-- =============================================================================
--
-- Targets slow GET /api/import-review/{buildings,roads} list + count queries:
--   WHERE review_batch_id = $1 AND entity_family = $family
--   [AND promotion_status / review_status not promoted]
--   ORDER BY updated_at DESC LIMIT n
--
-- Buildings: no prior composite migration (024 has single-column indexes only).
-- Roads: complements 051 (same IF NOT EXISTS names for core composites + filter supplements).
--
-- GiST: not added — list endpoints do not filter by geometry (024 geom indexes remain).
--
-- Production at scale: prefer CREATE INDEX CONCURRENTLY (see docs/import-review/
-- import-review-index-migration-059-report.md). This file uses transactional
-- CREATE INDEX IF NOT EXISTS to match migration 051 convention.
--
-- Suggested EXPLAIN (buildings):
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT b.id FROM import_review.building_candidates AS b
-- WHERE b.review_batch_id = $1 AND b.entity_family = 'buildings'
--   AND b.promotion_status IS DISTINCT FROM 'promoted'
-- ORDER BY b.updated_at DESC LIMIT 50;
--
-- Rollback: see import-review-index-migration-059-report.md section 7.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- import_review.building_candidates — list + count (primary)
-- Supports: GET /api/import-review/buildings, include_total count
-- -----------------------------------------------------------------------------

create index if not exists irr_bld_rbid_entity_family_idx
    on import_review.building_candidates (review_batch_id, entity_family);

create index if not exists irr_bld_rbid_entity_family_updated_desc_idx
    on import_review.building_candidates (review_batch_id, entity_family, updated_at desc);

create index if not exists irr_bld_rbid_entity_family_not_promoted_idx
    on import_review.building_candidates (review_batch_id, entity_family)
    where promotion_status <> 'promoted';

create index if not exists irr_bld_rbid_match_status_idx
    on import_review.building_candidates (review_batch_id, match_status);

create index if not exists irr_bld_rbid_auto_action_idx
    on import_review.building_candidates (review_batch_id, auto_action);

create index if not exists irr_bld_rbid_review_status_idx
    on import_review.building_candidates (review_batch_id, review_status);

create index if not exists irr_bld_rbid_class_code_idx
    on import_review.building_candidates (review_batch_id, class_code)
    where class_code is not null;

create index if not exists irr_bld_rbid_building_type_id_idx
    on import_review.building_candidates (review_batch_id, building_type_id)
    where building_type_id is not null;

do $migration$
begin
    if exists (select 1 from pg_extension where extname = 'pg_trgm') then
        execute $idx$
            create index if not exists irr_bld_canonical_name_trgm_idx
            on import_review.building_candidates using gin (canonical_name gin_trgm_ops)
        $idx$;

        execute $idx$
            create index if not exists irr_bld_external_id_trgm_idx
            on import_review.building_candidates using gin (external_id gin_trgm_ops)
        $idx$;

        execute $idx$
            create index if not exists irr_bld_class_code_trgm_idx
            on import_review.building_candidates using gin (class_code gin_trgm_ops)
        $idx$;
    end if;
end
$migration$;

-- -----------------------------------------------------------------------------
-- import_review.road_candidates — idempotent core (051) + filter supplements
-- Supports: GET /api/import-review/roads, filter-options DISTINCT, q search
-- -----------------------------------------------------------------------------

create index if not exists irr_road_rbid_entity_family_idx
    on import_review.road_candidates (review_batch_id, entity_family);

create index if not exists irr_road_rbid_entity_family_updated_desc_idx
    on import_review.road_candidates (review_batch_id, entity_family, updated_at desc);

create index if not exists irr_road_rbid_entity_family_not_promoted_idx
    on import_review.road_candidates (review_batch_id, entity_family)
    where promotion_status <> 'promoted';

create index if not exists irr_road_rbid_match_status_idx
    on import_review.road_candidates (review_batch_id, match_status);

create index if not exists irr_road_rbid_road_class_id_idx
    on import_review.road_candidates (review_batch_id, road_class_id)
    where road_class_id is not null;

create index if not exists irr_road_rbid_auto_action_idx
    on import_review.road_candidates (review_batch_id, auto_action);

create index if not exists irr_road_rbid_review_status_idx
    on import_review.road_candidates (review_batch_id, review_status);

create index if not exists irr_road_rbid_review_decision_idx
    on import_review.road_candidates (review_batch_id, review_decision);

create index if not exists irr_road_rbid_class_code_idx
    on import_review.road_candidates (review_batch_id, class_code)
    where class_code is not null;

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
