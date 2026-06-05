-- =============================================================================
-- Supabase migration 095: core.core_streets keyset/list tiebreaker indexes
-- =============================================================================
--
-- Complements 094 + 030 partial index with bigint id tiebreaker for stable
-- ORDER BY updated_at DESC, id DESC and keyset pagination.
--
-- Transactional CREATE INDEX IF NOT EXISTS (Supabase SQL Editor compatible).
-- =============================================================================

begin;

-- Default active core-review list (deleted_at IS NULL AND is_active IS TRUE)
create index if not exists core_streets_active_updated_id_desc_idx
    on core.core_streets (updated_at desc, id desc)
    where deleted_at is null
      and is_active is true;

-- status=all / unfiltered updated_at sorts
create index if not exists core_streets_updated_at_id_desc_idx
    on core.core_streets (updated_at desc, id desc);

-- is_active filter + updated_at sort
create index if not exists core_streets_is_active_updated_at_id_desc_idx
    on core.core_streets (is_active, updated_at desc, id desc);

-- deleted / inactive review lists
create index if not exists core_streets_deleted_at_updated_at_id_desc_idx
    on core.core_streets (deleted_at, updated_at desc, id desc);

-- name lookups per street (replaces separate language + street_id indexes for lateral/scalar)
create index if not exists core_street_names_street_id_lang_primary_idx
    on core.core_street_names (street_id, language_code, is_primary);

commit;
