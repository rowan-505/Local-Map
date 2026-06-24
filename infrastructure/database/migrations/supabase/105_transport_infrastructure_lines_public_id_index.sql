-- =============================================================================
-- Supabase migration 105: transport.infrastructure_lines public_id unique index
-- =============================================================================
--
-- Supports the new dashboard Infrastructure line detail/edit page:
--   GET   /transport/infrastructure-lines/:publicId
--   PATCH /transport/infrastructure-lines/:publicId
--
-- Both look up (and update) a single line by public_id. transport.infrastructure_lines
-- only had indexes on (id), (geom) GiST, and partial (mode)/(review_status), so every
-- public_id lookup was a full seq scan of ~11k rows — once for GET and again for the
-- PATCH RETURNING re-read. A UNIQUE index also enforces the public-id contract used
-- across the transport API.
--
-- Scope:
--   - transport schema only (no other schema touched).
--   - Index only — NO column changes, NO data rewrite.
--
-- Lock note:
--   Migration runners wrap files in a transaction, so CREATE INDEX CONCURRENTLY
--   is rejected (SQLSTATE 25001). infrastructure_lines is small (~11k rows), so the
--   brief ACCESS EXCLUSIVE lock completes in well under a second. For a strictly
--   zero-downtime apply, run the CONCURRENTLY variant at the bottom manually,
--   OUTSIDE any transaction block.
-- =============================================================================

begin;

create unique index if not exists transport_infrastructure_lines_public_id_key
    on transport.infrastructure_lines (public_id);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- select schemaname, tablename, indexname
-- from pg_indexes
-- where schemaname = 'transport'
--   and indexname = 'transport_infrastructure_lines_public_id_key';
--
-- explain (analyze, buffers)
-- select id from transport.infrastructure_lines
-- where public_id = (select public_id from transport.infrastructure_lines limit 1);
--
-- =============================================================================
-- Optional: zero-downtime manual apply (run OUTSIDE any transaction)
-- =============================================================================
--
-- create unique index concurrently if not exists transport_infrastructure_lines_public_id_key
--     on transport.infrastructure_lines (public_id);
--
-- =============================================================================
