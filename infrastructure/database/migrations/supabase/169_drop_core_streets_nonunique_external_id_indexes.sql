-- Supabase migration 169: retain one canonical unique external_id index.
-- Representative API/import plans already select core_streets_external_id_unique_idx.
-- Run with psql/autocommit; each DROP INDEX CONCURRENTLY must be standalone.

SET lock_timeout = '5s';
SET statement_timeout = '2min';

DO $migration$
DECLARE
  item record;
  drop_oid oid;
  keep_oid oid := to_regclass('core.core_streets_external_id_unique_idx');
BEGIN
  IF keep_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = keep_oid AND indisunique AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION '169 refused: canonical unique external_id index is missing or unusable';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('core.core_streets_external_id_idx',
     'CREATE INDEX core_streets_external_id_idx ON core.core_streets USING btree (external_id) WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL))'),
    ('core.core_streets_external_id_promote_idx',
     'CREATE INDEX core_streets_external_id_promote_idx ON core.core_streets USING btree (external_id) WHERE ((external_id IS NOT NULL) AND (btrim(external_id) <> ''''::text))')
  ) AS v(index_name, expected_definition)
  LOOP
    drop_oid := to_regclass(item.index_name);
    IF drop_oid IS NULL THEN CONTINUE; END IF;
    IF pg_get_indexdef(drop_oid) <> item.expected_definition THEN
      RAISE EXCEPTION '169 refused: definition changed for %', item.index_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = drop_oid) OR EXISTS (
      SELECT 1 FROM pg_depend
      WHERE refclassid = 'pg_class'::regclass AND refobjid = drop_oid
    ) THEN
      RAISE EXCEPTION '169 refused: dependency found for %', item.index_name;
    END IF;
  END LOOP;
END
$migration$;

DROP INDEX CONCURRENTLY IF EXISTS core.core_streets_external_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS core.core_streets_external_id_promote_idx;

RESET lock_timeout;
RESET statement_timeout;
