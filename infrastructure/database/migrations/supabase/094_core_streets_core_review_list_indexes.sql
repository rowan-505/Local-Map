-- =============================================================================
-- Supabase migration 094: core.core_streets + core.core_street_names list indexes
-- =============================================================================
--
-- Targets slow GET /api/core-review/streets list + count on large core_streets
-- tables (800k+ rows): ORDER BY updated_at DESC, status filters, FK filters,
-- lateral/EXISTS name lookups.
--
-- Rules:
--   - No data rewrite (indexes only).
--   - Uses transactional CREATE INDEX IF NOT EXISTS (Supabase SQL Editor / CLI
--     migration runners wrap files in a transaction — CONCURRENTLY is rejected
--     with SQLSTATE 25001).
--   - For zero-downtime on very large prod tables, run the same statements with
--     CONCURRENTLY manually outside a transaction block (one statement each).
--
-- Overlap with prior migrations (idempotent IF NOT EXISTS):
--   015  core_streets_geom_gix, core_streets_road_class_id_idx,
--        core_streets_is_active_idx, core_streets_deleted_at_idx
--   023  core_streets_geom_gix, core_streets_road_class_id_idx (duplicate names)
--   030  core_streets_active_not_deleted_idx (partial: active + not deleted)
--   baseline  core_streets_admin_area_id_idx, core_street_names_street_id_idx
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- core.core_streets — list sort + filter composites
-- -----------------------------------------------------------------------------

-- status=all (and other unfiltered sorts): ORDER BY updated_at DESC LIMIT n
create index if not exists core_streets_updated_at_desc_idx
    on core.core_streets (updated_at desc);

-- is_active filter + updated_at sort (broader than partial active_not_deleted)
create index if not exists core_streets_is_active_updated_at_desc_idx
    on core.core_streets (is_active, updated_at desc);

-- deleted / inactive review lists: (deleted_at IS NOT NULL OR is_active IS FALSE)
create index if not exists core_streets_deleted_at_updated_at_desc_idx
    on core.core_streets (deleted_at, updated_at desc);

-- dashboard filters (015/023 may already have road_class_id; IF NOT EXISTS no-op)
create index if not exists core_streets_road_class_id_idx
    on core.core_streets (road_class_id);

create index if not exists core_streets_admin_area_id_idx
    on core.core_streets (admin_area_id);

-- spatial endpoints (nearest-point, validation); skip if 015/023 already created
create index if not exists core_streets_geom_gix
    on core.core_streets using gist (geom);

-- -----------------------------------------------------------------------------
-- core.core_street_names — lateral / EXISTS name resolution per street_id
-- -----------------------------------------------------------------------------

create index if not exists core_street_names_street_id_idx
    on core.core_street_names (street_id);

create index if not exists core_street_names_language_code_is_primary_idx
    on core.core_street_names (language_code, is_primary);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after migration)
-- =============================================================================
--
-- 1) Confirm indexes exist on core tables:
--
-- select
--     schemaname,
--     tablename,
--     indexname,
--     indexdef
-- from pg_indexes
-- where schemaname = 'core'
--   and tablename in ('core_streets', 'core_street_names')
--   and indexname in (
--       'core_streets_updated_at_desc_idx',
--       'core_streets_is_active_updated_at_desc_idx',
--       'core_streets_deleted_at_updated_at_desc_idx',
--       'core_streets_road_class_id_idx',
--       'core_streets_admin_area_id_idx',
--       'core_streets_geom_gix',
--       'core_streets_active_not_deleted_idx',
--       'core_street_names_street_id_idx',
--       'core_street_names_language_code_is_primary_idx'
--   )
-- order by tablename, indexname;
--
-- 2) Active core-review list (default dashboard page) — expect index scan:
--
-- explain (analyze, buffers)
-- select s.id
-- from core.core_streets as s
-- where s.deleted_at is null
--   and s.is_active is true
-- order by s.updated_at desc, s.public_id asc
-- limit 50;
--
-- 3) Core-review count (no search) — expect fast plan on status filter:
--
-- explain (analyze, buffers)
-- select count(*)::bigint
-- from core.core_streets as s
-- where s.deleted_at is null
--   and s.is_active is true;
--
-- 4) Street name lateral (one row) — expect street_id index on core_street_names:
--
-- explain (analyze, buffers)
-- select max(sn.name)
-- from core.core_street_names as sn
-- where sn.street_id = (
--     select id from core.core_streets
--     where deleted_at is null and is_active is true
--     order by updated_at desc
--     limit 1
-- )
--   and sn.language_code in ('my', 'mm')
--   and sn.name_type = 'official'
--   and sn.is_primary is true;
--
-- =============================================================================
-- Optional: zero-downtime manual apply (outside any transaction, one at a time)
-- =============================================================================
--
-- create index concurrently if not exists core_streets_updated_at_desc_idx
--     on core.core_streets (updated_at desc);
-- ... repeat for each index above with CONCURRENTLY ...
--
-- =============================================================================
