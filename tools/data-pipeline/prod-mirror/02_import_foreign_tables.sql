-- =============================================================================
-- Prod mirror 02: import_foreign_tables
-- Imports selected Supabase table definitions as local foreign tables.
--
-- Scope:
--   - Drops/reimports only selected foreign tables in local supabase_fdw schema.
--   - Does not modify Supabase data or schema.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS supabase_fdw;

CREATE TEMP TABLE prod_mirror_table_manifest (
    remote_schema text NOT NULL,
    table_name text NOT NULL,
    required_for_f2 boolean NOT NULL DEFAULT false,
    strongly_recommended boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO prod_mirror_table_manifest (remote_schema, table_name, required_for_f2, strongly_recommended)
VALUES
    ('core', 'core_places', true, true),
    ('core', 'core_place_names', false, true),
    ('core', 'core_place_sources', false, false),
    ('core', 'core_streets', true, true),
    ('core', 'core_street_names', false, true),
    ('core', 'core_map_buildings', true, true),
    ('core', 'core_admin_areas', false, true),
    ('core', 'core_admin_area_names', false, true),
    ('core', 'core_bus_stops', false, true),
    ('core', 'core_bus_stop_names', false, true),
    ('core', 'core_bus_routes', false, true),
    ('core', 'core_bus_route_names', false, true),
    ('core', 'core_bus_route_variants', false, false),
    ('core', 'core_bus_route_stops', false, false),
    ('core', 'core_map_landuse', false, true),
    ('core', 'core_map_water_lines', false, true),
    ('core', 'core_map_water_polygons', false, true),
    ('core', 'core_addresses', false, true),
    ('core', 'core_address_components', false, false),
    ('ref', 'ref_source_types', false, false),
    ('ref', 'ref_poi_categories', false, false),
    ('ref', 'ref_road_classes', false, false),
    ('ref', 'ref_admin_levels', false, false),
    ('ref', 'ref_address_component_types', false, false),
    ('ref', 'ref_building_types', false, false),
    ('system', 'system_source_registry', false, false),
    ('system', 'system_source_snapshots', false, false);

CREATE TEMP TABLE prod_mirror_import_report (
    remote_schema text,
    table_name text,
    status text,
    note text
) ON COMMIT DROP;

DO $import_foreign_tables$
DECLARE
    t record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'supabase_prod_fdw') THEN
        RAISE EXCEPTION 'FDW server supabase_prod_fdw does not exist. Run 01_setup_fdw.sql first.';
    END IF;

    FOR t IN SELECT * FROM prod_mirror_table_manifest ORDER BY remote_schema, table_name LOOP
        BEGIN
            EXECUTE format('DROP FOREIGN TABLE IF EXISTS supabase_fdw.%I', t.table_name);
            EXECUTE format(
                'IMPORT FOREIGN SCHEMA %I LIMIT TO (%I) FROM SERVER supabase_prod_fdw INTO supabase_fdw',
                t.remote_schema,
                t.table_name
            );

            INSERT INTO prod_mirror_import_report
            VALUES (t.remote_schema, t.table_name, 'PASS', 'Foreign table imported.');
        EXCEPTION WHEN OTHERS THEN
            -- Ensure stale local foreign-table definitions are not reused after
            -- a failed import for a table that no longer exists remotely.
            EXECUTE format('DROP FOREIGN TABLE IF EXISTS supabase_fdw.%I', t.table_name);

            INSERT INTO prod_mirror_import_report
            VALUES (
                t.remote_schema,
                t.table_name,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                SQLERRM
            );

            IF t.required_for_f2 THEN
                RAISE EXCEPTION 'required Supabase table %.% could not be imported: %', t.remote_schema, t.table_name, SQLERRM;
            END IF;
        END;
    END LOOP;
END
$import_foreign_tables$;

SELECT
    'prod_mirror_foreign_import' AS section,
    remote_schema,
    table_name,
    status,
    note
FROM prod_mirror_import_report
ORDER BY
    CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    remote_schema,
    table_name;

COMMIT;
