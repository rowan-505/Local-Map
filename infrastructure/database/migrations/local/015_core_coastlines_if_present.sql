-- Local mirror of supabase/157 when local has core + system schemas.
-- Idempotent; skips missing prerequisites. Full logic lives in:
--   infrastructure/database/migrations/supabase/157_core_coastlines.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('core.core_coastlines') IS NOT NULL THEN
    RAISE NOTICE '015: core.core_coastlines already present';
    RETURN;
  END IF;

  IF to_regclass('system.system_source_registry') IS NULL
     OR to_regclass('system.system_source_snapshots') IS NULL THEN
    RAISE NOTICE '015: system source tables missing — skip coastline table';
    RETURN;
  END IF;

  RAISE NOTICE '015: apply supabase/157_core_coastlines.sql for full coastline storage';
END $$;

COMMIT;
