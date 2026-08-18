-- =============================================================================
-- Local migration 012: mirror Supabase 154 table renames when local core exists
-- =============================================================================
--
-- Local geo_core / slim DBs may or may not have core.core_map_* tables.
-- This migration is idempotent: rename when old names exist; no-op otherwise.
-- Does not invent tables. Does not touch RLS or taxonomy.
-- Full object rename + view refresh for production: see
--   infrastructure/database/migrations/supabase/154_rename_core_map_tables.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('core.core_map_building_names') IS NOT NULL AND to_regclass('core.core_building_names') IS NULL THEN
    ALTER TABLE core.core_map_building_names RENAME TO core_building_names;
  END IF;
  IF to_regclass('core.core_map_buildings') IS NOT NULL AND to_regclass('core.core_buildings') IS NULL THEN
    ALTER TABLE core.core_map_buildings RENAME TO core_buildings;
  END IF;
  IF to_regclass('core.core_map_landuse_names') IS NOT NULL AND to_regclass('core.core_land_area_names') IS NULL THEN
    ALTER TABLE core.core_map_landuse_names RENAME TO core_land_area_names;
  END IF;
  IF to_regclass('core.core_map_landuse') IS NOT NULL AND to_regclass('core.core_land_areas') IS NULL THEN
    ALTER TABLE core.core_map_landuse RENAME TO core_land_areas;
  END IF;
  IF to_regclass('core.core_map_water_line_names') IS NOT NULL AND to_regclass('core.core_water_line_names') IS NULL THEN
    ALTER TABLE core.core_map_water_line_names RENAME TO core_water_line_names;
  END IF;
  IF to_regclass('core.core_map_water_lines') IS NOT NULL AND to_regclass('core.core_water_lines') IS NULL THEN
    ALTER TABLE core.core_map_water_lines RENAME TO core_water_lines;
  END IF;
  IF to_regclass('core.core_map_water_polygon_names') IS NOT NULL AND to_regclass('core.core_water_polygon_names') IS NULL THEN
    ALTER TABLE core.core_map_water_polygon_names RENAME TO core_water_polygon_names;
  END IF;
  IF to_regclass('core.core_map_water_polygons') IS NOT NULL AND to_regclass('core.core_water_polygons') IS NULL THEN
    ALTER TABLE core.core_map_water_polygons RENAME TO core_water_polygons;
  END IF;
END $$;

-- Refresh simple tile views when present (source-layer names unchanged).
DO $$
BEGIN
  IF to_regclass('core.core_land_areas') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW tiles.tiles_landuse_v AS
      SELECT l.id, l.name, l.class_code AS landuse_class, l.geom
      FROM core.core_land_areas AS l
      WHERE l.is_active IS TRUE AND l.deleted_at IS NULL
        AND l.geom IS NOT NULL AND NOT st_isempty(l.geom)
    $v$;
  END IF;
  IF to_regclass('core.core_water_lines') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW tiles.tiles_water_lines_v AS
      SELECT w.id, w.name, w.class_code AS waterway_class, w.geom
      FROM core.core_water_lines AS w
      WHERE w.is_active IS TRUE AND w.deleted_at IS NULL
        AND w.geom IS NOT NULL AND NOT st_isempty(w.geom)
    $v$;
  END IF;
  IF to_regclass('core.core_water_polygons') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW tiles.tiles_water_polygons_v AS
      SELECT w.id, w.name, w.class_code AS water_class, w.geom
      FROM core.core_water_polygons AS w
      WHERE w.is_active IS TRUE AND w.deleted_at IS NULL
        AND w.geom IS NOT NULL AND NOT st_isempty(w.geom)
    $v$;
  END IF;
END $$;

COMMIT;
