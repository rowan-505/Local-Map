-- Local mirror of supabase/155 when local has landuse tables.
-- Idempotent; skips missing objects. Full logic lives in:
--   infrastructure/database/migrations/supabase/155_land_area_taxonomy_and_lineage.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('ref.ref_landuse_classes') IS NOT NULL
     AND to_regclass('ref.ref_land_area_classes') IS NULL THEN
    ALTER TABLE ref.ref_landuse_classes RENAME TO ref_land_area_classes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_areas' AND column_name='landuse_class_id'
  ) THEN
    ALTER TABLE core.core_land_areas RENAME COLUMN landuse_class_id TO land_area_class_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_area_names' AND column_name='landuse_id'
  ) THEN
    ALTER TABLE core.core_land_area_names RENAME COLUMN landuse_id TO land_area_id;
  END IF;

  IF to_regclass('import_review.landuse_candidates') IS NOT NULL
     AND to_regclass('import_review.land_area_candidates') IS NULL THEN
    ALTER TABLE import_review.landuse_candidates RENAME TO land_area_candidates;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='import_review' AND table_name='land_area_candidates'
      AND column_name='landuse_class_id'
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME COLUMN landuse_class_id TO land_area_class_id;
  END IF;
END $$;

COMMIT;
