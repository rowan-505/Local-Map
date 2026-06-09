-- =============================================================================
-- Validation: core.core_admin_areas.deleted_at (local ↔ Supabase parity)
-- =============================================================================
--
-- Read-only. Run after:
--   infrastructure/database/migrations/local/008_core_admin_areas_deleted_at.sql
--
-- =============================================================================

-- 1. Column exists with expected type
SELECT
    '01_deleted_at_column' AS check_name,
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'core'
          AND table_name = 'core_admin_areas'
          AND column_name = 'deleted_at'
          AND udt_name = 'timestamptz'
          AND is_nullable = 'YES'
    ) AS passed;

-- 2. Index exists
SELECT
    '02_deleted_at_index' AS check_name,
    EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'core'
          AND tablename = 'core_admin_areas'
          AND indexname = 'core_admin_areas_deleted_at_idx'
    ) AS passed;

-- 3. deleted_at filter used by entity-admin-area infer (same shape as API repo SQL)
SELECT
    '03_deleted_at_filter_query' AS check_name,
    COUNT(*)::bigint AS active_admin_area_count
FROM core.core_admin_areas AS aa
WHERE aa.is_active IS TRUE
  AND aa.deleted_at IS NULL;
