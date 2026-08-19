-- =============================================================================
-- Supabase migration 165: remove exact duplicate route_stops indexes
-- =============================================================================
--
-- Production-safe execution requirement:
--   Run this file with psql/autocommit so each DROP INDEX CONCURRENTLY is sent
--   as a standalone statement. Do not wrap this migration in BEGIN/COMMIT and
--   do not use a migration runner that wraps the whole file in one transaction.
--
-- Each proposed drop is guarded by a structural comparison with the retained
-- copy plus constraint and reverse-dependency checks. No table data, columns,
-- or constraints are modified.

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
      ('transport.route_stops_stop_id_idx',
       'transport.transport_route_stops_stop_id_idx'),
      ('transport.transport_route_stops_timing_idx',
       'transport.route_stops_timing_idx'),
      ('transport.route_stops_variant_sequence_idx',
       'transport.transport_route_stops_variant_sequence_idx')
    ) AS pairs(keep_name, drop_name)
  LOOP
    keep_oid := to_regclass(pair.keep_name);
    drop_oid := to_regclass(pair.drop_name);

    IF keep_oid IS NULL THEN
      RAISE EXCEPTION
        'Refusing migration 165: retained index % is missing', pair.keep_name;
    END IF;

    IF drop_oid IS NULL THEN
      RAISE NOTICE '% is already absent; concurrent drop will be a no-op', pair.drop_name;
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
    FROM pg_index AS a
    CROSS JOIN pg_index AS b
    WHERE a.indexrelid = keep_oid
      AND b.indexrelid = drop_oid;

    IF indexes_match IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'Refusing migration 165: indexes % and % are not structurally identical',
        pair.keep_name, pair.drop_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = drop_oid) THEN
      RAISE EXCEPTION
        'Refusing migration 165: index % backs a constraint', pair.drop_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = drop_oid) THEN
      RAISE EXCEPTION
        'Refusing migration 165: another catalog object depends on index %', pair.drop_name;
    END IF;
  END LOOP;
END
$migration$;

DROP INDEX CONCURRENTLY IF EXISTS transport.transport_route_stops_stop_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS transport.route_stops_timing_idx;
DROP INDEX CONCURRENTLY IF EXISTS transport.transport_route_stops_variant_sequence_idx;

RESET lock_timeout;
RESET statement_timeout;
