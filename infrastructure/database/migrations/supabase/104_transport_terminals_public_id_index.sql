-- =============================================================================
-- Supabase migration 104: transport.terminals public_id unique index
-- =============================================================================
--
-- Supports the new dashboard Transport Terminal detail/edit page:
--   GET   /transport/terminals/:publicId
--   PATCH /transport/terminals/:publicId
--
-- Both look up (and update) a single terminal by public_id. transport.terminals
-- only had indexes on (id), (geom) GiST, and (mode), so every public_id lookup
-- was a full seq scan of ~3.8k rows — once for GET and again for the PATCH
-- RETURNING re-read. A UNIQUE index also enforces the public-id contract used
-- across the transport API.
--
-- Scope:
--   - transport schema only (no other schema touched).
--   - Index only — NO column changes, NO data rewrite.
--
-- Lock note:
--   Migration runners wrap files in a transaction, so CREATE INDEX CONCURRENTLY
--   is rejected (SQLSTATE 25001). terminals is small (~3.8k rows), so the brief
--   ACCESS EXCLUSIVE lock completes in well under a second. For a strictly
--   zero-downtime apply, run the CONCURRENTLY variant at the bottom manually,
--   OUTSIDE any transaction block.
-- =============================================================================

begin;

create unique index if not exists transport_terminals_public_id_key
    on transport.terminals (public_id);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- select schemaname, tablename, indexname
-- from pg_indexes
-- where schemaname = 'transport'
--   and indexname = 'transport_terminals_public_id_key';
--
-- explain (analyze, buffers)
-- select id from transport.terminals
-- where public_id = (select public_id from transport.terminals limit 1);
--
-- =============================================================================
-- Optional: zero-downtime manual apply (run OUTSIDE any transaction)
-- =============================================================================
--
-- create unique index concurrently if not exists transport_terminals_public_id_key
--     on transport.terminals (public_id);
--
-- =============================================================================
