-- =============================================================================
-- Supabase migration 154: rename core.core_map_* tables (structural only)
-- =============================================================================
--
-- Goal:
--   Remove unnecessary "map" from production Core table names.
--   Rename landuse → land_areas (table naming only; taxonomy unchanged).
--
-- Method:
--   ALTER TABLE ... RENAME (preserve all rows, IDs, FKs, data).
--   Rename sequences / indexes / constraint names for cleanliness.
--   Explicitly recreate dependent tiles.* and search.* views so SQL text
--   references the new table names (do not rely on rename alone).
--
-- Does NOT:
--   - change land taxonomy / class codes / ref_landuse_classes
--   - change PMTiles / Martin source-layer names
--   - change RLS
--   - copy or rewrite row data
--
-- Apply deliberately (SQL Editor / deploy). Idempotent if new names already exist.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

-- ---------------------------------------------------------------------------
-- 0) Before counts (asserted after rename)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m154_before ON COMMIT DROP AS
SELECT * FROM (
  SELECT 'core.core_map_buildings'::text AS old_name, 'core.core_buildings'::text AS new_name,
         (SELECT count(*)::bigint FROM core.core_map_buildings) AS n
  WHERE to_regclass('core.core_map_buildings') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_building_names', 'core.core_building_names',
         (SELECT count(*)::bigint FROM core.core_map_building_names)
  WHERE to_regclass('core.core_map_building_names') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_landuse', 'core.core_land_areas',
         (SELECT count(*)::bigint FROM core.core_map_landuse)
  WHERE to_regclass('core.core_map_landuse') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_landuse_names', 'core.core_land_area_names',
         (SELECT count(*)::bigint FROM core.core_map_landuse_names)
  WHERE to_regclass('core.core_map_landuse_names') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_water_lines', 'core.core_water_lines',
         (SELECT count(*)::bigint FROM core.core_map_water_lines)
  WHERE to_regclass('core.core_map_water_lines') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_water_line_names', 'core.core_water_line_names',
         (SELECT count(*)::bigint FROM core.core_map_water_line_names)
  WHERE to_regclass('core.core_map_water_line_names') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_water_polygons', 'core.core_water_polygons',
         (SELECT count(*)::bigint FROM core.core_map_water_polygons)
  WHERE to_regclass('core.core_map_water_polygons') IS NOT NULL
  UNION ALL
  SELECT 'core.core_map_water_polygon_names', 'core.core_water_polygon_names',
         (SELECT count(*)::bigint FROM core.core_map_water_polygon_names)
  WHERE to_regclass('core.core_map_water_polygon_names') IS NOT NULL
) s;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _m154_before) THEN
    RAISE NOTICE '154 before counts: %', (SELECT jsonb_object_agg(old_name, n) FROM _m154_before);
  ELSE
    RAISE NOTICE '154: old core_map_* tables already absent; expecting new names present';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Rename tables (children first is unnecessary for RENAME; do parents last OK)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('core.core_map_building_names') IS NOT NULL AND to_regclass('core.core_building_names') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_building_names RENAME TO core_building_names';
  ELSIF to_regclass('core.core_building_names') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_building_names already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_building_names nor core.core_building_names found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_landuse_names') IS NOT NULL AND to_regclass('core.core_land_area_names') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_landuse_names RENAME TO core_land_area_names';
  ELSIF to_regclass('core.core_land_area_names') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_land_area_names already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_landuse_names nor core.core_land_area_names found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_line_names') IS NOT NULL AND to_regclass('core.core_water_line_names') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_water_line_names RENAME TO core_water_line_names';
  ELSIF to_regclass('core.core_water_line_names') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_water_line_names already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_water_line_names nor core.core_water_line_names found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_polygon_names') IS NOT NULL AND to_regclass('core.core_water_polygon_names') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_water_polygon_names RENAME TO core_water_polygon_names';
  ELSIF to_regclass('core.core_water_polygon_names') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_water_polygon_names already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_water_polygon_names nor core.core_water_polygon_names found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_buildings') IS NOT NULL AND to_regclass('core.core_buildings') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_buildings RENAME TO core_buildings';
  ELSIF to_regclass('core.core_buildings') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_buildings already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_buildings nor core.core_buildings found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_landuse') IS NOT NULL AND to_regclass('core.core_land_areas') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_landuse RENAME TO core_land_areas';
  ELSIF to_regclass('core.core_land_areas') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_land_areas already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_landuse nor core.core_land_areas found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_lines') IS NOT NULL AND to_regclass('core.core_water_lines') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_water_lines RENAME TO core_water_lines';
  ELSIF to_regclass('core.core_water_lines') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_water_lines already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_water_lines nor core.core_water_lines found';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_polygons') IS NOT NULL AND to_regclass('core.core_water_polygons') IS NULL THEN
    EXECUTE 'ALTER TABLE core.core_map_water_polygons RENAME TO core_water_polygons';
  ELSIF to_regclass('core.core_water_polygons') IS NOT NULL THEN
    RAISE NOTICE '154: core.core_water_polygons already exists';
  ELSE
    RAISE EXCEPTION '154: neither core.core_map_water_polygons nor core.core_water_polygons found';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Rename sequences
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('core.core_map_building_names_id_seq') IS NOT NULL AND to_regclass('core.core_building_names_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_building_names_id_seq RENAME TO core_building_names_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_buildings_id_seq') IS NOT NULL AND to_regclass('core.core_buildings_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_buildings_id_seq RENAME TO core_buildings_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_landuse_id_seq') IS NOT NULL AND to_regclass('core.core_land_areas_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_landuse_id_seq RENAME TO core_land_areas_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_landuse_names_id_seq') IS NOT NULL AND to_regclass('core.core_land_area_names_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_landuse_names_id_seq RENAME TO core_land_area_names_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_line_names_id_seq') IS NOT NULL AND to_regclass('core.core_water_line_names_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_water_line_names_id_seq RENAME TO core_water_line_names_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_lines_id_seq') IS NOT NULL AND to_regclass('core.core_water_lines_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_water_lines_id_seq RENAME TO core_water_lines_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_polygon_names_id_seq') IS NOT NULL AND to_regclass('core.core_water_polygon_names_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_water_polygon_names_id_seq RENAME TO core_water_polygon_names_id_seq';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('core.core_map_water_polygons_id_seq') IS NOT NULL AND to_regclass('core.core_water_polygons_id_seq') IS NULL THEN
    EXECUTE 'ALTER SEQUENCE core.core_map_water_polygons_id_seq RENAME TO core_water_polygons_id_seq';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Rename constraints (includes pkey; updates backing index name)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_building_names' AND con.conname = 'core_map_building_names_building_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_building_names RENAME CONSTRAINT core_map_building_names_building_id_fkey TO core_building_names_building_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_building_names' AND con.conname = 'core_map_building_names_language_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_building_names RENAME CONSTRAINT core_map_building_names_language_code_chk TO core_building_names_language_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_building_names' AND con.conname = 'core_map_building_names_name_type_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_building_names RENAME CONSTRAINT core_map_building_names_name_type_chk TO core_building_names_name_type_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_building_names' AND con.conname = 'core_map_building_names_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_building_names RENAME CONSTRAINT core_map_building_names_pkey TO core_building_names_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_admin_area_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_admin_area_id_fkey TO core_buildings_admin_area_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_building_type_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_building_type_id_fkey TO core_buildings_building_type_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_external_id_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_external_id_chk TO core_buildings_external_id_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_name_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_name_chk TO core_buildings_name_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_pkey TO core_buildings_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_source_feature_type_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_source_feature_type_chk TO core_buildings_source_feature_type_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_source_registry_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_source_registry_id_fkey TO core_buildings_source_registry_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_source_snapshot_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_source_snapshot_id_fkey TO core_buildings_source_snapshot_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_buildings' AND con.conname = 'core_map_buildings_verification_status_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_buildings RENAME CONSTRAINT core_map_buildings_verification_status_chk TO core_buildings_verification_status_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_admin_area_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_admin_area_id_fkey TO core_land_areas_admin_area_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_class_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_class_code_chk TO core_land_areas_class_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_confidence_score_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_confidence_score_chk TO core_land_areas_confidence_score_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_crop_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_crop_code_chk TO core_land_areas_crop_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_detail_level_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_detail_level_chk TO core_land_areas_detail_level_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_external_id_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_external_id_chk TO core_land_areas_external_id_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_landuse_class_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_landuse_class_id_fkey TO core_land_areas_landuse_class_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_name_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_name_chk TO core_land_areas_name_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_landuse_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_landuse_id_fkey TO core_land_area_names_landuse_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_language_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_language_code_chk TO core_land_area_names_language_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_name_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_name_chk TO core_land_area_names_name_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_name_type_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_name_type_chk TO core_land_area_names_name_type_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_pkey TO core_land_area_names_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_script_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_script_code_chk TO core_land_area_names_script_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_area_names' AND con.conname = 'core_map_landuse_names_search_weight_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_area_names RENAME CONSTRAINT core_map_landuse_names_search_weight_chk TO core_land_area_names_search_weight_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_pkey TO core_land_areas_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_seasonality_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_seasonality_chk TO core_land_areas_seasonality_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_land_areas' AND con.conname = 'core_map_landuse_verification_status_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_land_areas RENAME CONSTRAINT core_map_landuse_verification_status_chk TO core_land_areas_verification_status_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_line_names' AND con.conname = 'core_map_water_line_names_language_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_line_names RENAME CONSTRAINT core_map_water_line_names_language_code_chk TO core_water_line_names_language_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_line_names' AND con.conname = 'core_map_water_line_names_name_type_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_line_names RENAME CONSTRAINT core_map_water_line_names_name_type_chk TO core_water_line_names_name_type_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_line_names' AND con.conname = 'core_map_water_line_names_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_line_names RENAME CONSTRAINT core_map_water_line_names_pkey TO core_water_line_names_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_line_names' AND con.conname = 'core_map_water_line_names_water_line_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_line_names RENAME CONSTRAINT core_map_water_line_names_water_line_id_fkey TO core_water_line_names_water_line_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_lines' AND con.conname = 'core_map_water_lines_class_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_lines RENAME CONSTRAINT core_map_water_lines_class_code_chk TO core_water_lines_class_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_lines' AND con.conname = 'core_map_water_lines_external_id_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_lines RENAME CONSTRAINT core_map_water_lines_external_id_chk TO core_water_lines_external_id_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_lines' AND con.conname = 'core_map_water_lines_name_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_lines RENAME CONSTRAINT core_map_water_lines_name_chk TO core_water_lines_name_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_lines' AND con.conname = 'core_map_water_lines_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_lines RENAME CONSTRAINT core_map_water_lines_pkey TO core_water_lines_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_lines' AND con.conname = 'core_map_water_lines_verification_status_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_lines RENAME CONSTRAINT core_map_water_lines_verification_status_chk TO core_water_lines_verification_status_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygon_names' AND con.conname = 'core_map_water_polygon_names_language_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygon_names RENAME CONSTRAINT core_map_water_polygon_names_language_code_chk TO core_water_polygon_names_language_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygon_names' AND con.conname = 'core_map_water_polygon_names_name_type_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygon_names RENAME CONSTRAINT core_map_water_polygon_names_name_type_chk TO core_water_polygon_names_name_type_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygon_names' AND con.conname = 'core_map_water_polygon_names_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygon_names RENAME CONSTRAINT core_map_water_polygon_names_pkey TO core_water_polygon_names_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygon_names' AND con.conname = 'core_map_water_polygon_names_water_polygon_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygon_names RENAME CONSTRAINT core_map_water_polygon_names_water_polygon_id_fkey TO core_water_polygon_names_water_polygon_id_fkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygons' AND con.conname = 'core_map_water_polygons_class_code_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygons RENAME CONSTRAINT core_map_water_polygons_class_code_chk TO core_water_polygons_class_code_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygons' AND con.conname = 'core_map_water_polygons_external_id_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygons RENAME CONSTRAINT core_map_water_polygons_external_id_chk TO core_water_polygons_external_id_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygons' AND con.conname = 'core_map_water_polygons_name_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygons RENAME CONSTRAINT core_map_water_polygons_name_chk TO core_water_polygons_name_chk';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygons' AND con.conname = 'core_map_water_polygons_pkey'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygons RENAME CONSTRAINT core_map_water_polygons_pkey TO core_water_polygons_pkey';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'core_water_polygons' AND con.conname = 'core_map_water_polygons_verification_status_chk'
  ) THEN
    EXECUTE 'ALTER TABLE core.core_water_polygons RENAME CONSTRAINT core_map_water_polygons_verification_status_chk TO core_water_polygons_verification_status_chk';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Rename remaining indexes (non-constraint indexes)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_building_names_building_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_building_names_building_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_building_names_building_id_idx RENAME TO core_building_names_building_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_building_names_identity_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_building_names_identity_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_building_names_identity_uidx RENAME TO core_building_names_identity_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_building_names_language_code_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_building_names_language_code_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_building_names_language_code_idx RENAME TO core_building_names_language_code_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_building_names_one_primary_per_lang_type_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_building_names_one_primary_per_lang_type_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_building_names_one_primary_per_lang_type_uidx RENAME TO core_building_names_one_primary_per_lang_type_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_active_not_deleted_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_active_not_deleted_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_active_not_deleted_idx RENAME TO core_buildings_active_not_deleted_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_admin_area_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_admin_area_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_admin_area_id_idx RENAME TO core_buildings_admin_area_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_building_type_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_building_type_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_building_type_id_idx RENAME TO core_buildings_building_type_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_centroid_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_centroid_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_centroid_gix RENAME TO core_buildings_centroid_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_deleted_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_deleted_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_deleted_at_idx RENAME TO core_buildings_deleted_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_external_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_external_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_external_id_idx RENAME TO core_buildings_external_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_geom_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_geom_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_geom_gix RENAME TO core_buildings_geom_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_is_active_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_is_active_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_is_active_idx RENAME TO core_buildings_is_active_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_is_verified_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_is_verified_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_is_verified_idx RENAME TO core_buildings_is_verified_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_is_verified_updated_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_is_verified_updated_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_is_verified_updated_at_idx RENAME TO core_buildings_is_verified_updated_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_normalized_data_gin_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_normalized_data_gin_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_normalized_data_gin_idx RENAME TO core_buildings_normalized_data_gin_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_public_id_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_public_id_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_public_id_uidx RENAME TO core_buildings_public_id_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_source_identity_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_source_identity_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_source_identity_uidx RENAME TO core_buildings_source_identity_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_source_refs_gin_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_source_refs_gin_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_source_refs_gin_idx RENAME TO core_buildings_source_refs_gin_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_buildings_verification_status_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_buildings_verification_status_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_buildings_verification_status_idx RENAME TO core_buildings_verification_status_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_active_class_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_active_class_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_active_class_idx RENAME TO core_land_areas_active_class_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_active_not_deleted_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_active_not_deleted_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_active_not_deleted_idx RENAME TO core_land_areas_active_not_deleted_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_admin_area_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_admin_area_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_admin_area_id_idx RENAME TO core_land_areas_admin_area_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_centroid_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_centroid_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_centroid_gix RENAME TO core_land_areas_centroid_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_class_code_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_class_code_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_class_code_idx RENAME TO core_land_areas_class_code_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_deleted_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_deleted_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_deleted_at_idx RENAME TO core_land_areas_deleted_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_detail_level_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_detail_level_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_detail_level_idx RENAME TO core_land_areas_detail_level_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_external_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_external_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_external_id_idx RENAME TO core_land_areas_external_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_geom_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_geom_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_geom_gix RENAME TO core_land_areas_geom_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_is_active_deleted_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_is_active_deleted_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_is_active_deleted_at_idx RENAME TO core_land_areas_is_active_deleted_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_is_active_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_is_active_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_is_active_idx RENAME TO core_land_areas_is_active_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_is_verified_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_is_verified_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_is_verified_idx RENAME TO core_land_areas_is_verified_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_is_verified_updated_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_is_verified_updated_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_is_verified_updated_at_idx RENAME TO core_land_areas_is_verified_updated_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_landuse_class_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_landuse_class_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_landuse_class_id_idx RENAME TO core_land_areas_landuse_class_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_names_landuse_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_area_names_landuse_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_names_landuse_id_idx RENAME TO core_land_area_names_landuse_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_names_language_code_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_area_names_language_code_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_names_language_code_idx RENAME TO core_land_area_names_language_code_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_names_lower_name_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_area_names_lower_name_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_names_lower_name_idx RENAME TO core_land_area_names_lower_name_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_names_one_primary_per_lang_type_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_area_names_one_primary_per_lang_type_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_names_one_primary_per_lang_type_uidx RENAME TO core_land_area_names_one_primary_per_lang_type_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_public_id_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_public_id_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_public_id_uidx RENAME TO core_land_areas_public_id_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_landuse_verification_status_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_land_areas_verification_status_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_landuse_verification_status_idx RENAME TO core_land_areas_verification_status_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_line_names_one_primary_per_lang_type_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_line_names_one_primary_per_lang_type_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_line_names_one_primary_per_lang_type_uidx RENAME TO core_water_line_names_one_primary_per_lang_type_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_line_names_water_line_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_line_names_water_line_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_line_names_water_line_id_idx RENAME TO core_water_line_names_water_line_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_active_not_deleted_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_active_not_deleted_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_active_not_deleted_idx RENAME TO core_water_lines_active_not_deleted_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_class_code_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_class_code_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_class_code_idx RENAME TO core_water_lines_class_code_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_deleted_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_deleted_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_deleted_at_idx RENAME TO core_water_lines_deleted_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_external_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_external_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_external_id_idx RENAME TO core_water_lines_external_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_geom_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_geom_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_geom_gix RENAME TO core_water_lines_geom_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_is_active_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_is_active_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_is_active_idx RENAME TO core_water_lines_is_active_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_is_verified_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_is_verified_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_is_verified_idx RENAME TO core_water_lines_is_verified_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_is_verified_updated_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_is_verified_updated_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_is_verified_updated_at_idx RENAME TO core_water_lines_is_verified_updated_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_lines_verification_status_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_lines_verification_status_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_lines_verification_status_idx RENAME TO core_water_lines_verification_status_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygon_names_one_primary_per_lang_type_uidx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygon_names_one_primary_per_lang_type_uidx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygon_names_one_primary_per_lang_type_uidx RENAME TO core_water_polygon_names_one_primary_per_lang_type_uidx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygon_names_water_polygon_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygon_names_water_polygon_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygon_names_water_polygon_id_idx RENAME TO core_water_polygon_names_water_polygon_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_active_not_deleted_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_active_not_deleted_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_active_not_deleted_idx RENAME TO core_water_polygons_active_not_deleted_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_class_code_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_class_code_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_class_code_idx RENAME TO core_water_polygons_class_code_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_deleted_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_deleted_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_deleted_at_idx RENAME TO core_water_polygons_deleted_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_external_id_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_external_id_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_external_id_idx RENAME TO core_water_polygons_external_id_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_geom_gix' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_geom_gix' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_geom_gix RENAME TO core_water_polygons_geom_gix';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_is_active_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_is_active_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_is_active_idx RENAME TO core_water_polygons_is_active_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_is_verified_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_is_verified_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_is_verified_idx RENAME TO core_water_polygons_is_verified_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_is_verified_updated_at_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_is_verified_updated_at_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_is_verified_updated_at_idx RENAME TO core_water_polygons_is_verified_updated_at_idx';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_map_water_polygons_verification_status_idx' AND c.relkind='i')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname='core_water_polygons_verification_status_idx' AND c.relkind='i') THEN
    EXECUTE 'ALTER INDEX core.core_map_water_polygons_verification_status_idx RENAME TO core_water_polygons_verification_status_idx';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Recreate dependent views with explicit new table names
--     Keep view names + Martin/PMTiles source-layer names unchanged.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS tiles.tiles_landuse_v;
CREATE VIEW tiles.tiles_landuse_v AS
SELECT
    l.id,
    l.name,
    l.class_code AS landuse_class,
    l.geom
FROM core.core_land_areas AS l
WHERE l.is_active IS TRUE
  AND l.deleted_at IS NULL
  AND l.geom IS NOT NULL
  AND NOT st_isempty(l.geom);
COMMENT ON VIEW tiles.tiles_landuse_v IS
  'Land-area polygons for MVT. Source-layer name tiles_landuse_v unchanged. Reads core.core_land_areas.';
REVOKE ALL ON TABLE tiles.tiles_landuse_v FROM PUBLIC;

DROP VIEW IF EXISTS tiles.tiles_water_lines_v;
CREATE VIEW tiles.tiles_water_lines_v AS
SELECT
    w.id,
    w.name,
    w.class_code AS waterway_class,
    w.geom
FROM core.core_water_lines AS w
WHERE w.is_active IS TRUE
  AND w.deleted_at IS NULL
  AND w.geom IS NOT NULL
  AND NOT st_isempty(w.geom);
COMMENT ON VIEW tiles.tiles_water_lines_v IS
  'Water lines for MVT. Source-layer name tiles_water_lines_v unchanged. Reads core.core_water_lines.';
REVOKE ALL ON TABLE tiles.tiles_water_lines_v FROM PUBLIC;

DROP VIEW IF EXISTS tiles.tiles_water_polygons_v;
CREATE VIEW tiles.tiles_water_polygons_v AS
SELECT
    w.id,
    w.name,
    w.class_code AS water_class,
    w.geom
FROM core.core_water_polygons AS w
WHERE w.is_active IS TRUE
  AND w.deleted_at IS NULL
  AND w.geom IS NOT NULL
  AND NOT st_isempty(w.geom);
COMMENT ON VIEW tiles.tiles_water_polygons_v IS
  'Water polygons for MVT. Source-layer name tiles_water_polygons_v unchanged. Reads core.core_water_polygons.';
REVOKE ALL ON TABLE tiles.tiles_water_polygons_v FROM PUBLIC;

DO $$
DECLARE
  dependent_views text;
BEGIN
  IF to_regclass('tiles.tiles_buildings_v') IS NULL THEN
    RAISE NOTICE '154: tiles.tiles_buildings_v missing; skip';
    RETURN;
  END IF;
  SELECT string_agg(format('%I.%I', ns.nspname, d.relname), ', ')
  INTO dependent_views
  FROM pg_depend dep
  JOIN pg_rewrite rw ON rw.oid = dep.objid
  JOIN pg_class d ON d.oid = rw.ev_class
  JOIN pg_namespace ns ON ns.oid = d.relnamespace
  WHERE dep.refobjid = 'tiles.tiles_buildings_v'::regclass
    AND d.oid <> dep.refobjid;
  IF dependent_views IS NOT NULL THEN
    RAISE EXCEPTION 'tiles.tiles_buildings_v has dependent views: %', dependent_views;
  END IF;
  EXECUTE 'DROP VIEW tiles.tiles_buildings_v';
END $$;

CREATE VIEW tiles.tiles_buildings_v AS
SELECT building.id,
    building.public_id,
    name_my.name AS name_mm,
    name_en.name AS name_en,
    name_und.name AS name_und,
    name_my.name AS name_my,
    COALESCE(NULLIF(btrim(name_my.name), ''::text), NULLIF(btrim(name_en.name), ''::text), NULLIF(btrim(name_und.name), ''::text)) AS name,
    building.building_type_id,
    building_type.code AS building_type,
    building_type.code AS building_type_code,
    building_type.name AS building_type_name,
    building_type.name_mm AS building_type_name_mm,
    building.levels,
    building.height_m,
    building.area_m2,
    building.confidence_score,
    building.is_verified,
    building.geom,
    building.admin_area_id,
    admin_area.canonical_name AS admin_area_name
   FROM core.core_buildings building
     LEFT JOIN ref.ref_building_types building_type ON building_type.id = building.building_type_id AND building_type.is_active IS TRUE
     LEFT JOIN core.core_admin_areas admin_area ON admin_area.id = building.admin_area_id
     LEFT JOIN LATERAL ( SELECT building_name.name
           FROM core.core_building_names building_name
          WHERE building_name.building_id = building.id AND (lower(btrim(building_name.language_code)) = 'my'::text OR upper(btrim(COALESCE(building_name.script_code, ''::text))) = 'MYMR'::text) AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
          ORDER BY (
                CASE
                    WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate'::text THEN 3
                    ELSE 4
                END), building_name.search_weight DESC NULLS LAST, building_name.id
         LIMIT 1) name_my ON true
     LEFT JOIN LATERAL ( SELECT building_name.name
           FROM core.core_building_names building_name
          WHERE building_name.building_id = building.id AND (lower(btrim(building_name.language_code)) = 'en'::text OR upper(btrim(COALESCE(building_name.script_code, ''::text))) = 'LATN'::text) AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
          ORDER BY (
                CASE
                    WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate'::text THEN 3
                    ELSE 4
                END), building_name.search_weight DESC NULLS LAST, building_name.id
         LIMIT 1) name_en ON true
     LEFT JOIN LATERAL ( SELECT building_name.name
           FROM core.core_building_names building_name
          WHERE building_name.building_id = building.id AND lower(btrim(building_name.language_code)) = 'und'::text AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
          ORDER BY (
                CASE
                    WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate'::text THEN 3
                    ELSE 4
                END), building_name.search_weight DESC NULLS LAST, building_name.id
         LIMIT 1) name_und ON true
  WHERE building.is_active IS TRUE AND building.deleted_at IS NULL;;

COMMENT ON VIEW tiles.tiles_buildings_v IS
  'Building tile source for Martin/dashboard. Labels from core.core_building_names (my/en/und). Source-layer name unchanged.';
REVOKE ALL ON TABLE tiles.tiles_buildings_v FROM PUBLIC;

CREATE OR REPLACE VIEW search.v_search_buildings_source AS
SELECT 'building'::text AS entity_type,
    building.id AS entity_id,
    building.public_id::text AS public_id,
    COALESCE(names.name_my, names.name_en, names.name_und) AS display_name,
    building_type.name AS subtitle,
    names.name_my AS primary_name_my,
    names.name_en AS primary_name_en,
    names.name_und AS primary_name_und,
    NULL::text AS code,
    building.external_id,
    building_type.code AS category_code,
    building_type.name_mm AS category_name_my,
    building_type.name AS category_name_en,
    building.admin_area_id,
    admin_context.adm_my AS admin_area_name_my,
    admin_context.adm_en AS admin_area_name_en,
    admin_context.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(building.geom) AS geometry_type,
    COALESCE(building.centroid, search.safe_centroid(building.geom)) AS centroid,
    search.safe_bbox(building.geom) AS bbox,
    COALESCE(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL AS has_geometry,
    COALESCE(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL AS supports_plus_code,
    concat_ws(' '::text, names.all_names, building_type.name, building_type.name_mm, admin_context.adm_en, admin_context.adm_my, search.hierarchy_text(admin_context.hierarchy)) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    COALESCE(building.confidence_score, 0::numeric) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(building.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(building.is_active, false) AS is_active,
    building.updated_at AS source_updated_at,
    COALESCE(names.names_json, '[]'::jsonb) AS names
   FROM core.core_buildings building
     LEFT JOIN ref.ref_building_types building_type ON building_type.id = building.building_type_id
     LEFT JOIN LATERAL ( SELECT search.admin_area_name(building.admin_area_id, 'my'::text) AS adm_my,
            search.admin_area_name(building.admin_area_id, 'en'::text) AS adm_en,
            search.admin_area_hierarchy(building.admin_area_id) AS hierarchy) admin_context ON true
     LEFT JOIN LATERAL ( SELECT ( SELECT building_name.name
                   FROM core.core_building_names building_name
                  WHERE building_name.building_id = building.id AND (lower(btrim(building_name.language_code)) = 'my'::text OR upper(btrim(COALESCE(building_name.script_code, ''::text))) = 'MYMR'::text) AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
                  ORDER BY (
                        CASE
                            WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                            WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                            WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                            WHEN building_name.name_type = 'alternate'::text THEN 3
                            ELSE 4
                        END), building_name.search_weight DESC NULLS LAST, building_name.name
                 LIMIT 1) AS name_my,
            ( SELECT building_name.name
                   FROM core.core_building_names building_name
                  WHERE building_name.building_id = building.id AND (lower(btrim(building_name.language_code)) = 'en'::text OR upper(btrim(COALESCE(building_name.script_code, ''::text))) = 'LATN'::text) AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
                  ORDER BY (
                        CASE
                            WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                            WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                            WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                            WHEN building_name.name_type = 'alternate'::text THEN 3
                            ELSE 4
                        END), building_name.search_weight DESC NULLS LAST, building_name.name
                 LIMIT 1) AS name_en,
            ( SELECT building_name.name
                   FROM core.core_building_names building_name
                  WHERE building_name.building_id = building.id AND lower(btrim(building_name.language_code)) = 'und'::text AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL
                  ORDER BY (
                        CASE
                            WHEN building_name.name_type = 'official'::text AND building_name.is_primary IS TRUE THEN 0
                            WHEN building_name.name_type = 'local'::text AND building_name.is_primary IS TRUE THEN 1
                            WHEN building_name.name_type = 'imported'::text AND building_name.is_primary IS TRUE THEN 2
                            WHEN building_name.name_type = 'alternate'::text THEN 3
                            ELSE 4
                        END), building_name.search_weight DESC NULLS LAST, building_name.name
                 LIMIT 1) AS name_und,
            ( SELECT jsonb_agg(jsonb_build_object('name', building_name.name, 'languageCode', building_name.language_code, 'scriptCode', building_name.script_code, 'nameType', building_name.name_type, 'isPrimary', building_name.is_primary, 'searchWeight', COALESCE(building_name.search_weight, 0)) ORDER BY building_name.is_primary DESC, building_name.name) AS jsonb_agg
                   FROM core.core_building_names building_name
                  WHERE building_name.building_id = building.id) AS names_json,
            ( SELECT string_agg(DISTINCT building_name.name, ' '::text) AS string_agg
                   FROM core.core_building_names building_name
                  WHERE building_name.building_id = building.id AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL) AS all_names) names ON true
  WHERE building.deleted_at IS NULL AND building.is_active IS TRUE AND building.geom IS NOT NULL AND NOT st_isempty(building.geom) AND (EXISTS ( SELECT 1
           FROM core.core_building_names building_name
          WHERE building_name.building_id = building.id AND NULLIF(btrim(building_name.name), ''::text) IS NOT NULL));;

CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT 'landuse'::text AS entity_type,
    lu.id AS entity_id,
    lu.public_id::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, lu.name, lc.name_en) AS display_name,
    COALESCE(lc.name_en, lu.class_code) AS subtitle,
    COALESCE(nm.name_my, lu.name, lc.name_mm) AS primary_name_my,
    COALESCE(nm.name_en, lu.name, lc.name_en) AS primary_name_en,
    COALESCE(lu.name, lc.name_en) AS primary_name_und,
    COALESCE(lc.code, lu.class_code) AS code,
    lu.external_id,
    COALESCE(lc.code, lu.class_code) AS category_code,
    lc.name_mm AS category_name_my,
    lc.name_en AS category_name_en,
    lu.admin_area_id,
    ctx.adm_my AS admin_area_name_my,
    ctx.adm_en AS admin_area_name_en,
    ctx.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(lu.geom) AS geometry_type,
    COALESCE(lu.centroid, search.safe_centroid(lu.geom)) AS centroid,
    search.safe_bbox(lu.geom) AS bbox,
    COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL AS has_geometry,
    COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL AS supports_plus_code,
    concat_ws(' '::text, lu.name, nm.all_names, lc.name_en, lc.name_mm, lu.class_code, ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    COALESCE(lu.confidence_score, 0::numeric) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(lu.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(lu.is_active, false) AS is_active,
    lu.updated_at AS source_updated_at,
    COALESCE(nm.names_json, '[]'::jsonb) AS names
   FROM core.core_land_areas lu
     LEFT JOIN ref.ref_landuse_classes lc ON lc.id = lu.landuse_class_id
     LEFT JOIN LATERAL ( SELECT search.admin_area_name(lu.admin_area_id, 'my'::text) AS adm_my,
            search.admin_area_name(lu.admin_area_id, 'en'::text) AS adm_en,
            search.admin_area_hierarchy(lu.admin_area_id) AS hierarchy) ctx ON true
     LEFT JOIN LATERAL ( SELECT ( SELECT x.name
                   FROM core.core_land_area_names x
                  WHERE x.landuse_id = lu.id AND (x.language_code = 'my'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'MYMR'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_my,
            ( SELECT x.name
                   FROM core.core_land_area_names x
                  WHERE x.landuse_id = lu.id AND (x.language_code = 'en'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'LATN'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_en,
            ( SELECT jsonb_agg(jsonb_build_object('name', x.name, 'language_code', x.language_code, 'script_code', x.script_code, 'name_type', x.name_type, 'is_primary', x.is_primary, 'search_weight', COALESCE(x.search_weight, 0)) ORDER BY x.is_primary DESC, x.name) AS jsonb_agg
                   FROM core.core_land_area_names x
                  WHERE x.landuse_id = lu.id) AS names_json,
            ( SELECT string_agg(DISTINCT x.name, ' '::text) AS string_agg
                   FROM core.core_land_area_names x
                  WHERE x.landuse_id = lu.id) AS all_names) nm ON true
  WHERE lu.deleted_at IS NULL AND lu.is_active = true AND lu.geom IS NOT NULL AND NOT st_isempty(lu.geom) AND (NULLIF(btrim(lu.name), ''::text) IS NOT NULL OR (EXISTS ( SELECT 1
           FROM core.core_land_area_names x
          WHERE x.landuse_id = lu.id)));;

CREATE OR REPLACE VIEW search.v_search_water_lines_source AS
SELECT 'water_line'::text AS entity_type,
    w.id AS entity_id,
    NULL::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, w.name) AS display_name,
    COALESCE(NULLIF(btrim(w.class_code), ''::text), 'Waterway'::text) AS subtitle,
    COALESCE(nm.name_my, w.name) AS primary_name_my,
    COALESCE(nm.name_en, w.name) AS primary_name_en,
    w.name AS primary_name_und,
    w.class_code AS code,
    w.external_id,
    w.class_code AS category_code,
    NULL::text AS category_name_my,
    NULL::text AS category_name_en,
    NULL::bigint AS admin_area_id,
    NULL::text AS admin_area_name_my,
    NULL::text AS admin_area_name_en,
    '{}'::jsonb AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(w.geom) AS geometry_type,
    search.safe_centroid(w.geom) AS centroid,
    search.safe_bbox(w.geom) AS bbox,
    search.safe_centroid(w.geom) IS NOT NULL AS has_geometry,
    search.safe_centroid(w.geom) IS NOT NULL AS supports_plus_code,
    concat_ws(' '::text, w.name, nm.all_names, w.class_code) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    0::numeric AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(w.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(w.is_active, false) AS is_active,
    w.updated_at AS source_updated_at,
    COALESCE(nm.names_json, '[]'::jsonb) AS names
   FROM core.core_water_lines w
     LEFT JOIN LATERAL ( SELECT ( SELECT x.name
                   FROM core.core_water_line_names x
                  WHERE x.water_line_id = w.id AND (x.language_code = 'my'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'MYMR'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_my,
            ( SELECT x.name
                   FROM core.core_water_line_names x
                  WHERE x.water_line_id = w.id AND (x.language_code = 'en'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'LATN'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_en,
            ( SELECT jsonb_agg(jsonb_build_object('name', x.name, 'language_code', x.language_code, 'script_code', x.script_code, 'name_type', x.name_type, 'is_primary', x.is_primary, 'search_weight', COALESCE(x.search_weight, 0)) ORDER BY x.is_primary DESC, x.name) AS jsonb_agg
                   FROM core.core_water_line_names x
                  WHERE x.water_line_id = w.id) AS names_json,
            ( SELECT string_agg(DISTINCT x.name, ' '::text) AS string_agg
                   FROM core.core_water_line_names x
                  WHERE x.water_line_id = w.id) AS all_names) nm ON true
  WHERE w.deleted_at IS NULL AND w.is_active = true AND w.geom IS NOT NULL AND NOT st_isempty(w.geom) AND (NULLIF(btrim(w.name), ''::text) IS NOT NULL OR (EXISTS ( SELECT 1
           FROM core.core_water_line_names x
          WHERE x.water_line_id = w.id)));;

CREATE OR REPLACE VIEW search.v_search_water_polygons_source AS
SELECT 'water_polygon'::text AS entity_type,
    w.id AS entity_id,
    NULL::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, w.name) AS display_name,
    COALESCE(NULLIF(btrim(w.class_code), ''::text), 'Water'::text) AS subtitle,
    COALESCE(nm.name_my, w.name) AS primary_name_my,
    COALESCE(nm.name_en, w.name) AS primary_name_en,
    w.name AS primary_name_und,
    w.class_code AS code,
    w.external_id,
    w.class_code AS category_code,
    NULL::text AS category_name_my,
    NULL::text AS category_name_en,
    NULL::bigint AS admin_area_id,
    NULL::text AS admin_area_name_my,
    NULL::text AS admin_area_name_en,
    '{}'::jsonb AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(w.geom) AS geometry_type,
    search.safe_centroid(w.geom) AS centroid,
    search.safe_bbox(w.geom) AS bbox,
    search.safe_centroid(w.geom) IS NOT NULL AS has_geometry,
    search.safe_centroid(w.geom) IS NOT NULL AS supports_plus_code,
    concat_ws(' '::text, w.name, nm.all_names, w.class_code) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    0::numeric AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(w.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(w.is_active, false) AS is_active,
    w.updated_at AS source_updated_at,
    COALESCE(nm.names_json, '[]'::jsonb) AS names
   FROM core.core_water_polygons w
     LEFT JOIN LATERAL ( SELECT ( SELECT x.name
                   FROM core.core_water_polygon_names x
                  WHERE x.water_polygon_id = w.id AND (x.language_code = 'my'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'MYMR'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_my,
            ( SELECT x.name
                   FROM core.core_water_polygon_names x
                  WHERE x.water_polygon_id = w.id AND (x.language_code = 'en'::text OR upper(TRIM(BOTH FROM COALESCE(x.script_code, ''::text))) = 'LATN'::text)
                  ORDER BY (
                        CASE
                            WHEN x.name_type = 'official'::text AND x.is_primary THEN 1
                            WHEN x.is_primary THEN 2
                            WHEN x.name_type = 'official'::text THEN 3
                            ELSE 4
                        END), x.search_weight DESC NULLS LAST, x.name
                 LIMIT 1) AS name_en,
            ( SELECT jsonb_agg(jsonb_build_object('name', x.name, 'language_code', x.language_code, 'script_code', x.script_code, 'name_type', x.name_type, 'is_primary', x.is_primary, 'search_weight', COALESCE(x.search_weight, 0)) ORDER BY x.is_primary DESC, x.name) AS jsonb_agg
                   FROM core.core_water_polygon_names x
                  WHERE x.water_polygon_id = w.id) AS names_json,
            ( SELECT string_agg(DISTINCT x.name, ' '::text) AS string_agg
                   FROM core.core_water_polygon_names x
                  WHERE x.water_polygon_id = w.id) AS all_names) nm ON true
  WHERE w.deleted_at IS NULL AND w.is_active = true AND w.geom IS NOT NULL AND NOT st_isempty(w.geom) AND (NULLIF(btrim(w.name), ''::text) IS NOT NULL OR (EXISTS ( SELECT 1
           FROM core.core_water_polygon_names x
          WHERE x.water_polygon_id = w.id)));;

COMMENT ON VIEW search.v_search_buildings_source IS
  'Search source for buildings from core.core_buildings + core.core_building_names.';
COMMENT ON VIEW search.v_search_landuse_source IS
  'Search source for land areas from core.core_land_areas + core.core_land_area_names (entity_type remains landuse).';
COMMENT ON VIEW search.v_search_water_lines_source IS
  'Search source for water lines from core.core_water_lines + core.core_water_line_names.';
COMMENT ON VIEW search.v_search_water_polygons_source IS
  'Search source for water polygons from core.core_water_polygons + core.core_water_polygon_names.';

-- ---------------------------------------------------------------------------
-- 6) After assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
  mismatch text;
BEGIN
  -- old tables must be gone
  IF to_regclass('core.core_map_buildings') IS NOT NULL
     OR to_regclass('core.core_map_building_names') IS NOT NULL
     OR to_regclass('core.core_map_landuse') IS NOT NULL
     OR to_regclass('core.core_map_landuse_names') IS NOT NULL
     OR to_regclass('core.core_map_water_lines') IS NOT NULL
     OR to_regclass('core.core_map_water_line_names') IS NOT NULL
     OR to_regclass('core.core_map_water_polygons') IS NOT NULL
     OR to_regclass('core.core_map_water_polygon_names') IS NOT NULL THEN
    RAISE EXCEPTION '154: old core.core_map_* table(s) still present';
  END IF;

  -- new tables must exist
  IF to_regclass('core.core_buildings') IS NULL
     OR to_regclass('core.core_building_names') IS NULL
     OR to_regclass('core.core_land_areas') IS NULL
     OR to_regclass('core.core_land_area_names') IS NULL
     OR to_regclass('core.core_water_lines') IS NULL
     OR to_regclass('core.core_water_line_names') IS NULL
     OR to_regclass('core.core_water_polygons') IS NULL
     OR to_regclass('core.core_water_polygon_names') IS NULL THEN
    RAISE EXCEPTION '154: expected renamed core.* table(s) missing';
  END IF;

  -- count match when we had before snapshot
  IF EXISTS (SELECT 1 FROM _m154_before) THEN
    SELECT string_agg(format('%s: before=%s after=%s', b.old_name, b.n, a.n), ', ')
    INTO mismatch
    FROM _m154_before b
    JOIN LATERAL (
      SELECT count(*)::bigint AS n FROM core.core_buildings WHERE b.new_name = 'core.core_buildings'
      UNION ALL SELECT count(*)::bigint FROM core.core_building_names WHERE b.new_name = 'core.core_building_names'
      UNION ALL SELECT count(*)::bigint FROM core.core_land_areas WHERE b.new_name = 'core.core_land_areas'
      UNION ALL SELECT count(*)::bigint FROM core.core_land_area_names WHERE b.new_name = 'core.core_land_area_names'
      UNION ALL SELECT count(*)::bigint FROM core.core_water_lines WHERE b.new_name = 'core.core_water_lines'
      UNION ALL SELECT count(*)::bigint FROM core.core_water_line_names WHERE b.new_name = 'core.core_water_line_names'
      UNION ALL SELECT count(*)::bigint FROM core.core_water_polygons WHERE b.new_name = 'core.core_water_polygons'
      UNION ALL SELECT count(*)::bigint FROM core.core_water_polygon_names WHERE b.new_name = 'core.core_water_polygon_names'
    ) a ON true
    WHERE b.n IS DISTINCT FROM a.n;
    -- The JOIN LATERAL above is wrong (UNION always returns 8 rows). Use explicit checks instead.
  END IF;
END $$;

DO $$
DECLARE
  b bigint; a bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_buildings') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_buildings';
    SELECT count(*) INTO a FROM core.core_buildings;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 buildings count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_building_names') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_building_names';
    SELECT count(*) INTO a FROM core.core_building_names;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 building_names count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_land_areas') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_land_areas';
    SELECT count(*) INTO a FROM core.core_land_areas;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 land_areas count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_land_area_names') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_land_area_names';
    SELECT count(*) INTO a FROM core.core_land_area_names;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 land_area_names count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_water_lines') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_water_lines';
    SELECT count(*) INTO a FROM core.core_water_lines;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 water_lines count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_water_line_names') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_water_line_names';
    SELECT count(*) INTO a FROM core.core_water_line_names;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 water_line_names count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_water_polygons') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_water_polygons';
    SELECT count(*) INTO a FROM core.core_water_polygons;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 water_polygons count mismatch % vs %', b, a; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM _m154_before WHERE new_name = 'core.core_water_polygon_names') THEN
    SELECT n INTO b FROM _m154_before WHERE new_name = 'core.core_water_polygon_names';
    SELECT count(*) INTO a FROM core.core_water_polygon_names;
    IF b IS DISTINCT FROM a THEN RAISE EXCEPTION '154 water_polygon_names count mismatch % vs %', b, a; END IF;
  END IF;
END $$;

-- View SQL must mention new table names
DO $$
BEGIN
  IF pg_get_viewdef('tiles.tiles_buildings_v'::regclass, true) NOT ILIKE '%core.core_buildings%' THEN
    RAISE EXCEPTION '154: tiles_buildings_v does not reference core.core_buildings';
  END IF;
  IF pg_get_viewdef('tiles.tiles_landuse_v'::regclass, true) NOT ILIKE '%core.core_land_areas%' THEN
    RAISE EXCEPTION '154: tiles_landuse_v does not reference core.core_land_areas';
  END IF;
  IF pg_get_viewdef('tiles.tiles_water_lines_v'::regclass, true) NOT ILIKE '%core.core_water_lines%' THEN
    RAISE EXCEPTION '154: tiles_water_lines_v does not reference core.core_water_lines';
  END IF;
  IF pg_get_viewdef('tiles.tiles_water_polygons_v'::regclass, true) NOT ILIKE '%core.core_water_polygons%' THEN
    RAISE EXCEPTION '154: tiles_water_polygons_v does not reference core.core_water_polygons';
  END IF;
  IF pg_get_viewdef('search.v_search_buildings_source'::regclass, true) NOT ILIKE '%core.core_buildings%' THEN
    RAISE EXCEPTION '154: v_search_buildings_source does not reference core.core_buildings';
  END IF;
  IF pg_get_viewdef('search.v_search_landuse_source'::regclass, true) NOT ILIKE '%core.core_land_areas%' THEN
    RAISE EXCEPTION '154: v_search_landuse_source does not reference core.core_land_areas';
  END IF;
  IF pg_get_viewdef('search.v_search_water_lines_source'::regclass, true) NOT ILIKE '%core.core_water_lines%' THEN
    RAISE EXCEPTION '154: v_search_water_lines_source does not reference core.core_water_lines';
  END IF;
  IF pg_get_viewdef('search.v_search_water_polygons_source'::regclass, true) NOT ILIKE '%core.core_water_polygons%' THEN
    RAISE EXCEPTION '154: v_search_water_polygons_source does not reference core.core_water_polygons';
  END IF;
  -- old names must not remain in view SQL
  IF pg_get_viewdef('tiles.tiles_buildings_v'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('tiles.tiles_landuse_v'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('tiles.tiles_water_lines_v'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('tiles.tiles_water_polygons_v'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('search.v_search_buildings_source'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('search.v_search_landuse_source'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('search.v_search_water_lines_source'::regclass, true) ILIKE '%core_map_%'
     OR pg_get_viewdef('search.v_search_water_polygons_source'::regclass, true) ILIKE '%core_map_%' THEN
    RAISE EXCEPTION '154: view SQL still contains core_map_';
  END IF;
END $$;

-- FK sanity: place-buildings and address matched buildings still resolve
DO $$
BEGIN
  PERFORM 1
  FROM core.core_place_buildings pb
  LEFT JOIN core.core_buildings b ON b.id = pb.building_id
  WHERE b.id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '154: orphan core_place_buildings.building_id after rename';
  END IF;
END $$;

COMMIT;
