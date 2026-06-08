-- =============================================================================
-- Supabase migration 098: core-review roads performance indexes
-- =============================================================================
--
-- Safe index-only migration for GET /core-review/streets list, count, search,
-- and admin-area spatial filters on large core.core_streets tables (800k+ rows).
--
-- Rules:
--   - Indexes only — no column adds, no data backfill, no table rewrite.
--   - Transactional CREATE INDEX IF NOT EXISTS (Supabase SQL Editor / CLI
--     migration runners wrap files in a transaction — CONCURRENTLY is rejected
--     with SQLSTATE 25001).
--   - For zero-downtime on very large prod tables, run the CONCURRENTLY variants
--     at the bottom manually outside a transaction (one statement each).
--
-- Overlap with 094–096 (same index names → IF NOT EXISTS no-op when present):
--   094  list sort composites, FK filters, geom GIST, street_names
--   095  keyset tiebreaker (updated_at, id), deleted_at composite, names composite
--   096  partial (updated_at, id) for active / not-deleted lists
--   015/023  road_class_id, deleted_at, geom (some names duplicated safely)
--   baseline / 023  admin_area_id, core_admin_areas_geom_gix, public_id UNIQUE
--
-- New in 098:
--   core_streets_created_at_id_desc_idx — created_at sort + keyset tiebreaker
--   core_admin_areas_admin_level_id_is_active_idx — township admin-area filter
--
-- public_id: UNIQUE constraint core_streets_public_id_key already indexes
-- equality lookups; core_streets_public_id_idx is omitted to avoid redundancy.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- core.core_streets — list sort, filter, lookup
-- -----------------------------------------------------------------------------

create index if not exists core_streets_updated_at_id_desc_idx
    on core.core_streets (updated_at desc, id desc);

create index if not exists core_streets_created_at_id_desc_idx
    on core.core_streets (created_at desc, id desc);

create index if not exists core_streets_is_active_updated_at_id_desc_idx
    on core.core_streets (is_active, updated_at desc, id desc);

do $guard$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'core'
          and table_name = 'core_streets'
          and column_name = 'deleted_at'
    ) then
        execute $idx$
            create index if not exists core_streets_deleted_at_updated_at_id_desc_idx
                on core.core_streets (deleted_at, updated_at desc, id desc)
        $idx$;
    else
        raise notice '098: core.core_streets.deleted_at missing — skipped deleted_at composite index';
    end if;
end
$guard$;

create index if not exists core_streets_road_class_id_idx
    on core.core_streets (road_class_id);

create index if not exists core_streets_admin_area_id_idx
    on core.core_streets (admin_area_id);

create index if not exists core_streets_geom_gix
    on core.core_streets using gist (geom);

-- -----------------------------------------------------------------------------
-- core.core_street_names — lateral / EXISTS name resolution per street_id
-- -----------------------------------------------------------------------------

create index if not exists core_street_names_street_id_lang_primary_idx
    on core.core_street_names (street_id, language_code, is_primary);

-- -----------------------------------------------------------------------------
-- core.core_admin_areas — township filter + spatial intersect
-- -----------------------------------------------------------------------------

create index if not exists core_admin_areas_admin_level_id_is_active_idx
    on core.core_admin_areas (admin_level_id, is_active);

create index if not exists core_admin_areas_geom_gix
    on core.core_admin_areas using gist (geom);

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after migration)
-- =============================================================================
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'core'
--   and tablename in ('core_streets', 'core_street_names', 'core_admin_areas')
--   and indexname in (
--       'core_streets_updated_at_id_desc_idx',
--       'core_streets_created_at_id_desc_idx',
--       'core_streets_is_active_updated_at_id_desc_idx',
--       'core_streets_deleted_at_updated_at_id_desc_idx',
--       'core_streets_road_class_id_idx',
--       'core_streets_admin_area_id_idx',
--       'core_streets_geom_gix',
--       'core_street_names_street_id_lang_primary_idx',
--       'core_admin_areas_admin_level_id_is_active_idx',
--       'core_admin_areas_geom_gix',
--       'core_streets_public_id_key'
--   )
-- order by tablename, indexname;
--
-- explain (analyze, buffers)
-- select s.id
-- from core.core_streets as s
-- where s.deleted_at is null
--   and s.is_active is true
-- order by s.created_at desc, s.id desc
-- limit 51;
--
-- =============================================================================
-- Optional: zero-downtime manual apply (outside any transaction, one at a time)
-- =============================================================================
--
-- create index concurrently if not exists core_streets_created_at_id_desc_idx
--     on core.core_streets (created_at desc, id desc);
-- create index concurrently if not exists core_admin_areas_admin_level_id_is_active_idx
--     on core.core_admin_areas (admin_level_id, is_active);
-- ... repeat CONCURRENTLY for each index above when 098 already ran without them ...
--
-- =============================================================================
