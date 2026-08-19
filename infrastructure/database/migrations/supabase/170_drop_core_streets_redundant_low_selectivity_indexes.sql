-- Supabase migration 170: remove two redundant/unused low-selectivity indexes.
-- is_active is covered by retained status pagination indexes; edit_status is not
-- filtered by repository queries and currently has one value.
-- Run with psql/autocommit; each DROP INDEX CONCURRENTLY must be standalone.

SET lock_timeout = '5s';
SET statement_timeout = '2min';

DO $migration$
DECLARE
  item record;
  drop_oid oid;
BEGIN
  IF to_regclass('core.core_streets_is_active_updated_at_id_desc_idx') IS NULL
     OR to_regclass('core.core_streets_active_not_deleted_idx') IS NULL THEN
    RAISE EXCEPTION '170 refused: surviving active-status index is missing';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('core.core_streets_is_active_idx',
     'CREATE INDEX core_streets_is_active_idx ON core.core_streets USING btree (is_active)'),
    ('core.core_streets_edit_status_idx',
     'CREATE INDEX core_streets_edit_status_idx ON core.core_streets USING btree (edit_status)')
  ) AS v(index_name, expected_definition)
  LOOP
    drop_oid := to_regclass(item.index_name);
    IF drop_oid IS NULL THEN CONTINUE; END IF;
    IF pg_get_indexdef(drop_oid) <> item.expected_definition THEN
      RAISE EXCEPTION '170 refused: definition changed for %', item.index_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = drop_oid) OR EXISTS (
      SELECT 1 FROM pg_depend
      WHERE refclassid = 'pg_class'::regclass AND refobjid = drop_oid
    ) THEN
      RAISE EXCEPTION '170 refused: dependency found for %', item.index_name;
    END IF;
  END LOOP;
END
$migration$;

DROP INDEX CONCURRENTLY IF EXISTS core.core_streets_is_active_idx;
DROP INDEX CONCURRENTLY IF EXISTS core.core_streets_edit_status_idx;

RESET lock_timeout;
RESET statement_timeout;
