-- Remove only exact duplicate indexes confirmed by catalog comparison.
-- These indexes are 8-90 KiB on empty/2,518-row tables. Ordinary DROP INDEX is
-- used so the Supabase transactional migration runner can apply the change
-- atomically. The guard refuses the cleanup if definitions or dependencies
-- have changed since the production audit.

SET lock_timeout = '5s';
SET statement_timeout = '2min';

DO $migration$
DECLARE
  pair record;
  keep_oid oid;
  drop_oid oid;
  indexes_match boolean;
BEGIN
  FOR pair IN
    SELECT *
    FROM (VALUES
      ('core.core_addresses_public_id_key',
       'core.core_addresses_public_id_uq'),
      ('core.core_admin_areas_level_idx',
       'core.core_admin_areas_admin_level_id_idx'),
      ('core.core_admin_areas_parent_idx',
       'core.core_admin_areas_parent_id_idx')
    ) AS pairs(keep_name, drop_name)
  LOOP
    keep_oid := to_regclass(pair.keep_name);
    drop_oid := to_regclass(pair.drop_name);

    IF keep_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 189 refused: retained index % is missing', pair.keep_name;
    END IF;
    IF drop_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      (a.indrelid, a.indnatts, a.indnkeyatts, a.indisunique,
       a.indisexclusion, a.indimmediate, a.indkey::text,
       a.indcollation::text, a.indclass::text, a.indoption::text,
       pg_get_expr(a.indexprs, a.indrelid),
       pg_get_expr(a.indpred, a.indrelid))
      IS NOT DISTINCT FROM
      (b.indrelid, b.indnatts, b.indnkeyatts, b.indisunique,
       b.indisexclusion, b.indimmediate, b.indkey::text,
       b.indcollation::text, b.indclass::text, b.indoption::text,
       pg_get_expr(b.indexprs, b.indrelid),
       pg_get_expr(b.indpred, b.indrelid))
    INTO indexes_match
    FROM pg_index a
    CROSS JOIN pg_index b
    WHERE a.indexrelid = keep_oid
      AND b.indexrelid = drop_oid;

    IF indexes_match IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Migration 189 refused: indexes % and % are not identical',
        pair.keep_name, pair.drop_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = drop_oid) THEN
      RAISE EXCEPTION 'Migration 189 refused: index % backs a constraint', pair.drop_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_depend
      WHERE refclassid = 'pg_class'::regclass
        AND refobjid = drop_oid
    ) THEN
      RAISE EXCEPTION 'Migration 189 refused: index % has a dependent object', pair.drop_name;
    END IF;
  END LOOP;
END
$migration$;

DROP INDEX IF EXISTS core.core_addresses_public_id_uq;
DROP INDEX IF EXISTS core.core_admin_areas_admin_level_id_idx;
DROP INDEX IF EXISTS core.core_admin_areas_parent_id_idx;

RESET lock_timeout;
RESET statement_timeout;
