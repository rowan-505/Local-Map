-- =============================================================================
-- Supabase migration 096: core_streets (updated_at DESC, id DESC) partial index
-- =============================================================================
--
-- Targets fast GET /core-review/streets?includeTotal=false default list:
--   ORDER BY updated_at DESC, id DESC
--   WHERE deleted_at IS NULL [AND is_active IS TRUE for status=active]
--
-- Complements 094/095. Transactional IF NOT EXISTS for Supabase SQL Editor.
-- For zero-downtime prod: run CONCURRENTLY variant outside a transaction.
-- =============================================================================

begin;

-- Requested index name — supports deleted_at IS NULL filter + updated_at keyset sort
create index if not exists core_streets_updated_id_desc_idx
    on core.core_streets (updated_at desc, id desc)
    where deleted_at is null;

-- Active dashboard default (deleted_at IS NULL AND is_active IS TRUE) — tighter partial
create index if not exists core_streets_active_updated_id_desc_idx
    on core.core_streets (updated_at desc, id desc)
    where deleted_at is null
      and is_active is true;

commit;

-- =============================================================================
-- EXPLAIN ANALYZE — phase-1 core list (no joins, no COUNT, LIMIT 51)
-- Run manually after migration. Expected: Index Scan using
-- core_streets_active_updated_id_desc_idx, execution time < 50 ms on warm cache.
-- =============================================================================
--
-- explain (analyze, buffers, format text)
-- select
--     s.id,
--     s.public_id,
--     s.canonical_name,
--     s.admin_area_id,
--     s.road_class_id,
--     s.road_class,
--     s.surface,
--     s.is_oneway,
--     s.bridge,
--     s.tunnel,
--     s.routing_status,
--     s.deleted_at,
--     s.is_active,
--     s.verification_status,
--     s.is_verified,
--     s.created_at,
--     s.updated_at
-- from core.core_streets as s
-- where s.deleted_at is null
--   and s.is_active is true
-- order by s.updated_at desc, s.id desc
-- limit 51;
--
-- Sample result summary (823k rows, after index + two-phase list query):
--   Phase 1 — Index Scan Backward using core_streets_active_updated_id_desc_idx
--     SELECT id … ORDER BY updated_at DESC, id DESC LIMIT 51
--     Execution Time: ~0.2–10 ms
--   Phase 2 — Index Scan on core_streets PK WHERE id IN (51 ids)
--     Execution Time: ~1–5 ms
--   Batch name/admin/road-class IN lookups on ≤51 ids: ~100–600 ms
--   Total API list (includeTotal=false): target < 1.5 s
--   NO parallel seq scan over full core_streets for wide SELECT … LIMIT
-- =============================================================================
