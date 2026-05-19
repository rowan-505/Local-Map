-- =============================================================================
-- Stage I / Stage 09: create_review_views
-- CREATE OR REPLACE views over staging candidates for local review (no writes).
--
-- Scope:
--   - Local DB only; no core promotion, prod_mirror changes, Supabase, or
--     staging row updates.
--   - Views are not filtered to a single snapshot_version; join snapshots for
--     snapshot_version when lineage exists.
--   - Includes human review columns when present on the base table (migration
--     005_prepare_review_workflow or equivalent): review_decision, reviewed_by,
--     reviewed_at, review_note, alongside review_status.
--   - Those four columns are appended after updated_at so CREATE OR REPLACE VIEW
--     does not reorder existing view columns (PostgreSQL rejects mid-list inserts
--     as implicit renames).
--   - confidence_score follows the underlying table (0–100 scale, production-aligned).
--
-- Input psql variables:
--   staging_schema optional, defaults to staging
--   system_schema optional, defaults to system
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?system_schema}
\else
\set system_schema 'system'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage09_params (
    staging_schema text NOT NULL,
    system_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_params;

INSERT INTO stage09_params (staging_schema, system_schema)
VALUES (
    coalesce(nullif(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(nullif(btrim(:'system_schema'), ''), 'system')
);

CREATE TEMP TABLE IF NOT EXISTS stage09_manifest (
    sort_order integer NOT NULL,
    entity_family text NOT NULL,
    base_table text NOT NULL,
    nc_suffix text NOT NULL,
    rv_middle text NOT NULL,
    required_min boolean NOT NULL,
    include_manual_views boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_manifest;

INSERT INTO stage09_manifest (
    sort_order,
    entity_family,
    base_table,
    nc_suffix,
    rv_middle,
    required_min,
    include_manual_views
)
VALUES
    (10, 'places', 'staging_place_candidates', 'place_candidates', 'place', true, true),
    (20, 'roads', 'staging_road_candidates', 'road_candidates', 'road', true, true),
    (30, 'buildings', 'staging_building_candidates', 'building_candidates', 'building', true, true),
    (40, 'landuse', 'staging_landuse_candidates', 'landuse_candidates', 'landuse', false, true),
    (50, 'water_lines', 'staging_water_line_candidates', 'water_line_candidates', 'water_line', false, false),
    (60, 'water_polygons', 'staging_water_polygon_candidates', 'water_polygon_candidates', 'water_polygon', false, false),
    (70, 'admin_areas', 'staging_admin_area_candidates', 'admin_area_candidates', 'admin_area', false, false),
    (80, 'bus_stops', 'staging_bus_stop_candidates', 'bus_stop_candidates', 'bus_stop', false, false),
    (90, 'addresses', 'staging_address_candidates', 'address_candidates', 'address', false, false),
    (100, 'routing_barriers', 'staging_routing_barrier_candidates', 'routing_barrier_candidates', 'routing_barrier', false, false);

CREATE TEMP TABLE IF NOT EXISTS stage09_created_views (
    view_schema text NOT NULL,
    view_name text NOT NULL,
    PRIMARY KEY (view_schema, view_name)
) ON COMMIT DROP;

TRUNCATE stage09_created_views;

CREATE TEMP TABLE IF NOT EXISTS stage09_skipped (
    entity_family text NOT NULL,
    base_table text NOT NULL,
    reason text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_skipped;

DO $stage09_build$
DECLARE
    p stage09_params%ROWTYPE;
    m stage09_manifest%ROWTYPE;
    v_reg oid;
    v_has_id boolean;
    v_has_snap_fk boolean;
    v_has_match boolean;
    v_has_snapshots boolean;
    v_col_exists boolean;
    v_select text;
    v_view_nc text;
    v_view_rv text;
    v_view_mn text;
    v_where_nc text := $w$ c.match_status IN ('new_auto', 'matched_auto_update', 'unchanged') $w$;
    v_where_rv text := $w$ c.match_status IN ('needs_review', 'conflict', 'duplicate_candidate', 'delete_candidate') $w$;
    v_where_mn text := $w$ c.match_status = 'manual_protected' $w$;
    v_order text[] := ARRAY[
        'external_id',
        'canonical_name',
        'name',
        'public_name',
        'source_entity_type',
        'class_code',
        'admin_level_id',
        'place_class_id',
        'poi_category_id',
        'road_class_id',
        'parent_candidate_id',
        'route_code',
        'match_status',
        'auto_action',
        'review_status',
        'confidence_score',
        'source_refs',
        'normalized_data',
        'point_geom',
        'footprint_geom',
        'centroid',
        'geom',
        'geom_multi',
        'length_m',
        'area_m2',
        'is_oneway',
        'raw_id',
        'created_at',
        'updated_at',
        'review_decision',
        'reviewed_by',
        'reviewed_at',
        'review_note'
    ];
    v_col text;
BEGIN
    SELECT *
    INTO STRICT p
    FROM stage09_params;

    SELECT to_regclass(format('%I.%I', p.system_schema, 'system_source_snapshots')) IS NOT NULL
    INTO v_has_snapshots;

    IF NOT v_has_snapshots THEN
        RAISE EXCEPTION 'system source snapshot table missing: %I.system_source_snapshots', p.system_schema;
    END IF;

    FOR m IN
        SELECT *
        FROM stage09_manifest
        ORDER BY sort_order
    LOOP
        v_reg := to_regclass(format('%I.%I', p.staging_schema, m.base_table));

        IF v_reg IS NULL THEN
            INSERT INTO stage09_skipped (entity_family, base_table, reason)
            VALUES (
                m.entity_family,
                m.base_table,
                format('staging table does not exist: %I.%I', p.staging_schema, m.base_table)
            );

            IF m.required_min THEN
                RAISE EXCEPTION
                    'required staging table missing for Stage 09: %I.%I (entity_family=%)',
                    p.staging_schema,
                    m.base_table,
                    m.entity_family;
            END IF;

            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'source_snapshot_id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'match_status'
        )
        INTO v_has_id, v_has_snap_fk, v_has_match;

        IF NOT (v_has_id AND v_has_snap_fk AND v_has_match) THEN
            INSERT INTO stage09_skipped (entity_family, base_table, reason)
            VALUES (
                m.entity_family,
                m.base_table,
                'missing required column(s): id, source_snapshot_id, and/or match_status'
            );

            IF m.required_min THEN
                RAISE EXCEPTION
                    'required columns missing on %I.%I: need id, source_snapshot_id, match_status',
                    p.staging_schema,
                    m.base_table;
            END IF;

            CONTINUE;
        END IF;

        v_select := 'c.id AS candidate_id, c.source_snapshot_id, snap.snapshot_version AS snapshot_version';

        FOREACH v_col IN ARRAY v_order LOOP
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns AS c
                WHERE c.table_schema = p.staging_schema
                  AND c.table_name = m.base_table
                  AND c.column_name = v_col
            )
            INTO v_col_exists;

            IF v_col_exists THEN
                v_select := v_select || ', c.' || quote_ident(v_col);
            END IF;
        END LOOP;

        v_view_nc := 'v_no_conflict_' || m.nc_suffix;
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.%I AS
            SELECT %s
            FROM %I.%I AS c
            LEFT JOIN %I.%I AS snap
                ON snap.id = c.source_snapshot_id
            WHERE %s
            $sql$,
            p.staging_schema,
            v_view_nc,
            v_select,
            p.staging_schema,
            m.base_table,
            p.system_schema,
            'system_source_snapshots',
            v_where_nc
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, v_view_nc)
        ON CONFLICT DO NOTHING;

        v_view_rv := 'v_review_' || m.rv_middle || '_conflicts';
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.%I AS
            SELECT %s
            FROM %I.%I AS c
            LEFT JOIN %I.%I AS snap
                ON snap.id = c.source_snapshot_id
            WHERE %s
            $sql$,
            p.staging_schema,
            v_view_rv,
            v_select,
            p.staging_schema,
            m.base_table,
            p.system_schema,
            'system_source_snapshots',
            v_where_rv
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, v_view_rv)
        ON CONFLICT DO NOTHING;

        IF m.include_manual_views THEN
            v_view_mn :=
                'v_manual_protected_'
                || regexp_replace(m.nc_suffix, '_candidates$', '')
                || '_candidates';

            EXECUTE format(
                $sql$
                CREATE OR REPLACE VIEW %I.%I AS
                SELECT %s
                FROM %I.%I AS c
                LEFT JOIN %I.%I AS snap
                    ON snap.id = c.source_snapshot_id
                WHERE %s
                $sql$,
                p.staging_schema,
                v_view_mn,
                v_select,
                p.staging_schema,
                m.base_table,
                p.system_schema,
                'system_source_snapshots',
                v_where_mn
            );

            INSERT INTO stage09_created_views (view_schema, view_name)
            VALUES (p.staging_schema, v_view_mn)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END
$stage09_build$;

SELECT
    'stage09_created_or_replaced_views' AS section,
    format('%I.%I', view_schema, view_name) AS full_view_name
FROM stage09_created_views
ORDER BY full_view_name;

SELECT
    'stage09_skipped_tables' AS section,
    entity_family,
    base_table,
    reason
FROM stage09_skipped
ORDER BY entity_family;

COMMIT;
