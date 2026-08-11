-- =============================================================================
-- 147: import_review.landuse_candidates.admin_area_id
-- -----------------------------------------------------------------------------
-- Carry production township admin_area_id from Stage 08c / IR upload into
-- landuse candidates (same FK pattern as places/roads/buildings).
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regnamespace('import_review') IS NULL THEN
        RAISE EXCEPTION '147: schema import_review does not exist.';
    END IF;
    IF to_regclass('import_review.landuse_candidates') IS NULL THEN
        RAISE EXCEPTION '147: import_review.landuse_candidates does not exist.';
    END IF;
END $$;

ALTER TABLE import_review.landuse_candidates
    ADD COLUMN IF NOT EXISTS admin_area_id bigint NULL;

COMMENT ON COLUMN import_review.landuse_candidates.admin_area_id IS
    'Production core.core_admin_areas.id (operational township) from Stage 08c prod_mirror assign.';

DO $$
BEGIN
    IF to_regclass('core.core_admin_areas') IS NULL THEN
        RAISE NOTICE '147: skipped irr_landuse_admin_area_id_fkey — core.core_admin_areas missing.';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'irr_landuse_admin_area_id_fkey'
          AND conrelid = 'import_review.landuse_candidates'::regclass
    ) THEN
        ALTER TABLE import_review.landuse_candidates
            ADD CONSTRAINT irr_landuse_admin_area_id_fkey
            FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS irr_landuse_admin_area_id_idx
    ON import_review.landuse_candidates (admin_area_id);

COMMIT;
