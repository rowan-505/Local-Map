-- Indexes for resumable import-review road bulk promotion (05_bulk_promote_roads.sql).
-- Script also runs CREATE INDEX IF NOT EXISTS idempotently before each chunk.

create index if not exists irr_road_rbid_pstat_id_idx
    on import_review.road_candidates (review_batch_id, promotion_status, id);

create index if not exists irr_road_rbid_promoted_core_id_idx
    on import_review.road_candidates (review_batch_id, promoted_core_id, id);

create index if not exists irr_road_rbid_unpromoted_id_idx
    on import_review.road_candidates (review_batch_id, id)
    where coalesce(promotion_status, '') is distinct from 'promoted'
      and promoted_core_id is null;

create index if not exists irr_road_extid_promote_idx
    on import_review.road_candidates (external_id)
    where external_id is not null and btrim(external_id) <> '';

create index if not exists core_streets_external_id_promote_idx
    on core.core_streets (external_id)
    where external_id is not null and btrim(external_id) <> '';
