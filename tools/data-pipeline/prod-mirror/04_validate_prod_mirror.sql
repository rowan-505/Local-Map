-- =============================================================================
-- Prod mirror 04: validate_prod_mirror
-- Validates local prod_mirror copied tables and reports row counts.
--
-- Scope:
--   - Read-only validation of local prod_mirror tables.
--   - Does not modify Supabase, core, raw, or staging.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS prod_mirror_validation_manifest (
    table_name text NOT NULL,
    required_for_f2 boolean NOT NULL DEFAULT false,
    strongly_recommended boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

CREATE TEMP TABLE IF NOT EXISTS prod_mirror_validation_report (
    table_name text,
    row_count bigint,
    status text,
    note text
) ON COMMIT DROP;

TRUNCATE prod_mirror_validation_manifest;
TRUNCATE prod_mirror_validation_report;

INSERT INTO prod_mirror_validation_manifest (table_name, required_for_f2, strongly_recommended)
VALUES
    ('core_places', true, true),
    ('core_streets', true, true),
    ('core_map_buildings', true, true),
    ('core_admin_areas', false, true),
    ('core_bus_stops', false, true),
    ('core_bus_routes', false, true),
    ('core_map_landuse', false, true),
    ('core_map_water_lines', false, true),
    ('core_map_water_polygons', false, true),
    ('core_addresses', false, true),
    ('core_place_names', false, true),
    ('core_street_names', false, true),
    ('core_admin_area_names', false, true),
    ('core_bus_stop_names', false, true),
    ('core_bus_route_names', false, true),
    ('core_place_sources', false, false),
    ('core_bus_route_variants', false, false),
    ('core_bus_route_stops', false, false),
    ('core_address_components', false, false),
    ('ref_source_types', false, false),
    ('ref_poi_categories', false, false),
    ('ref_road_classes', false, false),
    ('ref_admin_levels', false, false),
    ('ref_address_component_types', false, false),
    ('ref_building_types', false, false),
    ('system_source_registry', false, false),
    ('system_source_snapshots', false, false);

DO $validate_prod_mirror$
DECLARE
    t record;
    row_count bigint;
    schema_exists boolean;
BEGIN
    schema_exists := to_regnamespace('prod_mirror') IS NOT NULL;

    FOR t IN SELECT * FROM prod_mirror_validation_manifest LOOP
        IF NOT schema_exists THEN
            INSERT INTO prod_mirror_validation_report
            VALUES (
                t.table_name,
                NULL,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                CASE
                    WHEN t.required_for_f2 THEN 'Schema prod_mirror is missing; required F2 minimum mirror table cannot be validated.'
                    WHEN t.strongly_recommended THEN 'Schema prod_mirror is missing; strongly recommended mirror table cannot be validated.'
                    ELSE 'Schema prod_mirror is missing; optional mirror table cannot be validated.'
                END
            );
        ELSIF to_regclass(format('prod_mirror.%I', t.table_name)) IS NULL THEN
            INSERT INTO prod_mirror_validation_report
            VALUES (
                t.table_name,
                NULL,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                CASE
                    WHEN t.required_for_f2 THEN 'Required F2 minimum mirror table is missing.'
                    WHEN t.strongly_recommended THEN 'Strongly recommended mirror table is missing.'
                    ELSE 'Optional mirror table is missing.'
                END
            );
        ELSE
            EXECUTE format('SELECT count(*)::bigint FROM prod_mirror.%I', t.table_name) INTO row_count;

            INSERT INTO prod_mirror_validation_report
            VALUES (
                t.table_name,
                row_count,
                CASE WHEN row_count = 0 THEN 'WARN' ELSE 'PASS' END,
                CASE WHEN row_count = 0 THEN 'Mirror table exists but has zero rows.' ELSE 'Mirror table exists and has rows.' END
            );
        END IF;
    END LOOP;
END
$validate_prod_mirror$;

SELECT
    'prod_mirror_validation' AS section,
    table_name,
    row_count,
    status,
    note
FROM prod_mirror_validation_report
ORDER BY
    CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    table_name;

SELECT
    'prod_mirror_validation_summary' AS section,
    count(*) FILTER (WHERE status = 'FAIL') AS required_missing_count,
    count(*) FILTER (WHERE status = 'WARN' AND row_count IS NULL) AS optional_missing_count,
    count(*) FILTER (WHERE status = 'WARN' AND row_count = 0) AS zero_row_table_count,
    count(*) FILTER (WHERE status = 'PASS') AS pass_count,
    count(*) FILTER (WHERE status = 'WARN') AS warn_count,
    count(*) FILTER (WHERE status = 'FAIL') AS fail_count,
    CASE
        WHEN count(*) FILTER (WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN count(*) FILTER (WHERE status = 'WARN') > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status
FROM prod_mirror_validation_report;

DO $raise_required_missing$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM prod_mirror_validation_report
        WHERE status = 'FAIL'
    ) THEN
        RAISE EXCEPTION 'prod_mirror validation failed: required F2 minimum table is missing';
    END IF;
END
$raise_required_missing$;

COMMIT;
