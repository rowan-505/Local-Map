-- Remove archived, historical township-gap QA working objects.
-- Complete row archive:
-- infrastructure/database/introspection/archive/admin-qa-2026-08-19/data.json

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP VIEW admin_qa.v_township_gap_points_qgis RESTRICT;
DROP VIEW admin_qa.v_township_gap_summary RESTRICT;
DROP VIEW admin_qa.v_township_gap_polygons_qgis RESTRICT;
DROP VIEW admin_qa.v_township_gap_parts RESTRICT;

DROP TABLE admin_qa.collect_data_gap_1 RESTRICT;
DROP TABLE admin_qa.collect_data_gap_3 RESTRICT;
DROP TABLE admin_qa.corrected_township_gap5_invalid_points RESTRICT;
DROP TABLE admin_qa.corrected_township_geometries_gap5 RESTRICT;
DROP TABLE admin_qa.inserted_admin_area_ids_gap1 RESTRICT;
DROP TABLE admin_qa.inserted_admin_area_ids_gap5 RESTRICT;
DROP TABLE admin_qa.township_gap_polygons_qgis RESTRICT;

DROP SCHEMA admin_qa RESTRICT;
