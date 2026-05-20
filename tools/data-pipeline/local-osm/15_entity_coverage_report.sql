-- =============================================================================
-- Stage 15: entity_coverage_report (read-only)
-- Import-review entity coverage metrics for local staging (+ optional import_review).
--
-- Scope:
--   - Read-only (temporary helper tables only).
--   - Does not modify staging, raw, core, import_review, prod_mirror, or Supabase data.
--   - Does not promote or upload anything.
--
-- Implementation priority (for operators — align with docs/import-review/entity-coverage-matrix.md):
--   P0 DONE  — buildings (full review + promotion path)
--   P1 NEXT  — places (review UI exists; add Stage J/K + promotion)
--   P2 THEN  — landuse, water_lines, water_polygons (map layers, lower risk)
--   P3 THEN  — bus_stops (+ names)
--   P4 LATER — roads (review exists; defer promotion — routing graph risk)
--   P5+      — admin_areas, addresses, bus_routes, routing_* (highest complexity)
--
-- Input psql variables:
--   snapshot_version (required)
--   staging_schema optional (default staging)
--   import_review_schema optional (default import_review; skipped with warning if absent)
--
-- Example:
--   cd tools/data-pipeline/local-osm
--   PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v snapshot_version="$SNAPSHOT_VERSION" \
--     -f ./15_entity_coverage_report.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?import_review_schema}
\else
\set import_review_schema 'import_review'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage15_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    import_review_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_params;

INSERT INTO stage15_params (
    snapshot_version,
    staging_schema,
    import_review_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'import_review_schema'), ''), 'import_review')
);

DO $stage15_params$
BEGIN
    IF (SELECT snapshot_version IS NULL FROM stage15_params LIMIT 1) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
END
$stage15_params$;

CREATE TEMP TABLE IF NOT EXISTS stage15_context (
    snapshot_id bigint NOT NULL PRIMARY KEY,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    import_review_schema text NOT NULL,
    import_review_schema_exists boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

TRUNCATE stage15_context;

DO $stage15_resolve$
DECLARE
    v_n integer;
    v_ir_exists boolean;
BEGIN
    SELECT count(*)::integer
    INTO v_n
    FROM system.system_source_snapshots AS s
    INNER JOIN stage15_params AS p
        ON p.snapshot_version = s.snapshot_version;

    IF v_n = 0 THEN
        RAISE EXCEPTION
            'snapshot_version "%" not found in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage15_params LIMIT 1);
    END IF;

    IF v_n > 1 THEN
        RAISE EXCEPTION
            'snapshot_version "%" is ambiguous (% rows) in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage15_params LIMIT 1),
            v_n;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.schemata AS sch
        INNER JOIN stage15_params AS p
            ON sch.schema_name = p.import_review_schema
    )
    INTO v_ir_exists;

    INSERT INTO stage15_context (
        snapshot_id,
        snapshot_version,
        staging_schema,
        import_review_schema,
        import_review_schema_exists
    )
    SELECT
        s.id,
        s.snapshot_version,
        p.staging_schema,
        p.import_review_schema,
        v_ir_exists
    FROM system.system_source_snapshots AS s
    INNER JOIN stage15_params AS p
        ON p.snapshot_version = s.snapshot_version;
END
$stage15_resolve$;

-- Static manifest: one row per staging candidate table (21 rows).
CREATE TEMP TABLE IF NOT EXISTS stage15_manifest (
    sort_order integer NOT NULL,
    entity_family text NOT NULL,
    staging_table text NOT NULL PRIMARY KEY,
    import_review_table text NULL,
    core_targets text NOT NULL,
    child_tables text NULL,
    geometry_expected text NOT NULL,
    geometry_columns text NULL,
    required_ref text NULL,
    pipeline_jk text NOT NULL,
    impl_priority text NOT NULL,
    risk_level text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_manifest;

INSERT INTO stage15_manifest (
    sort_order,
    entity_family,
    staging_table,
    import_review_table,
    core_targets,
    child_tables,
    geometry_expected,
    geometry_columns,
    required_ref,
    pipeline_jk,
    impl_priority,
    risk_level
)
VALUES
    ( 1, 'places', 'staging_place_candidates', 'place_candidates',
      'core.core_places',
      'staging_place_name_candidates → core.core_place_names, core.core_place_sources, core.core_place_versions',
      'Point (+ optional footprint)', 'point_geom, footprint_geom',
      'ref.ref_place_classes, ref.ref_poi_categories',
      'implemented', 'P1-next', 'medium'),

    ( 2, 'place_names', 'staging_place_name_candidates', NULL,
      'core.core_place_names',
      'FK place_candidate_id',
      'none', NULL,
      'staging.staging_place_candidates',
      'none', 'P1-next', 'medium'),

    ( 3, 'buildings', 'staging_building_candidates', 'building_candidates',
      'core.core_map_buildings',
      NULL,
      'MultiPolygon', 'geom',
      'class_code (no ref FK)',
      'implemented', 'P0-done', 'low'),

    ( 4, 'landuse', 'staging_landuse_candidates', 'landuse_candidates',
      'core.core_map_landuse',
      NULL,
      'MultiPolygon', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 5, 'water_lines', 'staging_water_line_candidates', 'water_line_candidates',
      'core.core_map_water_lines',
      NULL,
      'MultiLineString', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 6, 'water_polygons', 'staging_water_polygon_candidates', 'water_polygon_candidates',
      'core.core_map_water_polygons',
      NULL,
      'MultiPolygon', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 7, 'roads', 'staging_road_candidates', 'road_candidates',
      'core.core_streets',
      'staging_road_name_candidates → core.core_street_names, core.core_street_versions',
      'MultiLineString', 'geom',
      'ref.ref_road_classes',
      'implemented', 'P4-later', 'high'),

    ( 8, 'road_names', 'staging_road_name_candidates', NULL,
      'core.core_street_names',
      'FK road_candidate_id',
      'none', NULL,
      'staging.staging_road_candidates',
      'none', 'P4-later', 'medium'),

    ( 9, 'admin_areas', 'staging_admin_area_candidates', 'admin_area_candidates',
      'core.core_admin_areas',
      'staging_admin_area_name_candidates → core.core_admin_area_names',
      'MultiPolygon + Point centroid', 'geom, centroid',
      'ref.ref_admin_levels; parent_candidate_id',
      'placeholder', 'P5', 'medium'),

    (10, 'admin_area_names', 'staging_admin_area_name_candidates', NULL,
      'core.core_admin_area_names',
      'FK admin_area_candidate_id',
      'none', NULL,
      'staging.staging_admin_area_candidates',
      'none', 'P5', 'medium'),

    (11, 'bus_stops', 'staging_bus_stop_candidates', 'bus_stop_candidates',
      'core.core_bus_stops',
      'staging_bus_stop_name_candidates → core.core_bus_stop_names',
      'Point', 'point_geom',
      'optional staging_admin_area_candidates',
      'placeholder', 'P3', 'medium'),

    (12, 'bus_stop_names', 'staging_bus_stop_name_candidates', NULL,
      'core.core_bus_stop_names',
      'FK bus_stop_candidate_id',
      'none', NULL,
      'staging.staging_bus_stop_candidates',
      'none', 'P3', 'medium'),

    (13, 'bus_routes', 'staging_bus_route_candidates', 'bus_route_candidates',
      'core.core_bus_routes',
      'names, variants, route_stops (see child rows)',
      'LineString', 'geom',
      NULL,
      'none', 'P6', 'high'),

    (14, 'bus_route_names', 'staging_bus_route_name_candidates', NULL,
      'core.core_bus_route_names',
      'FK bus_route_candidate_id',
      'none', NULL,
      'staging.staging_bus_route_candidates',
      'none', 'P6', 'medium'),

    (15, 'bus_route_variants', 'staging_bus_route_variant_candidates', 'bus_route_variant_candidates',
      'core.core_bus_route_variants',
      'FK bus_route_candidate_id',
      'MultiLineString', 'geom',
      'staging.staging_bus_route_candidates',
      'none', 'P6', 'high'),

    (16, 'bus_route_stops', 'staging_bus_route_stop_candidates', 'bus_route_stop_candidates',
      'core.core_bus_route_stops',
      'FK variant + stop candidates',
      'Point (optional)', 'point_geom',
      'staging bus variant + stop candidates',
      'none', 'P6', 'high'),

    (17, 'addresses', 'staging_address_candidates', 'address_candidates',
      'core.core_addresses, core.core_place_addresses',
      'staging_address_component_candidates → core.core_address_components',
      'Point (+ optional geom)', 'point_geom, geom',
      'ref.ref_address_component_types (core)',
      'placeholder', 'P5', 'medium'),

    (18, 'address_components', 'staging_address_component_candidates', NULL,
      'core.core_address_components',
      'FK address_candidate_id',
      'none', NULL,
      'staging.staging_address_candidates',
      'none', 'P5', 'medium'),

    (19, 'routing_roads', 'staging_routing_road_candidates', NULL,
      'core.core_streets; routing.road_edges',
      'FK road_candidate_id',
      'LineString + MultiLineString', 'geom, geom_multi',
      'staging.staging_road_candidates',
      'none', 'P7', 'high'),

    (20, 'routing_turn_restrictions', 'staging_routing_turn_restriction_candidates', 'routing_turn_restriction_candidates',
      'routing.turn_restrictions',
      'relation external IDs only',
      'none', NULL,
      NULL,
      'none', 'P7', 'high'),

    (21, 'routing_barriers', 'staging_routing_barrier_candidates', 'routing_barrier_candidates',
      'core_routing_barriers (07 mirror only — no baseline core DDL)',
      NULL,
      'Point + optional Geometry', 'point_geom, geom',
      NULL,
      'placeholder', 'P7', 'high');

CREATE TEMP TABLE IF NOT EXISTS stage15_staging_row_counts (
    staging_table text NOT NULL,
    entity_family text NOT NULL,
    row_count bigint NOT NULL,
    table_exists boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_staging_row_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_data_quality_gaps (
    staging_table text NOT NULL,
    metric text NOT NULL,
    gap_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_data_quality_gaps;

CREATE TEMP TABLE IF NOT EXISTS stage15_status_counts (
    staging_table text NOT NULL,
    status_kind text NOT NULL,
    status_value text,
    row_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_status_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_import_review_counts (
    import_review_table text NOT NULL,
    entity_family text NOT NULL,
    row_count bigint NOT NULL,
    filtered_by_snapshot bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_import_review_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_warnings (
    warning_type text NOT NULL,
    entity_scope text NOT NULL,
    detail text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_warnings;

DO $stage15_dynamic$
DECLARE
    ctx stage15_context%ROWTYPE;
    r stage15_manifest%ROWTYPE;
    v_reg oid;
    v_has_snap boolean;
    v_has_source_refs boolean;
    v_has_normalized boolean;
    v_has_external_id boolean;
    v_has_match boolean;
    v_has_auto boolean;
    v_has_review boolean;
    v_geom_col text;
    v_geom_cols text[];
    v_ir_reg oid;
    v_ir_table text;
BEGIN
    SELECT * INTO STRICT ctx FROM stage15_context;

    IF NOT ctx.import_review_schema_exists THEN
        INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
        VALUES (
            'missing_schema',
            ctx.import_review_schema,
            'import_review schema not found on this connection; import_review counts skipped'
        );
    END IF;

    FOR r IN
        SELECT * FROM stage15_manifest ORDER BY sort_order
    LOOP
        v_reg := to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table));

        IF v_reg IS NULL THEN
            INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
            VALUES ('missing_table', r.staging_table, format('table %I.%I not found', ctx.staging_schema, r.staging_table));

            INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
            VALUES (r.staging_table, r.entity_family, 0, false);

            CONTINUE;
        END IF;

        -- Row count for snapshot
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = r.staging_table
              AND column_name = 'source_snapshot_id'
        ) INTO v_has_snap;

        IF v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
                SELECT %L, %L, count(*)::bigint, true
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                $q$,
                r.staging_table,
                r.entity_family,
                ctx.staging_schema,
                r.staging_table,
                ctx.snapshot_id
            );
        ELSE
            EXECUTE format(
                $q$
                INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
                SELECT %L, %L, count(*)::bigint, true
                FROM %I.%I AS t
                $q$,
                r.staging_table,
                r.entity_family,
                ctx.staging_schema,
                r.staging_table
            );
        END IF;

        -- Column presence
        SELECT
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'source_refs'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'normalized_data'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'external_id'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'match_status'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'auto_action'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'review_status')
        INTO v_has_source_refs, v_has_normalized, v_has_external_id, v_has_match, v_has_auto, v_has_review;

        -- Data quality: source_refs empty
        IF v_has_source_refs AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_source_refs', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (
                      t.source_refs IS NULL
                      OR t.source_refs = '{}'::jsonb
                      OR t.source_refs = 'null'::jsonb
                  )
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_source_refs THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_source_refs', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_refs IS NULL OR t.source_refs = '{}'::jsonb OR t.source_refs = 'null'::jsonb
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: normalized_data empty
        IF v_has_normalized AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_normalized_data', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (
                      t.normalized_data IS NULL
                      OR t.normalized_data = '{}'::jsonb
                      OR t.normalized_data = 'null'::jsonb
                  )
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_normalized THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_normalized_data', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.normalized_data IS NULL OR t.normalized_data = '{}'::jsonb OR t.normalized_data = 'null'::jsonb
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: external_id missing
        IF v_has_external_id AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_external_id', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (t.external_id IS NULL OR btrim(t.external_id) = '')
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_external_id THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_external_id', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.external_id IS NULL OR btrim(t.external_id) = ''
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: missing geometry where expected
        IF r.geometry_columns IS NOT NULL AND btrim(r.geometry_columns) <> '' THEN
            v_geom_cols := string_to_array(replace(r.geometry_columns, ' ', ''), ',');

            FOREACH v_geom_col IN ARRAY v_geom_cols
            LOOP
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = ctx.staging_schema
                      AND table_name = r.staging_table
                      AND column_name = v_geom_col
                ) THEN
                    IF v_has_snap THEN
                        EXECUTE format(
                            $q$
                            INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                            SELECT %L, %L, count(*)::bigint
                            FROM %I.%I AS t
                            WHERE t.source_snapshot_id = %s
                              AND t.%I IS NULL
                            $q$,
                            r.staging_table,
                            format('missing_geometry_%s', v_geom_col),
                            ctx.staging_schema,
                            r.staging_table,
                            ctx.snapshot_id,
                            v_geom_col
                        );
                    ELSE
                        EXECUTE format(
                            $q$
                            INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                            SELECT %L, %L, count(*)::bigint
                            FROM %I.%I AS t
                            WHERE t.%I IS NULL
                            $q$,
                            r.staging_table,
                            format('missing_geometry_%s', v_geom_col),
                            ctx.staging_schema,
                            r.staging_table,
                            v_geom_col
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;

        -- review_status counts
        IF v_has_review AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'review_status', t.review_status, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.review_status
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- match_status counts
        IF v_has_match AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'match_status', t.match_status, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.match_status
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- auto_action counts
        IF v_has_auto AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'auto_action', t.auto_action, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.auto_action
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- import_review counts (optional schema)
        IF ctx.import_review_schema_exists AND r.import_review_table IS NOT NULL THEN
            v_ir_table := r.import_review_table;
            v_ir_reg := to_regclass(format('%I.%I', ctx.import_review_schema, v_ir_table));

            IF v_ir_reg IS NULL THEN
                INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
                VALUES (
                    'missing_import_review_table',
                    v_ir_table,
                    format('expected %I.%I on this connection but table not found', ctx.import_review_schema, v_ir_table)
                );
            ELSE
                EXECUTE format(
                    $q$
                    INSERT INTO stage15_import_review_counts (
                        import_review_table,
                        entity_family,
                        row_count,
                        filtered_by_snapshot
                    )
                    SELECT
                        %L,
                        %L,
                        count(*)::bigint,
                        count(*) FILTER (
                            WHERE t.source_snapshot_version = %L
                        )::bigint
                    FROM %I.%I AS t
                    $q$,
                    v_ir_table,
                    r.entity_family,
                    ctx.snapshot_version,
                    ctx.import_review_schema,
                    v_ir_table
                );
            END IF;
        END IF;
    END LOOP;
END
$stage15_dynamic$;

-- =============================================================================
-- Output sections (read results top-to-bottom)
-- =============================================================================

SELECT
    'stage15_context' AS section,
    c.snapshot_id,
    c.snapshot_version,
    c.staging_schema,
    c.import_review_schema,
    c.import_review_schema_exists
FROM stage15_context AS c;

SELECT
    'stage15_entity_manifest' AS section,
    m.sort_order,
    m.entity_family,
    format('%I.%I', (SELECT staging_schema FROM stage15_context LIMIT 1), m.staging_table) AS local_staging_table,
    CASE
        WHEN m.import_review_table IS NULL THEN '—'
        ELSE format('%I.%I', (SELECT import_review_schema FROM stage15_context LIMIT 1), m.import_review_table)
    END AS import_review_table,
    m.core_targets,
    m.child_tables,
    m.geometry_expected,
    m.required_ref,
    m.pipeline_jk,
    m.impl_priority,
    m.risk_level
FROM stage15_manifest AS m
ORDER BY m.sort_order;

SELECT
    'stage15_staging_row_counts' AS section,
    rc.entity_family,
    rc.staging_table,
    rc.table_exists,
    rc.row_count
FROM stage15_staging_row_counts AS rc
ORDER BY (
    SELECT sort_order FROM stage15_manifest AS m WHERE m.staging_table = rc.staging_table
);

SELECT
    'stage15_data_quality_gaps' AS section,
    g.staging_table,
    g.metric,
    g.gap_count,
    rc.row_count AS snapshot_row_count,
    CASE
        WHEN rc.row_count = 0 THEN NULL
        ELSE round(100.0 * g.gap_count / rc.row_count, 2)
    END AS gap_pct
FROM stage15_data_quality_gaps AS g
LEFT JOIN stage15_staging_row_counts AS rc
    ON rc.staging_table = g.staging_table
ORDER BY g.staging_table, g.metric;

SELECT
    'stage15_review_status_counts' AS section,
    sc.staging_table,
    sc.status_value AS review_status,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'review_status'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_match_status_counts' AS section,
    sc.staging_table,
    sc.status_value AS match_status,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'match_status'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_auto_action_counts' AS section,
    sc.staging_table,
    sc.status_value AS auto_action,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'auto_action'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_import_review_row_counts' AS section,
    ir.import_review_table,
    ir.entity_family,
    ir.row_count AS total_rows,
    ir.filtered_by_snapshot AS rows_for_snapshot_version
FROM stage15_import_review_counts AS ir
ORDER BY ir.import_review_table;

SELECT
    'stage15_warnings' AS section,
    w.warning_type,
    w.entity_scope,
    w.detail
FROM stage15_warnings AS w
ORDER BY w.warning_type, w.entity_scope;

-- Compact coverage join (manifest + local counts + top gaps)
SELECT
    'stage15_coverage_summary' AS section,
    m.impl_priority,
    m.entity_family,
    m.staging_table,
    coalesce(rc.row_count, 0) AS local_row_count,
    coalesce(m.import_review_table, '—') AS import_review_table,
    coalesce(ir.filtered_by_snapshot, 0) AS import_review_snapshot_rows,
    m.pipeline_jk,
    m.risk_level
FROM stage15_manifest AS m
LEFT JOIN stage15_staging_row_counts AS rc
    ON rc.staging_table = m.staging_table
LEFT JOIN stage15_import_review_counts AS ir
    ON ir.import_review_table = m.import_review_table
ORDER BY m.sort_order;

COMMIT;
