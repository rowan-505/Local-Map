-- =============================================================================
-- Prod mirror 03: refresh_prod_mirror
-- Copies selected FDW foreign tables into real local prod_mirror tables.
--
-- Scope:
--   - Drops/recreates only local prod_mirror copied tables.
--   - Adds local comparison indexes.
--   - Does not modify Supabase, core, raw, or staging.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS prod_mirror;

CREATE TEMP TABLE prod_mirror_table_manifest (
    table_name text NOT NULL,
    required_for_f2 boolean NOT NULL DEFAULT false,
    strongly_recommended boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO prod_mirror_table_manifest (table_name, required_for_f2, strongly_recommended)
VALUES
    ('core_places', true, true),
    ('core_place_names', false, true),
    ('core_place_sources', false, false),
    ('core_streets', true, true),
    ('core_street_names', false, true),
    ('core_map_buildings', true, true),
    ('core_admin_areas', false, true),
    ('core_admin_area_names', false, true),
    ('core_bus_stops', false, true),
    ('core_bus_stop_names', false, true),
    ('core_bus_routes', false, true),
    ('core_bus_route_names', false, true),
    ('core_bus_route_variants', false, false),
    ('core_bus_route_stops', false, false),
    ('core_map_landuse', false, true),
    ('core_map_water_lines', false, true),
    ('core_map_water_polygons', false, true),
    ('core_addresses', false, true),
    ('core_address_components', false, false),
    ('ref_source_types', false, false),
    ('ref_poi_categories', false, false),
    ('ref_road_classes', false, false),
    ('ref_admin_levels', false, false),
    ('ref_address_component_types', false, false),
    ('ref_building_types', false, false),
    ('system_source_registry', false, false),
    ('system_source_snapshots', false, false);

CREATE TEMP TABLE prod_mirror_refresh_report (
    table_name text,
    row_count bigint,
    status text,
    note text
) ON COMMIT DROP;

DO $refresh_prod_mirror$
DECLARE
    t record;
    col record;
    idx_name text;
    row_count bigint;
BEGIN
    FOR t IN SELECT * FROM prod_mirror_table_manifest ORDER BY table_name LOOP
        IF to_regclass(format('supabase_fdw.%I', t.table_name)) IS NULL THEN
            INSERT INTO prod_mirror_refresh_report
            VALUES (
                t.table_name,
                NULL,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                'Foreign table is missing; run 02_import_foreign_tables.sql or confirm the Supabase table exists.'
            );

            IF t.required_for_f2 THEN
                RAISE EXCEPTION 'required foreign table supabase_fdw.% is missing', t.table_name;
            END IF;

            CONTINUE;
        END IF;

        EXECUTE format('DROP TABLE IF EXISTS prod_mirror.%I', t.table_name);
        EXECUTE format('CREATE TABLE prod_mirror.%I AS SELECT * FROM supabase_fdw.%I', t.table_name, t.table_name);
        EXECUTE format('SELECT count(*)::bigint FROM prod_mirror.%I', t.table_name) INTO row_count;

        INSERT INTO prod_mirror_refresh_report
        VALUES (t.table_name, row_count, 'PASS', 'Copied into prod_mirror.');

        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'prod_mirror'
              AND table_name = t.table_name
              AND (
                  column_name IN (
                      'id',
                      'public_id',
                      'external_id',
                      'source_snapshot_id',
                      'source_registry_id',
                      'source_type_id',
                      'place_id',
                      'street_id',
                      'admin_area_id',
                      'bus_stop_id',
                      'bus_route_id',
                      'route_id',
                      'variant_id',
                      'address_id'
                  )
                  OR column_name LIKE '%_id'
              )
        LOOP
            idx_name := left(format('prod_mirror_%s_%s_idx', t.table_name, col.column_name), 63);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (%I)', idx_name, t.table_name, col.column_name);
        END LOOP;

        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'prod_mirror'
              AND table_name = t.table_name
              AND column_name IN (
                  'name',
                  'canonical_name',
                  'public_name',
                  'route_code',
                  'full_address',
                  'normalized_name',
                  'display_name',
                  'short_name'
              )
        LOOP
            idx_name := left(format('prod_mirror_%s_%s_idx', t.table_name, col.column_name), 63);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (%I)', idx_name, t.table_name, col.column_name);

            idx_name := left(format('prod_mirror_%s_lower_%s_idx', t.table_name, col.column_name), 63);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I (lower(%I))', idx_name, t.table_name, col.column_name);
        END LOOP;

        FOR col IN
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'prod_mirror'
              AND table_name = t.table_name
              AND udt_name = 'geometry'
        LOOP
            idx_name := left(format('prod_mirror_%s_%s_gix', t.table_name, col.column_name), 63);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON prod_mirror.%I USING gist (%I)', idx_name, t.table_name, col.column_name);
        END LOOP;
    END LOOP;
END
$refresh_prod_mirror$;

SELECT
    'prod_mirror_refresh' AS section,
    table_name,
    row_count,
    status,
    note
FROM prod_mirror_refresh_report
ORDER BY
    CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    table_name;

COMMIT;
