-- Index only transport FKs confirmed in list/filter/import and hierarchy queries.
-- These tables are small (largest currently about 55k rows); use transactional
-- builds so the migration runner can apply this group atomically. The lock
-- timeout prevents waiting behind live work.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

DO $block$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('transport.infrastructure_lines', 'infrastructure_lines_admin_area_id_fkey'),
      ('transport.source_links', 'source_links_import_batch_id_fkey'),
      ('transport.stops', 'stops_admin_area_id_fkey'),
      ('transport.terminals', 'terminals_admin_area_id_fkey')
    ) AS v(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = target.table_name::regclass
        AND conname = target.constraint_name
        AND contype = 'f'
    ) THEN
      RAISE EXCEPTION '185 refused: expected FK % is missing', target.constraint_name;
    END IF;
  END LOOP;
END
$block$;

CREATE INDEX IF NOT EXISTS infrastructure_lines_admin_area_id_idx
  ON transport.infrastructure_lines (admin_area_id)
  WHERE admin_area_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_links_import_batch_id_idx
  ON transport.source_links (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stops_admin_area_id_idx
  ON transport.stops (admin_area_id)
  WHERE admin_area_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS terminals_admin_area_id_idx
  ON transport.terminals (admin_area_id)
  WHERE admin_area_id IS NOT NULL;

RESET lock_timeout;
RESET statement_timeout;
