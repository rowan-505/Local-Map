-- =============================================================================
-- Supabase migration 107: transport list/detail query performance indexes
-- =============================================================================
--
-- Adds the minimal set of indexes that are clearly missing for the dashboard
-- Transport list/detail/filter endpoints. Each index below was verified absent
-- against the live database before writing (only PKs / unrelated indexes existed
-- on the targeted columns).
--
-- Scope:
--   - transport schema only (no other schema touched).
--   - Indexes only — NO column changes, NO data rewrite.
--   - NO full-text / trigram / generated-name regex indexes (intentionally out
--     of scope; revisit when unified search lands).
--
-- Index -> endpoint/filter it serves:
--   1. stop_names(stop_id, language_code)
--        GET /transport/stops/:publicId — per-stop name lookups (mm/en) join
--        transport.stop_names by stop_id + language_code. Previously seq-scanned.
--   2. route_names(route_id, language_code)
--        GET /transport/routes (LATERAL mm/en name lookups) and route detail —
--        join transport.route_names by route_id + language_code.
--   3. terminals(linked_stop_id)
--        GET /transport/stops — hasTerminal filter (EXISTS) and terminal info
--        (has_terminal / terminal_role / terminal_code) join by linked_stop_id.
--        Also stop detail terminal lookup.
--   4. terminals(review_status) WHERE deleted_at IS NULL
--        GET /transport/terminals — review_status list filter on live rows.
--   5. routes(review_status)
--        GET /transport/routes — review_status list filter.
--   6. routes(is_active) WHERE deleted_at IS NULL
--        GET /transport/routes — isActive list filter on live rows (mirrors the
--        existing transport_stops_active_idx convention).
--   7. import_errors(error_code)
--        GET /transport/import-errors — errorCode list filter.
--   8. import_errors(entity_type)
--        GET /transport/import-errors — entityType list filter.
--
-- Lock note:
--   Supabase SQL Editor / CLI migration runners wrap files in a transaction, so
--   CREATE INDEX CONCURRENTLY is rejected (SQLSTATE 25001). All targeted tables
--   are small (<= ~58k rows), so the brief ACCESS EXCLUSIVE lock from a normal
--   CREATE INDEX completes in well under a second. For a strictly zero-downtime
--   apply, run the CONCURRENTLY variants at the bottom manually, one statement at
--   a time, OUTSIDE any transaction block.
-- =============================================================================

begin;

-- 1. Stop detail name lookups: transport.stop_names by (stop_id, language_code)
create index if not exists transport_stop_names_stop_id_language_idx
    on transport.stop_names (stop_id, language_code);

-- 2. Route list/detail name lookups: transport.route_names by (route_id, language_code)
create index if not exists transport_route_names_route_id_language_idx
    on transport.route_names (route_id, language_code);

-- 3. Stops list hasTerminal + terminal info join: transport.terminals(linked_stop_id)
create index if not exists transport_terminals_linked_stop_id_idx
    on transport.terminals (linked_stop_id);

-- 4. Terminals list review_status filter on live rows
create index if not exists transport_terminals_review_status_idx
    on transport.terminals (review_status)
    where deleted_at is null;

-- 5. Routes list review_status filter
create index if not exists transport_routes_review_status_idx
    on transport.routes (review_status);

-- 6. Routes list isActive filter on live rows
create index if not exists transport_routes_active_idx
    on transport.routes (is_active)
    where deleted_at is null;

-- 7. Import-errors list error_code filter
create index if not exists transport_import_errors_error_code_idx
    on transport.import_errors (error_code);

-- 8. Import-errors list entity_type filter
create index if not exists transport_import_errors_entity_type_idx
    on transport.import_errors (entity_type);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- 1) Confirm all eight indexes exist:
--
-- select tablename, indexname
-- from pg_indexes
-- where schemaname = 'transport'
--   and indexname in (
--       'transport_stop_names_stop_id_language_idx',
--       'transport_route_names_route_id_language_idx',
--       'transport_terminals_linked_stop_id_idx',
--       'transport_terminals_review_status_idx',
--       'transport_routes_review_status_idx',
--       'transport_routes_active_idx',
--       'transport_import_errors_error_code_idx',
--       'transport_import_errors_entity_type_idx'
--   )
-- order by tablename, indexname;
--
-- 2) Terminals hasTerminal lookup — expect index scan (not seq scan on ~3.8k):
--
-- explain (analyze, buffers)
-- select 1 from transport.terminals t
-- where t.linked_stop_id = (select id from transport.stops limit 1)
--   and t.deleted_at is null;
--
-- =============================================================================
-- Optional: zero-downtime manual apply (run OUTSIDE any transaction, one each)
-- =============================================================================
--
-- create index concurrently if not exists transport_stop_names_stop_id_language_idx
--     on transport.stop_names (stop_id, language_code);
--
-- create index concurrently if not exists transport_route_names_route_id_language_idx
--     on transport.route_names (route_id, language_code);
--
-- create index concurrently if not exists transport_terminals_linked_stop_id_idx
--     on transport.terminals (linked_stop_id);
--
-- create index concurrently if not exists transport_terminals_review_status_idx
--     on transport.terminals (review_status) where deleted_at is null;
--
-- create index concurrently if not exists transport_routes_review_status_idx
--     on transport.routes (review_status);
--
-- create index concurrently if not exists transport_routes_active_idx
--     on transport.routes (is_active) where deleted_at is null;
--
-- create index concurrently if not exists transport_import_errors_error_code_idx
--     on transport.import_errors (error_code);
--
-- create index concurrently if not exists transport_import_errors_entity_type_idx
--     on transport.import_errors (entity_type);
--
-- =============================================================================
