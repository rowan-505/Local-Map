-- Frequent admin hierarchy and tile/search joins use admin_area_type_id.
-- This table is small; use a transactional index build so the migration runner
-- can apply it atomically. The lock timeout prevents waiting behind live work.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

DO $block$
DECLARE
  existing_index regclass := to_regclass('core.core_admin_areas_admin_area_type_id_idx');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'core.core_admin_areas'::regclass
      AND conname = 'core_admin_areas_admin_area_type_id_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '184 refused: expected admin-area-type FK is missing';
  END IF;

  IF existing_index IS NOT NULL THEN
    IF pg_get_indexdef(existing_index)
         <> 'CREATE INDEX core_admin_areas_admin_area_type_id_idx ON core.core_admin_areas USING btree (admin_area_type_id)' THEN
      RAISE EXCEPTION '184 refused: index name exists with an unexpected definition';
    END IF;
  END IF;
END
$block$;

CREATE INDEX IF NOT EXISTS core_admin_areas_admin_area_type_id_idx
  ON core.core_admin_areas (admin_area_type_id);

RESET lock_timeout;
RESET statement_timeout;
