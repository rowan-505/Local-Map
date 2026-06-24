-- =============================================================================
-- Supabase migration 101: transport dashboard list/filter performance indexes
-- =============================================================================
--
-- Targets the new dashboard Transport section's paginated list/filter pages.
-- Adds ONLY the indexes that are clearly missing for fast filtered lists; tables
-- that are already covered (routes, route_variants, route_stops, stops,
-- terminals, import_batches, source_links) get nothing.
--
-- Scope:
--   - transport schema only (no other schema touched).
--   - Indexes only — NO column changes, NO data rewrite, NO display_class.
--
-- Gaps addressed (verified against live indexes before writing):
--   1. transport.import_errors  — 58k rows, only a PK. The import-errors list
--      page filters/counts by import_batch_id; without this every page load is a
--      full 58k seq scan (and again for the count).
--   2. transport.infrastructure_lines — 10,874 rows, only geom GiST + PK. The
--      list page filters by mode and review_status; neither is indexed. Partial
--      WHERE deleted_at IS NULL matches the default list predicate and keeps the
--      indexes small (mirrors transport_stops_active_idx convention).
--
-- Lock note:
--   Supabase SQL Editor / CLI migration runners wrap files in a transaction, so
--   CREATE INDEX CONCURRENTLY is rejected with SQLSTATE 25001. These tables are
--   small (<= 58k rows), so the brief ACCESS EXCLUSIVE lock from a normal
--   CREATE INDEX completes in well under a second. For a strictly zero-downtime
--   apply, run the CONCURRENTLY variants at the bottom manually, one statement at
--   a time, OUTSIDE any transaction block.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- transport.import_errors — list/filter + count by batch (58,603 rows, PK only)
-- ---------------------------------------------------------------------------

-- Primary filter for the import-errors page: WHERE import_batch_id = $1
create index if not exists transport_import_errors_import_batch_id_idx
    on transport.import_errors (import_batch_id);

-- ---------------------------------------------------------------------------
-- transport.infrastructure_lines — list filters (10,874 rows, no filter index)
-- Default list predicate is deleted_at IS NULL, so partial indexes stay small.
-- ---------------------------------------------------------------------------

create index if not exists transport_infrastructure_lines_review_status_idx
    on transport.infrastructure_lines (review_status)
    where deleted_at is null;

create index if not exists transport_infrastructure_lines_mode_idx
    on transport.infrastructure_lines (mode)
    where deleted_at is null;

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- 1) Confirm the three indexes exist:
--
-- select schemaname, tablename, indexname
-- from pg_indexes
-- where schemaname = 'transport'
--   and indexname in (
--       'transport_import_errors_import_batch_id_idx',
--       'transport_infrastructure_lines_review_status_idx',
--       'transport_infrastructure_lines_mode_idx'
--   )
-- order by tablename, indexname;
--
-- 2) Import-errors filtered list — expect index scan (not seq scan on 58k):
--
-- explain (analyze, buffers)
-- select id, import_batch_id, entity_type, error_code, error_message, created_at
-- from transport.import_errors
-- where import_batch_id = (select id from transport.import_batches limit 1)
-- order by id desc
-- limit 50;
--
-- 3) Infrastructure-lines filtered list — expect partial index scan:
--
-- explain (analyze, buffers)
-- select id, public_id, mode, line_type, name, review_status, is_active, updated_at
-- from transport.infrastructure_lines
-- where deleted_at is null and review_status = 'imported_unreviewed'
-- order by updated_at desc
-- limit 50;
--
-- =============================================================================
-- Optional: zero-downtime manual apply (run OUTSIDE any transaction, one each)
-- =============================================================================
--
-- create index concurrently if not exists transport_import_errors_import_batch_id_idx
--     on transport.import_errors (import_batch_id);
--
-- create index concurrently if not exists transport_infrastructure_lines_review_status_idx
--     on transport.infrastructure_lines (review_status) where deleted_at is null;
--
-- create index concurrently if not exists transport_infrastructure_lines_mode_idx
--     on transport.infrastructure_lines (mode) where deleted_at is null;
--
-- =============================================================================
