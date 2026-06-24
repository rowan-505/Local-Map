-- =============================================================================
-- Supabase migration 102: transport.route_stops stop_id index
-- =============================================================================
--
-- Supports the new dashboard Transport Stops list page (GET /transport/stops),
-- which derives each stop's route_count and the hasRoutes filter by looking up
-- transport.route_stops BY stop_id:
--
--   (SELECT count(DISTINCT v.route_id)
--      FROM transport.route_stops rs
--      JOIN transport.route_variants v ON v.id = rs.route_variant_id
--     WHERE rs.stop_id = s.id AND v.deleted_at IS NULL)
--
-- route_stops only had indexes on (id) and (route_variant_id, stop_sequence), so
-- every stop_id lookup was a full seq scan of route_stops. This index also helps
-- the route-stop "remove" / future stop-detail lookups that key on stop_id.
--
-- Scope:
--   - transport schema only (no other schema touched).
--   - Index only — NO column changes, NO data rewrite.
--
-- Lock note:
--   Migration runners wrap files in a transaction, so CREATE INDEX CONCURRENTLY
--   is rejected (SQLSTATE 25001). route_stops is tiny (~9k rows), so the brief
--   ACCESS EXCLUSIVE lock from a normal CREATE INDEX completes in well under a
--   second. For a strictly zero-downtime apply, run the CONCURRENTLY variant at
--   the bottom manually, OUTSIDE any transaction block.
-- =============================================================================

begin;

create index if not exists transport_route_stops_stop_id_idx
    on transport.route_stops (stop_id);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- select schemaname, tablename, indexname
-- from pg_indexes
-- where schemaname = 'transport'
--   and indexname = 'transport_route_stops_stop_id_idx';
--
-- explain (analyze, buffers)
-- select count(distinct v.route_id)
-- from transport.route_stops rs
-- join transport.route_variants v on v.id = rs.route_variant_id
-- where rs.stop_id = (select id from transport.stops limit 1)
--   and v.deleted_at is null;
--
-- =============================================================================
-- Optional: zero-downtime manual apply (run OUTSIDE any transaction)
-- =============================================================================
--
-- create index concurrently if not exists transport_route_stops_stop_id_idx
--     on transport.route_stops (stop_id);
--
-- =============================================================================
