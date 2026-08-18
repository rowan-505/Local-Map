-- Local mirror of supabase/156 when local has water core tables.
-- Idempotent; skips missing objects. Full logic lives in:
--   infrastructure/database/migrations/supabase/156_water_classes_taxonomy_and_lineage.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('core.core_water_lines') IS NULL
     OR to_regclass('core.core_water_polygons') IS NULL THEN
    RAISE NOTICE '014: core water tables missing — skip';
    RETURN;
  END IF;

  IF to_regclass('ref.ref_water_classes') IS NULL THEN
    RAISE NOTICE '014: apply supabase/156_water_classes_taxonomy_and_lineage.sql for full taxonomy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'core_water_lines'
      AND column_name = 'water_class_id'
  ) THEN
    RAISE NOTICE '014: water_class_id missing — run supabase/156 first';
  END IF;
END $$;

COMMIT;
