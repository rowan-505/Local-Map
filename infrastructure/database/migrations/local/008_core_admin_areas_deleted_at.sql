-- =============================================================================
-- Local migration 008: core.core_admin_areas.deleted_at (align with Supabase 030)
-- =============================================================================
--
-- Purpose:
--   Local baseline predates Supabase migration 030 soft-delete columns. API and
--   tile SQL expect core.core_admin_areas.deleted_at (e.g. entity-admin-area infer).
--
-- Safety:
--   - ADD COLUMN IF NOT EXISTS only; no data rewrite.
--   - NULL deleted_at = active (unchanged rows stay active).
--   - Skips when table missing.
--   - Idempotent index creation.
--
-- Supabase reference: migrations/supabase/030_core_review_soft_delete_columns_and_tile_filters.sql
--
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('core.core_admin_areas') IS NULL THEN
        RAISE NOTICE '008: core.core_admin_areas missing — skipped';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'core'
          AND table_name = 'core_admin_areas'
          AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE core.core_admin_areas
            ADD COLUMN deleted_at timestamptz NULL;

        COMMENT ON COLUMN core.core_admin_areas.deleted_at IS
            'Soft-delete tombstone (timestamptz). NULL = active in default lists/tiles; set via dashboard/API soft delete.';

        RAISE NOTICE '008: added core.core_admin_areas.deleted_at';
    ELSE
        RAISE NOTICE '008: core.core_admin_areas.deleted_at already present — skipped column add';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS core_admin_areas_deleted_at_idx
    ON core.core_admin_areas (deleted_at);

COMMIT;
