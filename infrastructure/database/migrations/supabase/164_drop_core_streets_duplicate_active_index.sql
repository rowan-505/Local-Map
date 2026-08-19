-- =============================================================================
-- Supabase migration 164: remove exact duplicate core_streets active index
-- =============================================================================
--
-- Production-safe execution requirement:
--   Run this file with psql/autocommit so DROP INDEX CONCURRENTLY is sent as a
--   standalone statement. Do not wrap this migration in BEGIN/COMMIT and do
--   not use a migration runner that wraps the whole file in one transaction.
--
-- Scope:
--   Drops only core.core_streets_active_idx after proving it is structurally
--   identical to the retained core.core_streets_is_active_idx and is not owned
--   by a constraint or referenced by another catalog object.
--
-- This migration does not alter core.core_streets rows, columns, or geometry
-- and does not rebuild the table.

SET lock_timeout = '5s';
SET statement_timeout = '2min';

DO $migration$
DECLARE
  keep_oid oid := to_regclass('core.core_streets_is_active_idx');
  drop_oid oid := to_regclass('core.core_streets_active_idx');
  indexes_match boolean;
BEGIN
  IF keep_oid IS NULL THEN
    RAISE EXCEPTION
      'Refusing migration 164: retained index core.core_streets_is_active_idx is missing';
  END IF;

  IF drop_oid IS NULL THEN
    RAISE NOTICE
      'core.core_streets_active_idx is already absent; concurrent drop will be a no-op';
    RETURN;
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
  FROM pg_index AS a
  CROSS JOIN pg_index AS b
  WHERE a.indexrelid = keep_oid
    AND b.indexrelid = drop_oid;

  IF indexes_match IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Refusing migration 164: core_streets active indexes are not structurally identical';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = drop_oid) THEN
    RAISE EXCEPTION
      'Refusing migration 164: core.core_streets_active_idx backs a constraint';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = drop_oid) THEN
    RAISE EXCEPTION
      'Refusing migration 164: another catalog object depends on core.core_streets_active_idx';
  END IF;
END
$migration$;

DROP INDEX CONCURRENTLY IF EXISTS core.core_streets_active_idx;

RESET lock_timeout;
RESET statement_timeout;
