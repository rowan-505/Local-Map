-- =============================================================================
-- Supabase migration 151: enforce my/en/und on building feature names
-- =============================================================================
--
-- Migration 097 intended to standardize this table, but the live constraint
-- still permits the legacy `mm` code. Fail closed if conversion would collide
-- with an existing primary `my` row; do not guess which name should win.
--
-- This migration changes only the existing Core building-name companion table.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM core.core_map_building_names AS legacy
        JOIN core.core_map_building_names AS canonical
          ON canonical.building_id = legacy.building_id
         AND canonical.name_type = legacy.name_type
         AND canonical.is_primary = true
         AND lower(btrim(canonical.language_code)) = 'my'
        WHERE legacy.is_primary = true
          AND lower(btrim(legacy.language_code)) = 'mm'
    ) THEN
        RAISE EXCEPTION
            'Cannot standardize building names: primary mm/my identity collision requires review';
    END IF;
END
$$;

ALTER TABLE core.core_map_building_names
    DROP CONSTRAINT IF EXISTS core_map_building_names_language_code_chk;

UPDATE core.core_map_building_names
SET
    language_code = 'my',
    updated_at = now()
WHERE lower(btrim(language_code)) = 'mm';

ALTER TABLE core.core_map_building_names
    ADD CONSTRAINT core_map_building_names_language_code_chk
    CHECK (language_code IN ('my', 'en', 'und'))
    NOT VALID;

ALTER TABLE core.core_map_building_names
    VALIDATE CONSTRAINT core_map_building_names_language_code_chk;

COMMIT;
