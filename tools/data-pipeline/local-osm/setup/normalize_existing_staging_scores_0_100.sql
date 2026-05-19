-- Normalize staging.confidence_score from fractional (0–1) to percent (0–100) on LOCAL staging only.
-- Does not touch core, prod_mirror, or raw schemas. Review before running; executes only when invoked via psql.

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  tbl_list CONSTANT text[] := ARRAY[
    'staging_address_candidates',
    'staging_admin_area_candidates',
    'staging_building_candidates',
    'staging_bus_route_candidates',
    'staging_bus_route_stop_candidates',
    'staging_bus_route_variant_candidates',
    'staging_bus_stop_candidates',
    'staging_landuse_candidates',
    'staging_place_candidates',
    'staging_road_candidates',
    'staging_routing_barrier_candidates',
    'staging_routing_road_candidates',
    'staging_routing_turn_restriction_candidates',
    'staging_water_line_candidates',
    'staging_water_polygon_candidates'
  ];
  tbl text;
  tbl_exists boolean;
  col_exists boolean;
  min_v numeric;
  max_v numeric;
  avg_v numeric;
  cnt_01 bigint;
  would_exceed bigint;
  converted bigint := 0;
  drop_target record;
  typ_before text;
  typ_after text;
BEGIN
  -- Review views are dropped temporarily because ALTER COLUMN TYPE is blocked when views depend on confidence_score.
  -- Recreate them after this script by running 09_create_review_views.sql.

  -- Drop ALL staging views in the pg_depend / pg_rewrite transitive closure for key base tables (views-on-views included).
  FOR drop_target IN
    WITH RECURSIVE staging_dependent_views AS (
      SELECT DISTINCT r.ev_class AS view_oid
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class base ON base.oid = d.refobjid
      JOIN pg_namespace base_ns ON base_ns.oid = base.relnamespace
      WHERE d.refclassid = 'pg_class'::regclass
        AND base_ns.nspname = 'staging'
        AND base.relkind IN ('r', 'p')
        AND base.relname IN (
          'staging_place_candidates',
          'staging_road_candidates',
          'staging_admin_area_candidates',
          'staging_bus_stop_candidates'
        )

      UNION

      SELECT DISTINCT v.oid AS view_oid
      FROM pg_depend d
      JOIN pg_class v ON v.oid = d.objid AND v.relkind = 'v'
      JOIN pg_class base ON base.oid = d.refobjid
      JOIN pg_namespace base_ns ON base_ns.oid = base.relnamespace
      WHERE d.refclassid = 'pg_class'::regclass
        AND base_ns.nspname = 'staging'
        AND base.relkind IN ('r', 'p')
        AND base.relname IN (
          'staging_place_candidates',
          'staging_road_candidates',
          'staging_admin_area_candidates',
          'staging_bus_stop_candidates'
        )

      UNION

      -- Expand through views-on-views: pg_depend.refobjid is the referenced object (already in closure).
      -- Single reference to staging_dependent_views here — Postgres forbids multiple recursive self-refs.
      SELECT DISTINCT x.view_oid
      FROM staging_dependent_views sdv
      CROSS JOIN LATERAL (
        SELECT r.ev_class AS view_oid
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        WHERE d.refclassid = 'pg_class'::regclass
          AND d.refobjid = sdv.view_oid

        UNION

        SELECT dep_view.oid AS view_oid
        FROM pg_depend d
        JOIN pg_class dep_view ON dep_view.oid = d.objid AND dep_view.relkind = 'v'
        WHERE d.refclassid = 'pg_class'::regclass
          AND d.refobjid = sdv.view_oid
      ) AS x
      JOIN pg_class c ON c.oid = x.view_oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'v'
        AND n.nspname = 'staging'
    )
    SELECT c.relname AS view_name
    FROM staging_dependent_views sdv
    JOIN pg_class c ON c.oid = sdv.view_oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname = 'staging'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP VIEW IF EXISTS staging.%I CASCADE',
      drop_target.view_name
    );
    RAISE NOTICE
      'DROP VIEW (depends on staging_place/road/admin_area/bus_stop candidates via pg_depend/pg_rewrite closure): staging.%',
      drop_target.view_name;
  END LOOP;

  -- Known review view name patterns (still applied so anything missed by dependency tracing is removed).
  FOR drop_target IN
    SELECT c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'staging'
      AND c.relkind = 'v'
      AND (
        c.relname LIKE 'v_no_conflict_%'
        OR c.relname LIKE 'v_review_%'
        OR c.relname LIKE 'v_manual_protected_%'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP VIEW IF EXISTS staging.%I CASCADE',
      drop_target.view_name
    );
    RAISE NOTICE 'DROP VIEW (name pattern v_no_conflict_/v_review_/v_manual_protected_): staging.%', drop_target.view_name;
  END LOOP;

  FOREACH tbl IN ARRAY tbl_list
  LOOP
    converted := 0;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'staging'
        AND t.table_name = tbl
    )
    INTO tbl_exists;

    IF NOT tbl_exists THEN
      RAISE NOTICE 'SKIP: staging.% does not exist', tbl;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'staging'
        AND c.table_name = tbl
        AND c.column_name = 'confidence_score'
    )
    INTO col_exists;

    IF NOT col_exists THEN
      RAISE NOTICE 'SKIP: staging.% has no confidence_score column', tbl;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT min(confidence_score), max(confidence_score), avg(confidence_score), '
      || 'count(*) FILTER (WHERE confidence_score IS NOT NULL AND confidence_score BETWEEN 0 AND 1) '
      || 'FROM staging.%I',
      tbl
    )
    INTO min_v, max_v, avg_v, cnt_01;

    RAISE NOTICE 'BEFORE staging.% | table_name=staging.% | min=% | max=% | avg=% | count_0_to_1=%',
      tbl, tbl, min_v, max_v, avg_v, cnt_01;

    EXECUTE format(
      'SELECT count(*) FROM staging.%I '
      || 'WHERE confidence_score IS NOT NULL '
      || '  AND confidence_score BETWEEN 0 AND 1 '
      || '  AND (confidence_score * 100) > 100',
      tbl
    )
    INTO would_exceed;

    IF would_exceed > 0 THEN
      RAISE WARNING 'staging.%: % row(s) would exceed 100 after scaling (unexpected); proceeding may still clamp via type cast',
        tbl, would_exceed;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod)
    INTO typ_before
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'staging'
      AND c.relname = tbl
      AND a.attname = 'confidence_score'
      AND NOT a.attisdropped
      AND a.attnum > 0;

    RAISE NOTICE 'staging.% confidence_score column type BEFORE ALTER: %', tbl, typ_before;

    BEGIN
      EXECUTE format(
        'ALTER TABLE staging.%I '
        || 'ALTER COLUMN confidence_score TYPE numeric(6,2) '
        || 'USING confidence_score::numeric(6,2)',
        tbl
      );

      SELECT format_type(a.atttypid, a.atttypmod)
      INTO typ_after
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'staging'
        AND c.relname = tbl
        AND a.attname = 'confidence_score'
        AND NOT a.attisdropped
        AND a.attnum > 0;

      RAISE NOTICE 'staging.% confidence_score column type AFTER ALTER: %', tbl, typ_after;

      EXECUTE format(
        'UPDATE staging.%I '
        || 'SET confidence_score = confidence_score * 100 '
        || 'WHERE confidence_score IS NOT NULL '
        || '  AND confidence_score BETWEEN 0 AND 1',
        tbl
      );
      GET DIAGNOSTICS converted = ROW_COUNT;

      RAISE NOTICE 'staging.% converted_row_count=%', tbl, converted;

      EXECUTE format(
        'SELECT min(confidence_score), max(confidence_score), avg(confidence_score) '
        || 'FROM staging.%I',
        tbl
      )
      INTO min_v, max_v, avg_v;

      IF max_v IS NOT NULL AND max_v > 100 THEN
        RAISE WARNING 'staging.%: max(confidence_score)=% exceeds 100 after conversion',
          tbl, max_v;
      END IF;

      RAISE NOTICE 'AFTER staging.% | table_name=staging.% | min=% | max=% | avg=% | converted_row_count=%',
        tbl, tbl, min_v, max_v, avg_v, converted;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'FAILED staging.% (subtransaction rolled back for this table): %', tbl, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Recreate views by running tools/data-pipeline/local-osm/09_create_review_views.sql';
END $$;

COMMIT;
