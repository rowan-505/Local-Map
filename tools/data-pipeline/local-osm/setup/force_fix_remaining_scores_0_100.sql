-- Force-fix confidence_score on four staging candidate tables still on 0–1 scale (local DB only).
-- Drops dependent views (any schema) plus known staging review view name patterns.
-- Recreate views afterward — see closing NOTICE.

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  tbl_list CONSTANT text[] := ARRAY[
    'staging_place_candidates',
    'staging_road_candidates',
    'staging_admin_area_candidates',
    'staging_bus_stop_candidates'
  ];
  tbl text;
  tbl_exists boolean;
  col_exists boolean;
  min_v numeric;
  max_v numeric;
  avg_v numeric;
  cnt_01 bigint;
  converted bigint := 0;
  drop_rec record;
  typ_before text;
  typ_after text;
BEGIN
  -- Dependent views (any schema) discovered via pg_depend + pg_rewrite transitive closure on the four base tables.
  FOR drop_rec IN
    WITH RECURSIVE dependent_views AS (
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

      SELECT DISTINCT x.view_oid
      FROM dependent_views dv
      CROSS JOIN LATERAL (
        SELECT r.ev_class AS view_oid
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        WHERE d.refclassid = 'pg_class'::regclass
          AND d.refobjid = dv.view_oid

        UNION

        SELECT dep_view.oid AS view_oid
        FROM pg_depend d
        JOIN pg_class dep_view ON dep_view.oid = d.objid AND dep_view.relkind = 'v'
        WHERE d.refclassid = 'pg_class'::regclass
          AND d.refobjid = dv.view_oid
      ) AS x
      JOIN pg_class c ON c.oid = x.view_oid
      WHERE c.relkind = 'v'
    )
    SELECT n.nspname AS schema_name,
           c.relname AS view_name
    FROM dependent_views dv
    JOIN pg_class c ON c.oid = dv.view_oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'DROP VIEW IF EXISTS %I.%I CASCADE',
      drop_rec.schema_name,
      drop_rec.view_name
    );
    RAISE NOTICE
      'DROP VIEW (pg_depend/pg_rewrite closure on staging_place/road/admin_area/bus_stop candidates): %.%',
      drop_rec.schema_name,
      drop_rec.view_name;
  END LOOP;

  FOR drop_rec IN
    SELECT n.nspname AS schema_name,
           c.relname AS view_name
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
      'DROP VIEW IF EXISTS %I.%I CASCADE',
      drop_rec.schema_name,
      drop_rec.view_name
    );
    RAISE NOTICE 'DROP VIEW (staging name pattern): staging.%', drop_rec.view_name;
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
      FROM information_schema.columns col
      WHERE col.table_schema = 'staging'
        AND col.table_name = tbl
        AND col.column_name = 'confidence_score'
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

    RAISE NOTICE 'BEFORE staging.% | min=% | max=% | avg=% | count_0_to_1=%',
      tbl, min_v, max_v, avg_v, cnt_01;

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

    RAISE NOTICE 'staging.% confidence_score type BEFORE ALTER: %', tbl, typ_before;

    BEGIN
      EXECUTE format(
        'ALTER TABLE staging.%I '
        || 'ALTER COLUMN confidence_score TYPE numeric(6,2) '
        || 'USING confidence_score::numeric(6,2)',
        tbl
      );

      EXECUTE format(
        'UPDATE staging.%I '
        || 'SET confidence_score = confidence_score * 100 '
        || 'WHERE confidence_score IS NOT NULL '
        || '  AND confidence_score BETWEEN 0 AND 1',
        tbl
      );
      GET DIAGNOSTICS converted = ROW_COUNT;

      EXECUTE format(
        'SELECT min(confidence_score), max(confidence_score), avg(confidence_score) '
        || 'FROM staging.%I',
        tbl
      )
      INTO min_v, max_v, avg_v;

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

      RAISE NOTICE 'AFTER staging.% | min=% | max=% | avg=% | converted_row_count=%',
        tbl, min_v, max_v, avg_v, converted;
      RAISE NOTICE 'staging.% confidence_score FINAL type: %', tbl, typ_after;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'FAILED staging.% (rolled back for this table): %', tbl, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Now run tools/data-pipeline/local-osm/09_create_review_views.sql to recreate views.';
END $$;

COMMIT;
