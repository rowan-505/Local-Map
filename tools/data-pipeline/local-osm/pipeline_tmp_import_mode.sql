-- =============================================================================
-- pipeline_tmp_import_mode.sql
-- Derives Stage 02 tmp_import layout from ENTITY_FAMILIES (after pipeline_entity_families.sql).
--
-- import_mode values:
--   full              → osm_points, osm_lines, osm_polygons
--   admin_areas_only  → osm_admin_polygons
--   roads_only        → osm_road_lines
-- =============================================================================

CREATE TEMP TABLE IF NOT EXISTS _pipeline_tmp_import_mode (
    import_mode text NOT NULL PRIMARY KEY
);

TRUNCATE _pipeline_tmp_import_mode;

INSERT INTO _pipeline_tmp_import_mode (import_mode)
SELECT CASE
    WHEN system.pipeline_entity_families_is_all(ctx.entity_families) THEN 'full'
    WHEN system.pipeline_selected_entity_families(ctx.entity_families) = ARRAY['admin_areas']::text[]
        THEN 'admin_areas_only'
    WHEN system.pipeline_selected_entity_families(ctx.entity_families) = ARRAY['roads']::text[]
        THEN 'roads_only'
    ELSE 'full'
END
FROM _pipeline_entity_families_ctx AS ctx;

SELECT
    'pipeline_tmp_import_mode' AS section,
    mode.import_mode,
    CASE mode.import_mode
        WHEN 'admin_areas_only' THEN ARRAY['osm_admin_polygons']::text[]
        WHEN 'roads_only' THEN ARRAY['osm_road_lines']::text[]
        ELSE ARRAY['osm_points', 'osm_lines', 'osm_polygons']::text[]
    END AS expected_tmp_tables
FROM _pipeline_tmp_import_mode AS mode;
