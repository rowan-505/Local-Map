-- =============================================================================
-- Local-only: staging + system diff confidence_score on 0–100 scale
-- =============================================================================
--
-- Aligns with Supabase production core and updated local OSM pipeline defaults.
-- Drops legacy CHECK constraints that capped confidence_score at 1; widens column
-- precision where needed; adds CHECK (0–100).
--
-- Safe to re-run: skips missing tables/columns; ignores duplicate constraints.
-- Apply after any one-off data normalization scripts if old rows still hold 0–1 fractions.
--
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  con record;
  staging_tables CONSTANT text[] := ARRAY[
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
  default_70_tables CONSTANT text[] := ARRAY[
    'staging_building_candidates',
    'staging_landuse_candidates',
    'staging_water_line_candidates',
    'staging_water_polygon_candidates'
  ];
BEGIN
  IF to_regclass('system.system_diff_items') IS NOT NULL THEN
    ALTER TABLE system.system_diff_items
      DROP CONSTRAINT IF EXISTS system_diff_items_confidence_score_chk;

    BEGIN
      ALTER TABLE system.system_diff_items
        ALTER COLUMN confidence_score TYPE numeric(6,2)
        USING confidence_score::numeric(6,2);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'system.system_diff_items: alter confidence_score type skipped: %', SQLERRM;
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'system'
        AND r.relname = 'system_diff_items'
        AND c.conname = 'system_diff_items_confidence_score_chk'
    ) THEN
      ALTER TABLE system.system_diff_items
        ADD CONSTRAINT system_diff_items_confidence_score_chk
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));
    END IF;
  END IF;

  FOREACH tbl IN ARRAY staging_tables
  LOOP
    CONTINUE WHEN to_regclass(format('staging.%I', tbl)) IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_schema = 'staging'
        AND col.table_name = tbl
        AND col.column_name = 'confidence_score'
    );

    FOR con IN
      SELECT c.conname AS conname,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'staging'
        AND r.relname = tbl
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%confidence_score%'
        AND (
          pg_get_constraintdef(c.oid) ILIKE '%<= (1)%'
          OR pg_get_constraintdef(c.oid) ILIKE '%<=(1)%'
        )
    LOOP
      EXECUTE format('ALTER TABLE staging.%I DROP CONSTRAINT %I', tbl, con.conname);
    END LOOP;

    BEGIN
      EXECUTE format(
        'ALTER TABLE staging.%I ALTER COLUMN confidence_score TYPE numeric(6,2) USING confidence_score::numeric(6,2)',
        tbl
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'staging.%: alter confidence_score type skipped: %', tbl, SQLERRM;
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'staging'
        AND r.relname = tbl
        AND c.conname = tbl || '_confidence_score_0_100_chk'
    ) THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE staging.%I ADD CONSTRAINT %I CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))',
          tbl,
          tbl || '_confidence_score_0_100_chk'
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE 'staging.%: add confidence_score 0–100 check skipped: %', tbl, SQLERRM;
      END;
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY default_70_tables
  LOOP
    CONTINUE WHEN to_regclass(format('staging.%I', tbl)) IS NULL;
    BEGIN
      EXECUTE format('ALTER TABLE staging.%I ALTER COLUMN confidence_score SET DEFAULT 70', tbl);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'staging.%: set default 70 skipped: %', tbl, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;
