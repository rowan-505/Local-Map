-- =============================================================================
-- Stage 07: compare_with_prod_mirror (F2)
-- Compare current local OSM staging candidates against local prod_mirror copies.
--
-- Scope:
--   - Local database only.
--   - Reads staging.* and prod_mirror.* only.
--   - Writes only system.system_diff_runs and system.system_diff_items.
--   - Does not connect to Supabase, does not update prod_mirror/core/staging.
--
-- Input psql variables:
--   snapshot_version
--   staging_schema       optional, defaults to staging
--   prod_mirror_schema   optional, defaults to prod_mirror
--   only_entity_family   optional, process one family only (e.g. roads, places, buildings)
--
-- Run one family only (debug / isolate slow comparisons):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v snapshot_version="$SNAPSHOT_VERSION" \
--     -v only_entity_family=roads \
--     -f 07_compare_with_prod_mirror.sql
--
-- Building F2 comparison expects these local-only indexes to exist for good
-- performance. They are created by the local staging/prod-mirror workflows:
--   - staging.staging_building_candidates geom GIST
--   - prod_mirror.core_map_buildings geom GIST
--   - prod_mirror.core_map_buildings centroid GIST
--   - staging.staging_road_candidates geom GIST
--   - prod_mirror.core_streets geom GIST
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
SET statement_timeout = '120s';
SET lock_timeout = '10s';
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?prod_mirror_schema}
\else
\set prod_mirror_schema 'prod_mirror'
\endif
\if :{?only_entity_family}
\else
\set only_entity_family ''
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage07_params (
    snapshot_version text,
    staging_schema text NOT NULL,
    prod_mirror_schema text NOT NULL,
    only_entity_family text
) ON COMMIT DROP;

TRUNCATE stage07_params;

INSERT INTO stage07_params (
    snapshot_version,
    staging_schema,
    prod_mirror_schema,
    only_entity_family
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'prod_mirror_schema'), ''), 'prod_mirror'),
    NULLIF(btrim(:'only_entity_family'), '')
);

CREATE TEMP TABLE IF NOT EXISTS stage07_context (
    current_snapshot_id bigint NOT NULL,
    snapshot_version text,
    region_code text,
    prod_mirror_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage07_context;

CREATE TEMP TABLE IF NOT EXISTS stage07_report (
    entity_family text,
    staging_table text,
    prod_table text,
    auto_action text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

TRUNCATE stage07_report;

CREATE TEMP TABLE IF NOT EXISTS stage07_diff_runs (
    entity_family text NOT NULL,
    staging_table text NOT NULL,
    prod_table text NOT NULL,
    diff_run_id bigint NOT NULL,
    staging_rows bigint NOT NULL,
    prod_rows bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage07_diff_runs;

CREATE TEMP TABLE IF NOT EXISTS stage07_debug_log (
    event_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    entity_family text,
    event_type text NOT NULL,
    message text NOT NULL,
    elapsed_ms numeric,
    details jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

TRUNCATE stage07_debug_log;

CREATE TEMP TABLE IF NOT EXISTS stage07_family_config (
    entity_family text NOT NULL,
    staging_table text NOT NULL,
    prod_table text NOT NULL,
    required_prod boolean NOT NULL DEFAULT false,
    sensitive boolean NOT NULL DEFAULT false,
    conservative boolean NOT NULL DEFAULT false,
    staging_point_column text,
    staging_geom_column text,
    staging_geom_multi_column text,
    prod_point_column text,
    prod_geom_column text,
    spatial_threshold_m numeric,
    skip_f2_for_now boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

TRUNCATE stage07_family_config;

INSERT INTO stage07_family_config (
    entity_family,
    staging_table,
    prod_table,
    required_prod,
    sensitive,
    conservative,
    staging_point_column,
    staging_geom_column,
    staging_geom_multi_column,
    prod_point_column,
    prod_geom_column,
    spatial_threshold_m
)
VALUES
    ('places', 'staging_place_candidates', 'core_places', true, false, false, 'point_geom', 'footprint_geom', NULL, 'point_geom', 'geom', 30),
    ('roads', 'staging_road_candidates', 'core_streets', true, false, false, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('buildings', 'staging_building_candidates', 'core_map_buildings', true, false, false, NULL, 'geom', NULL, 'centroid', 'geom', 10),
    ('admin_areas', 'staging_admin_area_candidates', 'core_admin_areas', false, true, true, NULL, 'geom', NULL, 'centroid', 'geom', 10),
    ('landuse', 'staging_landuse_candidates', 'core_map_landuse', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 5),
    ('water_lines', 'staging_water_line_candidates', 'core_map_water_lines', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('water_polygons', 'staging_water_polygon_candidates', 'core_map_water_polygons', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 5),
    ('bus_stops', 'staging_bus_stop_candidates', 'core_bus_stops', false, false, false, 'point_geom', NULL, NULL, 'point_geom', 'geom', 30),
    ('bus_routes', 'staging_bus_route_candidates', 'core_bus_routes', false, false, true, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('bus_route_variants', 'staging_bus_route_variant_candidates', 'core_bus_route_variants', false, false, true, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('bus_route_stops', 'staging_bus_route_stop_candidates', 'core_bus_route_stops', false, true, true, 'point_geom', NULL, NULL, 'point_geom', NULL, 30),
    ('addresses', 'staging_address_candidates', 'core_addresses', false, false, false, 'point_geom', 'geom', NULL, 'point_geom', 'geom', 30),
    ('routing_roads', 'staging_routing_road_candidates', 'core_streets', false, false, true, NULL, 'geom', 'geom_multi', NULL, 'geom', 10),
    ('routing_barriers', 'staging_routing_barrier_candidates', 'core_routing_barriers', false, false, true, 'point_geom', 'geom', NULL, 'point_geom', 'geom', 10);

-- routing_roads are derived from staging_road_candidates and are compared
-- indirectly through roads. Routing graph-specific validation will happen in a
-- later routing stage, so F2 skips this duplicate prod_mirror comparison for now.
UPDATE stage07_family_config
SET skip_f2_for_now = true
WHERE entity_family = 'routing_roads';

DO $stage07_context$
DECLARE
    v_snapshot_version text;
    v_prod_mirror_schema text;
BEGIN
    SELECT p.snapshot_version, p.prod_mirror_schema
    INTO v_snapshot_version, v_prod_mirror_schema
    FROM stage07_params AS p;

    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    INSERT INTO stage07_context (
        current_snapshot_id,
        snapshot_version,
        region_code,
        prod_mirror_schema
    )
    SELECT
        snapshot.id,
        snapshot.snapshot_version,
        snapshot.region_code,
        v_prod_mirror_schema
    FROM system.system_source_snapshots AS snapshot
    WHERE snapshot.snapshot_version = v_snapshot_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', v_snapshot_version;
    END IF;

    IF to_regnamespace(v_prod_mirror_schema) IS NULL THEN
        RAISE EXCEPTION 'prod_mirror schema "%" does not exist. Refresh the local production mirror before Stage F2.', v_prod_mirror_schema;
    END IF;
END
$stage07_context$;

SELECT
    'stage07_snapshot_context' AS section,
    current_snapshot_id,
    snapshot_version,
    region_code,
    prod_mirror_schema
FROM stage07_context;

-- Rerun safety: remove only previous F2 staging-vs-prod-mirror output for this
-- current snapshot. F1 snapshot_vs_snapshot diff runs are preserved.
-- When only_entity_family is set, delete only that family's prior F2 output.
DELETE FROM system.system_diff_items AS item
USING system.system_diff_runs AS run
JOIN stage07_context AS ctx
    ON ctx.current_snapshot_id = run.current_snapshot_id
CROSS JOIN stage07_params AS p
WHERE item.diff_run_id = run.id
  AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
  AND (p.only_entity_family IS NULL OR run.entity_family = p.only_entity_family);

DELETE FROM system.system_diff_runs AS run
USING stage07_context AS ctx
CROSS JOIN stage07_params AS p
WHERE run.current_snapshot_id = ctx.current_snapshot_id
  AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
  AND (p.only_entity_family IS NULL OR run.entity_family = p.only_entity_family);

DO $stage07_validate_targets$
DECLARE
    v_staging_schema text;
    v_prod_mirror_schema text;
    cfg record;
    missing_required_count integer := 0;
BEGIN
    SELECT p.staging_schema, p.prod_mirror_schema
    INTO v_staging_schema, v_prod_mirror_schema
    FROM stage07_params AS p;

    FOR cfg IN SELECT * FROM stage07_family_config LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, cfg.staging_table)) IS NULL THEN
            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                'skip',
                0,
                CASE WHEN cfg.required_prod THEN 'FAIL' ELSE 'WARN' END,
                CASE WHEN cfg.required_prod THEN 'Required staging table missing for F2 minimum comparison.' ELSE 'Optional staging table missing; skipped entity family.' END
            );

            IF cfg.required_prod THEN
                missing_required_count := missing_required_count + 1;
            END IF;
        ELSIF to_regclass(format('%I.%I', v_prod_mirror_schema, cfg.prod_table)) IS NULL THEN
            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                'skip',
                0,
                CASE WHEN cfg.required_prod THEN 'FAIL' ELSE 'WARN' END,
                CASE WHEN cfg.required_prod THEN 'Required prod_mirror table missing for F2 minimum comparison.' ELSE 'Optional prod_mirror table missing; skipped entity family.' END
            );

            IF cfg.required_prod THEN
                missing_required_count := missing_required_count + 1;
            END IF;
        ELSE
            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                'ready',
                1,
                'PASS',
                NULL
            );
        END IF;
    END LOOP;

    IF missing_required_count > 0 THEN
        RAISE EXCEPTION 'Stage F2 required prod_mirror minimum is not available. Required tables: %.core_places, %.core_streets, %.core_map_buildings', v_prod_mirror_schema, v_prod_mirror_schema, v_prod_mirror_schema;
    END IF;
END
$stage07_validate_targets$;

DO $stage07_compare$
DECLARE
    v_staging_schema text;
    v_prod_mirror_schema text;
    v_only_entity_family text;
    ctx stage07_context%ROWTYPE;
    cfg record;
    v_staging_count bigint;
    v_prod_count bigint;
    v_diff_run_id bigint;
    v_insert_start_ts timestamptz;
    v_inserted_count bigint;
    v_elapsed_ms numeric;
    v_staging_table_fq text;
    v_prod_table_fq text;
    v_road_source_match_count bigint;
    v_road_spatial_match_count bigint;
    v_road_best_match_count bigint;
    v_road_no_match_count bigint;
    v_has_staging_confidence boolean;
    v_has_staging_point boolean;
    v_has_staging_geom boolean;
    v_has_staging_geom_multi boolean;
    v_has_prod_point boolean;
    v_has_prod_geom boolean;
    v_source_match_expr text;
    v_name_match_expr text;
    v_spatial_match_expr text;
    v_building_intersection_match_expr text;
    v_building_centroid_match_expr text;
    v_building_centroid_target_expr text;
    v_road_intersection_match_expr text;
    v_road_distance_match_expr text;
    v_spatial_expand_degrees numeric;
    v_match_where text;
    v_match_rank_expr text;
    v_changed_expr text;
    v_manual_expr text;
    v_staging_name_expr text;
    v_prod_name_expr text;
    v_confidence_expr text;
    q text;
BEGIN
    EXECUTE $create_log$
    CREATE OR REPLACE FUNCTION pg_temp.stage07_log(
        p_entity_family text,
        p_event_type text,
        p_message text,
        p_elapsed_ms numeric DEFAULT NULL,
        p_details jsonb DEFAULT '{}'::jsonb
    ) RETURNS void
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
        INSERT INTO stage07_debug_log (event_at, entity_family, event_type, message, elapsed_ms, details)
        VALUES (clock_timestamp(), p_entity_family, p_event_type, p_message, p_elapsed_ms, p_details);
    END;
    $fn$;
    $create_log$;

    SELECT p.staging_schema, p.prod_mirror_schema, p.only_entity_family
    INTO v_staging_schema, v_prod_mirror_schema, v_only_entity_family
    FROM stage07_params AS p;

    SELECT *
    INTO STRICT ctx
    FROM stage07_context;

    RAISE NOTICE 'stage07_compare_begin snapshot_version=% only_entity_family=% at=%',
        ctx.snapshot_version,
        coalesce(v_only_entity_family, '<all>'),
        clock_timestamp();
    PERFORM pg_temp.stage07_log(
        NULL,
        'compare_begin',
        format('snapshot_version=%s only_entity_family=%s', ctx.snapshot_version, coalesce(v_only_entity_family, '<all>')),
        NULL,
        jsonb_build_object(
            'current_snapshot_id', ctx.current_snapshot_id,
            'staging_schema', v_staging_schema,
            'prod_mirror_schema', v_prod_mirror_schema
        )
    );

    IF v_only_entity_family IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM stage07_family_config AS fc
           WHERE fc.entity_family = v_only_entity_family
       ) THEN
        RAISE EXCEPTION 'only_entity_family "%" is not configured in stage07_family_config', v_only_entity_family;
    END IF;

    FOR cfg IN
        SELECT *
        FROM stage07_family_config
        WHERE v_only_entity_family IS NULL OR entity_family = v_only_entity_family
        ORDER BY entity_family
    LOOP
        v_staging_table_fq := format('%s.%s', v_staging_schema, cfg.staging_table);
        v_prod_table_fq := format('%s.%s', v_prod_mirror_schema, cfg.prod_table);

        RAISE NOTICE 'stage07_start family=% staging_table=% prod_table=% at=%',
            cfg.entity_family,
            v_staging_table_fq,
            v_prod_table_fq,
            clock_timestamp();
        PERFORM pg_temp.stage07_log(
            cfg.entity_family,
            'start',
            format('staging_table=%s prod_table=%s', v_staging_table_fq, v_prod_table_fq),
            NULL,
            jsonb_build_object('staging_table', v_staging_table_fq, 'prod_table', v_prod_table_fq)
        );

        IF to_regclass(format('%I.%I', v_staging_schema, cfg.staging_table)) IS NULL THEN
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'skip',
                'staging table missing',
                NULL,
                jsonb_build_object('staging_table', v_staging_table_fq)
            );
            CONTINUE;
        END IF;

        q := format('SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1', v_staging_schema, cfg.staging_table);
        EXECUTE q INTO v_staging_count USING ctx.current_snapshot_id;

        IF to_regclass(format('%I.%I', v_prod_mirror_schema, cfg.prod_table)) IS NULL THEN
            IF cfg.entity_family = 'routing_barriers' AND v_staging_count > 0 THEN
                INSERT INTO system.system_diff_runs (
                    previous_snapshot_id,
                    current_snapshot_id,
                    entity_family,
                    status,
                    started_at,
                    summary
                )
                VALUES (
                    NULL,
                    ctx.current_snapshot_id,
                    cfg.entity_family,
                    'running',
                    now(),
                    jsonb_build_object(
                        'comparison_type', 'staging_vs_prod_mirror',
                        'current_snapshot_id', ctx.current_snapshot_id,
                        'snapshot_version', ctx.snapshot_version,
                        'target', 'prod_mirror',
                        'entity_family', cfg.entity_family,
                        'staging_table', format('%s.%s', v_staging_schema, cfg.staging_table),
                        'prod_table', format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                        'prod_table_missing', true
                    )
                )
                RETURNING id INTO v_diff_run_id;

                INSERT INTO stage07_diff_runs (entity_family, staging_table, prod_table, diff_run_id, staging_rows, prod_rows)
                VALUES (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.staging_table), format('%s.%s', v_prod_mirror_schema, cfg.prod_table), v_diff_run_id, v_staging_count, 0);

                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = v_staging_schema AND table_name = cfg.staging_table AND column_name = 'confidence_score'
                ) INTO v_has_staging_confidence;

                RAISE NOTICE 'stage07_counts family=% staging_rows=% prod_rows=%',
                    cfg.entity_family,
                    v_staging_count,
                    0;
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'counts',
                    format('staging_rows=%s prod_rows=%s', v_staging_count, 0),
                    NULL,
                    jsonb_build_object('staging_rows', v_staging_count, 'prod_rows', 0, 'prod_table_missing', true)
                );

                RAISE NOTICE 'stage07_insert_start family=% diff_run_id=% at=%',
                    cfg.entity_family,
                    v_diff_run_id,
                    clock_timestamp();
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'insert_start',
                    format('diff_run_id=%s', v_diff_run_id),
                    NULL,
                    jsonb_build_object('diff_run_id', v_diff_run_id)
                );

                BEGIN
                q := format(
                    $q$
                    INSERT INTO system.system_diff_items (
                        diff_run_id,
                        entity_family,
                        diff_type,
                        external_id,
                        local_entity_id,
                        before_data,
                        after_data,
                        confidence_score,
                        auto_action,
                        review_status,
                        created_at
                    )
                    SELECT
                        $1,
                        %L,
                        'new',
                        s.external_id,
                        s.id,
                        NULL,
                        to_jsonb(s) || jsonb_build_object(
                            'f2_comparison',
                            jsonb_build_object(
                                'f2_result', 'prod_no_match',
                                'prod_match_rank', NULL,
                                'source_matched', false,
                                'spatial_matched', false,
                                'name_matched', false,
                                'manual_protected', false
                            )
                        ),
                        %s,
                        'insert_candidate',
                        'pending',
                        now()
                    FROM %I.%I AS s
                    WHERE s.source_snapshot_id = $2
                    $q$,
                    cfg.entity_family,
                    CASE WHEN v_has_staging_confidence THEN 'coalesce(s.confidence_score, 50.0000)' ELSE '50.0000' END,
                    v_staging_schema,
                    cfg.staging_table
                );
                v_insert_start_ts := clock_timestamp();
                EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id;
                GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
                v_elapsed_ms := round((extract(epoch FROM (clock_timestamp() - v_insert_start_ts)) * 1000.0)::numeric, 2);

                RAISE NOTICE 'stage07_insert_done family=% inserted=% elapsed_ms=% at=%',
                    cfg.entity_family,
                    v_inserted_count,
                    v_elapsed_ms,
                    clock_timestamp();
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'insert_done',
                    format('inserted=%s diff_run_id=%s', v_inserted_count, v_diff_run_id),
                    v_elapsed_ms,
                    jsonb_build_object('diff_run_id', v_diff_run_id, 'inserted', v_inserted_count)
                );

                EXCEPTION
                    WHEN OTHERS THEN
                        UPDATE system.system_diff_runs AS run
                        SET
                            status = 'failed',
                            finished_at = now(),
                            summary = run.summary || jsonb_build_object(
                                'error_sqlstate', SQLSTATE,
                                'error_message', SQLERRM
                            )
                        WHERE run.id = v_diff_run_id;

                        RAISE NOTICE 'stage07_insert_fail family=% sqlstate=% sqlerrm=% at=%',
                            cfg.entity_family,
                            SQLSTATE,
                            SQLERRM,
                            clock_timestamp();
                        PERFORM pg_temp.stage07_log(
                            cfg.entity_family,
                            'insert_fail',
                            SQLERRM,
                            NULL,
                            jsonb_build_object(
                                'diff_run_id', v_diff_run_id,
                                'sqlstate', SQLSTATE,
                                'sqlerrm', SQLERRM
                            )
                        );
                        RAISE;
                END;

                UPDATE system.system_diff_runs AS run
                SET
                    status = 'completed',
                    finished_at = now(),
                    summary = run.summary
                        || jsonb_build_object(
                            'counts_by_diff_type',
                            coalesce((
                                SELECT jsonb_object_agg(counts.diff_type, counts.value_n)
                                FROM (
                                    SELECT item.diff_type, count(*)::bigint AS value_n
                                    FROM system.system_diff_items AS item
                                    WHERE item.diff_run_id = v_diff_run_id
                                    GROUP BY item.diff_type
                                ) AS counts
                            ), '{}'::jsonb),
                            'counts_by_auto_action',
                            coalesce((
                                SELECT jsonb_object_agg(counts.auto_action, counts.value_n)
                                FROM (
                                    SELECT item.auto_action, count(*)::bigint AS value_n
                                    FROM system.system_diff_items AS item
                                    WHERE item.diff_run_id = v_diff_run_id
                                    GROUP BY item.auto_action
                                ) AS counts
                            ), '{}'::jsonb),
                            'total_items',
                            (
                                SELECT count(*)::bigint
                                FROM system.system_diff_items AS item
                                WHERE item.diff_run_id = v_diff_run_id
                            )
                        )
                WHERE run.id = v_diff_run_id;

                INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
                SELECT
                    cfg.entity_family,
                    format('%s.%s', v_staging_schema, cfg.staging_table),
                    format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                    item.auto_action,
                    count(*)::bigint,
                    'PASS',
                    'No production barrier table exists; classified current routing barriers from staging confidence.'
                FROM system.system_diff_items AS item
                WHERE item.diff_run_id = v_diff_run_id
                GROUP BY item.auto_action;
            END IF;

            CONTINUE;
        END IF;

        q := format('SELECT count(*)::bigint FROM %I.%I', v_prod_mirror_schema, cfg.prod_table);
        EXECUTE q INTO v_prod_count;

        RAISE NOTICE 'stage07_counts family=% staging_rows=% prod_rows=%',
            cfg.entity_family,
            v_staging_count,
            v_prod_count;
        PERFORM pg_temp.stage07_log(
            cfg.entity_family,
            'counts',
            format('staging_rows=%s prod_rows=%s', v_staging_count, v_prod_count),
            NULL,
            jsonb_build_object('staging_rows', v_staging_count, 'prod_rows', v_prod_count)
        );

        INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
        VALUES
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.staging_table), format('%s.%s', v_prod_mirror_schema, cfg.prod_table), 'staging_rows', v_staging_count, 'PASS', NULL),
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.staging_table), format('%s.%s', v_prod_mirror_schema, cfg.prod_table), 'prod_rows', v_prod_count, 'PASS', NULL);

        IF cfg.skip_f2_for_now THEN
            RAISE NOTICE 'stage07_skip family=% reason=%',
                cfg.entity_family,
                'derived_from_roads_f2_covered_by_roads';
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'skip_f2_for_now',
                'derived_from_roads_f2_covered_by_roads',
                NULL,
                jsonb_build_object(
                    'staging_rows', v_staging_count,
                    'prod_rows', v_prod_count,
                    'reason', 'derived_from_roads_f2_covered_by_roads'
                )
            );
            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                'skip_f2_for_now',
                0,
                'SKIPPED',
                'routing_roads are derived from roads; F2 prod_mirror conflict detection is covered by roads. Routing graph-specific validation will happen later.'
            );
            CONTINUE;
        END IF;

        IF v_staging_count = 0 THEN
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'skip',
                'no staging rows for current snapshot',
                NULL,
                jsonb_build_object('staging_rows', v_staging_count)
            );
            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            VALUES (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.staging_table), format('%s.%s', v_prod_mirror_schema, cfg.prod_table), 'skip_empty_staging', 0, 'PASS', 'No current staging rows; no F2 diff_run created.');
            CONTINUE;
        END IF;

        INSERT INTO system.system_diff_runs (
            previous_snapshot_id,
            current_snapshot_id,
            entity_family,
            status,
            started_at,
            summary
        )
        VALUES (
            NULL,
            ctx.current_snapshot_id,
            cfg.entity_family,
            'running',
            now(),
            jsonb_build_object(
                'comparison_type', 'staging_vs_prod_mirror',
                'current_snapshot_id', ctx.current_snapshot_id,
                'snapshot_version', ctx.snapshot_version,
                'target', 'prod_mirror',
                'entity_family', cfg.entity_family,
                'staging_table', format('%s.%s', v_staging_schema, cfg.staging_table),
                'prod_table', format('%s.%s', v_prod_mirror_schema, cfg.prod_table)
            )
        )
        RETURNING id INTO v_diff_run_id;

        INSERT INTO stage07_diff_runs (entity_family, staging_table, prod_table, diff_run_id, staging_rows, prod_rows)
        VALUES (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.staging_table), format('%s.%s', v_prod_mirror_schema, cfg.prod_table), v_diff_run_id, v_staging_count, v_prod_count);

        IF cfg.entity_family = 'roads' THEN
            -- Roads use staged temp tables instead of the generic per-row LATERAL
            -- spatial matcher. F2 only detects production conflicts; precise
            -- routing graph matching will happen in later routing stages.
            RAISE NOTICE 'stage07_insert_start family=% diff_run_id=% at=%',
                cfg.entity_family,
                v_diff_run_id,
                clock_timestamp();
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'insert_start',
                format('diff_run_id=%s', v_diff_run_id),
                NULL,
                jsonb_build_object('diff_run_id', v_diff_run_id)
            );

            BEGIN
                v_insert_start_ts := clock_timestamp();

                DROP TABLE IF EXISTS stage07_road_staging;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_road_staging ON COMMIT DROP AS
                    SELECT
                        s.id AS staging_id,
                        s.external_id,
                        s.geom,
                        s.canonical_name,
                        coalesce(s.confidence_score, 50.0000) AS confidence_score,
                        to_jsonb(s) AS staging_data,
                        coalesce(s.source_refs, '{}'::jsonb) AS source_refs,
                        coalesce(s.normalized_data, '{}'::jsonb) AS normalized_data
                    FROM %I.%I AS s
                    WHERE s.source_snapshot_id = $1
                    $q$,
                    v_staging_schema,
                    cfg.staging_table
                ) USING ctx.current_snapshot_id;

                CREATE INDEX stage07_road_staging_staging_id_idx
                    ON stage07_road_staging (staging_id);
                CREATE INDEX stage07_road_staging_external_id_idx
                    ON stage07_road_staging (external_id);
                CREATE INDEX stage07_road_staging_geom_gix
                    ON stage07_road_staging USING gist (geom);
                ANALYZE stage07_road_staging;

                DROP TABLE IF EXISTS stage07_road_prod;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_road_prod ON COMMIT DROP AS
                    SELECT
                        p.id AS prod_id,
                        p.geom,
                        coalesce(nullif(to_jsonb(p)->>'canonical_name', ''), nullif(to_jsonb(p)->>'name', '')) AS canonical_name,
                        to_jsonb(p) AS prod_data,
                        coalesce(to_jsonb(p)->'source_refs', '{}'::jsonb) AS source_refs,
                        nullif(to_jsonb(p)->>'external_id', '') AS external_id,
                        (
                            CASE
                                WHEN to_jsonb(p)->>'is_verified' IN ('true', 'false')
                                    THEN (to_jsonb(p)->>'is_verified')::boolean
                                ELSE false
                            END
                            OR CASE
                                WHEN to_jsonb(p)->>'manual_override' IN ('true', 'false')
                                    THEN (to_jsonb(p)->>'manual_override')::boolean
                                ELSE false
                            END
                            OR coalesce(to_jsonb(p)->'source_refs', '{}'::jsonb)::text ILIKE '%%manual_dashboard%%'
                            OR coalesce(to_jsonb(p)->>'source_type', '') ILIKE '%%manual%%'
                            OR coalesce(to_jsonb(p)->>'source_type', '') ILIKE '%%dashboard%%'
                        ) AS manual_protected
                    FROM %I.%I AS p
                    $q$,
                    v_prod_mirror_schema,
                    cfg.prod_table
                );

                CREATE INDEX stage07_road_prod_prod_id_idx
                    ON stage07_road_prod (prod_id);
                CREATE INDEX stage07_road_prod_external_id_idx
                    ON stage07_road_prod (external_id);
                CREATE INDEX stage07_road_prod_geom_gix
                    ON stage07_road_prod USING gist (geom);
                ANALYZE stage07_road_prod;

                SELECT count(*)::bigint INTO v_staging_count FROM stage07_road_staging;
                SELECT count(*)::bigint INTO v_prod_count FROM stage07_road_prod;

                RAISE NOTICE 'stage07_road_staging_count count=%', v_staging_count;
                RAISE NOTICE 'stage07_road_prod_count count=%', v_prod_count;
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_staging_count',
                    format('count=%s', v_staging_count),
                    NULL,
                    jsonb_build_object('count', v_staging_count)
                );
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_prod_count',
                    format('count=%s', v_prod_count),
                    NULL,
                    jsonb_build_object('count', v_prod_count)
                );

                DROP TABLE IF EXISTS stage07_road_source_matches;
                CREATE TEMP TABLE stage07_road_source_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (s.staging_id)
                    s.staging_id,
                    p.prod_id,
                    p.prod_data,
                    1 AS match_rank,
                    true AS source_matched,
                    false AS spatial_matched,
                    (
                        s.canonical_name IS NOT NULL
                        AND p.canonical_name IS NOT NULL
                        AND lower(s.canonical_name) = lower(p.canonical_name)
                    ) AS name_matched,
                    p.manual_protected
                FROM stage07_road_staging AS s
                JOIN stage07_road_prod AS p
                    ON p.external_id = s.external_id
                    OR p.source_refs->>'external_id' = s.external_id
                    OR p.source_refs->>'osm_external_id' = s.external_id
                    OR (
                        nullif(coalesce(s.normalized_data->>'osm_id', s.source_refs->>'osm_id', ''), '') IS NOT NULL
                        AND p.source_refs->>'osm_id' = coalesce(s.normalized_data->>'osm_id', s.source_refs->>'osm_id')
                    )
                ORDER BY s.staging_id, p.manual_protected DESC, p.prod_id;

                CREATE INDEX stage07_road_source_matches_staging_id_idx
                    ON stage07_road_source_matches (staging_id);
                ANALYZE stage07_road_source_matches;

                SELECT count(*)::bigint INTO v_road_source_match_count FROM stage07_road_source_matches;
                RAISE NOTICE 'stage07_road_source_match_count count=%', v_road_source_match_count;
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_source_match_count',
                    format('count=%s', v_road_source_match_count),
                    NULL,
                    jsonb_build_object('count', v_road_source_match_count)
                );

                DROP TABLE IF EXISTS stage07_road_spatial_matches;
                CREATE TEMP TABLE stage07_road_spatial_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (s.staging_id)
                    s.staging_id,
                    p.prod_id,
                    p.prod_data,
                    3 AS match_rank,
                    false AS source_matched,
                    true AS spatial_matched,
                    (
                        s.canonical_name IS NOT NULL
                        AND p.canonical_name IS NOT NULL
                        AND lower(s.canonical_name) = lower(p.canonical_name)
                    ) AS name_matched,
                    p.manual_protected
                FROM stage07_road_staging AS s
                JOIN stage07_road_prod AS p
                    ON p.geom && ST_Expand(s.geom, 0.00015)
                   AND ST_DWithin(s.geom, p.geom, 0.00015)
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM stage07_road_source_matches AS sm
                    WHERE sm.staging_id = s.staging_id
                )
                ORDER BY s.staging_id, ST_Distance(s.geom, p.geom), p.manual_protected DESC, p.prod_id;

                CREATE INDEX stage07_road_spatial_matches_staging_id_idx
                    ON stage07_road_spatial_matches (staging_id);
                ANALYZE stage07_road_spatial_matches;

                SELECT count(*)::bigint INTO v_road_spatial_match_count FROM stage07_road_spatial_matches;
                RAISE NOTICE 'stage07_road_spatial_match_count count=%', v_road_spatial_match_count;
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_spatial_match_count',
                    format('count=%s', v_road_spatial_match_count),
                    NULL,
                    jsonb_build_object('count', v_road_spatial_match_count)
                );

                DROP TABLE IF EXISTS stage07_road_best_matches;
                CREATE TEMP TABLE stage07_road_best_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (matches.staging_id)
                    matches.*
                FROM (
                    SELECT * FROM stage07_road_source_matches
                    UNION ALL
                    SELECT * FROM stage07_road_spatial_matches
                ) AS matches
                ORDER BY matches.staging_id, matches.match_rank, matches.prod_id;

                CREATE INDEX stage07_road_best_matches_staging_id_idx
                    ON stage07_road_best_matches (staging_id);
                ANALYZE stage07_road_best_matches;

                SELECT count(*)::bigint INTO v_road_best_match_count FROM stage07_road_best_matches;
                SELECT count(*)::bigint
                INTO v_road_no_match_count
                FROM stage07_road_staging AS s
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM stage07_road_best_matches AS bm
                    WHERE bm.staging_id = s.staging_id
                );

                RAISE NOTICE 'stage07_road_best_match_count count=%', v_road_best_match_count;
                RAISE NOTICE 'stage07_road_no_match_count count=%', v_road_no_match_count;
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_best_match_count',
                    format('count=%s', v_road_best_match_count),
                    NULL,
                    jsonb_build_object('count', v_road_best_match_count)
                );
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_no_match_count',
                    format('count=%s', v_road_no_match_count),
                    NULL,
                    jsonb_build_object('count', v_road_no_match_count)
                );

                WITH classified AS (
                    SELECT
                        s.staging_id,
                        s.external_id,
                        s.staging_data,
                        s.confidence_score,
                        bm.prod_data,
                        bm.match_rank,
                        coalesce(bm.source_matched, false) AS source_matched,
                        coalesce(bm.spatial_matched, false) AS spatial_matched,
                        coalesce(bm.name_matched, false) AS name_matched,
                        coalesce(bm.manual_protected, false) AS manual_protected,
                        (
                            jsonb_strip_nulls(jsonb_build_object(
                                'canonical_name', nullif(lower(btrim(coalesce(s.canonical_name, ''))), ''),
                                'class_code', nullif(coalesce(
                                    s.staging_data->>'class_code',
                                    s.normalized_data->>'class_code',
                                    s.normalized_data->'tags'->>'highway'
                                ), ''),
                                'road_class_id', nullif(s.staging_data->>'road_class_id', ''),
                                'is_oneway', s.staging_data->'is_oneway',
                                'routing', nullif(jsonb_strip_nulls(jsonb_build_object(
                                    'access', s.normalized_data->'routing'->>'access',
                                    'vehicle', s.normalized_data->'routing'->>'vehicle',
                                    'motor_vehicle', s.normalized_data->'routing'->>'motor_vehicle',
                                    'foot', s.normalized_data->'routing'->>'foot',
                                    'bicycle', s.normalized_data->'routing'->>'bicycle',
                                    'bus', s.normalized_data->'routing'->>'bus',
                                    'surface', s.normalized_data->'routing'->>'surface'
                                )), '{}'::jsonb)
                            ))
                            IS DISTINCT FROM
                            jsonb_strip_nulls(jsonb_build_object(
                                'canonical_name', nullif(lower(btrim(coalesce(bm.prod_data->>'canonical_name', bm.prod_data->>'name', ''))), ''),
                                'class_code', nullif(coalesce(
                                    bm.prod_data->>'class_code',
                                    bm.prod_data->>'road_class',
                                    bm.prod_data->>'road_class_code',
                                    bm.prod_data->'normalized_data'->>'class_code',
                                    bm.prod_data->'source_tags'->>'highway'
                                ), ''),
                                'road_class_id', nullif(bm.prod_data->>'road_class_id', ''),
                                'is_oneway', bm.prod_data->'is_oneway',
                                'routing', nullif(jsonb_strip_nulls(jsonb_build_object(
                                    'access', coalesce(bm.prod_data->'normalized_data'->'routing'->>'access', bm.prod_data->'source_tags'->>'access', bm.prod_data->>'access'),
                                    'vehicle', coalesce(bm.prod_data->'normalized_data'->'routing'->>'vehicle', bm.prod_data->'source_tags'->>'vehicle', bm.prod_data->>'vehicle'),
                                    'motor_vehicle', coalesce(bm.prod_data->'normalized_data'->'routing'->>'motor_vehicle', bm.prod_data->'source_tags'->>'motor_vehicle', bm.prod_data->>'motor_vehicle'),
                                    'foot', coalesce(bm.prod_data->'normalized_data'->'routing'->>'foot', bm.prod_data->'source_tags'->>'foot', bm.prod_data->>'foot'),
                                    'bicycle', coalesce(bm.prod_data->'normalized_data'->'routing'->>'bicycle', bm.prod_data->'source_tags'->>'bicycle', bm.prod_data->>'bicycle'),
                                    'bus', coalesce(bm.prod_data->'normalized_data'->'routing'->>'bus', bm.prod_data->'source_tags'->>'bus', bm.prod_data->>'bus'),
                                    'surface', coalesce(bm.prod_data->'normalized_data'->'routing'->>'surface', bm.prod_data->'source_tags'->>'surface', bm.prod_data->>'surface')
                                )), '{}'::jsonb)
                            ))
                        ) AS changed
                    FROM stage07_road_staging AS s
                    LEFT JOIN stage07_road_best_matches AS bm
                        ON bm.staging_id = s.staging_id
                ),
                road_items AS (
                    SELECT
                        classified.*,
                        CASE
                            WHEN prod_data IS NULL THEN 'prod_no_match'
                            WHEN manual_protected THEN 'manual_protected'
                            WHEN source_matched AND NOT changed THEN 'prod_match'
                            WHEN source_matched AND changed THEN 'prod_conflict'
                            WHEN spatial_matched AND NOT source_matched THEN 'possible_duplicate'
                            ELSE 'prod_no_match'
                        END AS f2_result,
                        CASE
                            WHEN prod_data IS NULL THEN 'new'
                            WHEN manual_protected THEN 'changed'
                            WHEN source_matched AND NOT changed THEN 'unchanged'
                            WHEN source_matched AND changed THEN 'changed'
                            WHEN spatial_matched AND NOT source_matched THEN 'changed'
                            ELSE 'new'
                        END AS diff_type,
                        CASE
                            WHEN prod_data IS NULL THEN 'insert_candidate'
                            WHEN manual_protected THEN 'protect_manual'
                            WHEN source_matched AND NOT changed THEN 'ignore_unchanged'
                            WHEN source_matched AND changed THEN 'update_candidate'
                            WHEN spatial_matched AND NOT source_matched THEN 'possible_duplicate'
                            ELSE 'insert_candidate'
                        END AS auto_action,
                        CASE
                            WHEN source_matched AND NOT changed AND NOT manual_protected THEN 'ignored'
                            ELSE 'pending'
                        END AS review_status
                    FROM classified
                )
                INSERT INTO system.system_diff_items (
                    diff_run_id,
                    entity_family,
                    diff_type,
                    external_id,
                    local_entity_id,
                    before_data,
                    after_data,
                    confidence_score,
                    auto_action,
                    review_status,
                    created_at
                )
                SELECT
                    v_diff_run_id,
                    cfg.entity_family,
                    diff_type,
                    external_id,
                    staging_id,
                    prod_data,
                    staging_data || jsonb_build_object(
                        'f2_comparison',
                        jsonb_build_object(
                            'f2_result', f2_result,
                            'prod_match_rank', match_rank,
                            'source_matched', source_matched,
                            'spatial_matched', spatial_matched,
                            'name_matched', name_matched,
                            'manual_protected', manual_protected
                        )
                    ),
                    confidence_score,
                    auto_action,
                    review_status,
                    now()
                FROM road_items;

                GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
                v_elapsed_ms := round((extract(epoch FROM (clock_timestamp() - v_insert_start_ts)) * 1000.0)::numeric, 2);

                RAISE NOTICE 'stage07_road_inserted_count count=%', v_inserted_count;
                RAISE NOTICE 'stage07_insert_done family=% inserted=% elapsed_ms=% at=%',
                    cfg.entity_family,
                    v_inserted_count,
                    v_elapsed_ms,
                    clock_timestamp();
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'road_inserted_count',
                    format('count=%s', v_inserted_count),
                    v_elapsed_ms,
                    jsonb_build_object('count', v_inserted_count)
                );
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'insert_done',
                    format('inserted=%s diff_run_id=%s', v_inserted_count, v_diff_run_id),
                    v_elapsed_ms,
                    jsonb_build_object(
                        'diff_run_id', v_diff_run_id,
                        'inserted', v_inserted_count,
                        'source_matches', v_road_source_match_count,
                        'spatial_matches', v_road_spatial_match_count,
                        'best_matches', v_road_best_match_count,
                        'no_matches', v_road_no_match_count
                    )
                );
            EXCEPTION
                WHEN OTHERS THEN
                    UPDATE system.system_diff_runs AS run
                    SET
                        status = 'failed',
                        finished_at = now(),
                        summary = run.summary || jsonb_build_object(
                            'error_sqlstate', SQLSTATE,
                            'error_message', SQLERRM
                        )
                    WHERE run.id = v_diff_run_id;

                    RAISE NOTICE 'stage07_insert_fail family=% sqlstate=% sqlerrm=% at=%',
                        cfg.entity_family,
                        SQLSTATE,
                        SQLERRM,
                        clock_timestamp();
                    PERFORM pg_temp.stage07_log(
                        cfg.entity_family,
                        'insert_fail',
                        SQLERRM,
                        NULL,
                        jsonb_build_object(
                            'diff_run_id', v_diff_run_id,
                            'sqlstate', SQLSTATE,
                            'sqlerrm', SQLERRM
                        )
                    );
                    RAISE;
            END;

            UPDATE system.system_diff_runs AS run
            SET
                status = 'completed',
                finished_at = now(),
                summary = run.summary
                    || jsonb_build_object(
                        'counts_by_diff_type',
                        coalesce((
                            SELECT jsonb_object_agg(counts.diff_type, counts.value_n)
                            FROM (
                                SELECT item.diff_type, count(*)::bigint AS value_n
                                FROM system.system_diff_items AS item
                                WHERE item.diff_run_id = v_diff_run_id
                                GROUP BY item.diff_type
                            ) AS counts
                        ), '{}'::jsonb),
                        'counts_by_auto_action',
                        coalesce((
                            SELECT jsonb_object_agg(counts.auto_action, counts.value_n)
                            FROM (
                                SELECT item.auto_action, count(*)::bigint AS value_n
                                FROM system.system_diff_items AS item
                                WHERE item.diff_run_id = v_diff_run_id
                                GROUP BY item.auto_action
                            ) AS counts
                        ), '{}'::jsonb),
                        'road_match_counts',
                        jsonb_build_object(
                            'source_matches', v_road_source_match_count,
                            'spatial_matches', v_road_spatial_match_count,
                            'best_matches', v_road_best_match_count,
                            'no_matches', v_road_no_match_count
                        ),
                        'total_items',
                        (
                            SELECT count(*)::bigint
                            FROM system.system_diff_items AS item
                            WHERE item.diff_run_id = v_diff_run_id
                        )
                    )
            WHERE run.id = v_diff_run_id;

            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'family_done',
                format('diff_run_id=%s status=completed', v_diff_run_id),
                NULL,
                jsonb_build_object('diff_run_id', v_diff_run_id)
            );

            INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
            SELECT
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                item.auto_action,
                count(*)::bigint,
                'PASS',
                'F2 roads temp-table staging-vs-prod_mirror diff items written.'
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = v_diff_run_id
            GROUP BY item.auto_action;

            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.staging_table AND column_name = 'confidence_score'
        ) INTO v_has_staging_confidence;

        SELECT cfg.staging_point_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.staging_table AND column_name = cfg.staging_point_column
        ) INTO v_has_staging_point;

        SELECT cfg.staging_geom_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.staging_table AND column_name = cfg.staging_geom_column
        ) INTO v_has_staging_geom;

        SELECT cfg.staging_geom_multi_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.staging_table AND column_name = cfg.staging_geom_multi_column
        ) INTO v_has_staging_geom_multi;

        SELECT cfg.prod_point_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_prod_mirror_schema AND table_name = cfg.prod_table AND column_name = cfg.prod_point_column
        ) INTO v_has_prod_point;

        SELECT cfg.prod_geom_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_prod_mirror_schema AND table_name = cfg.prod_table AND column_name = cfg.prod_geom_column
        ) INTO v_has_prod_geom;

        v_staging_name_expr := 'coalesce(nullif(to_jsonb(s)->>''canonical_name'', ''''), nullif(to_jsonb(s)->>''public_name'', ''''), nullif(to_jsonb(s)->>''name'', ''''), nullif(to_jsonb(s)->>''full_address'', ''''), nullif(to_jsonb(s)->>''route_code'', ''''), nullif(to_jsonb(s)->>''external_id'', ''''))';
        v_prod_name_expr := 'coalesce(nullif(to_jsonb(p)->>''canonical_name'', ''''), nullif(to_jsonb(p)->>''public_name'', ''''), nullif(to_jsonb(p)->>''name'', ''''), nullif(to_jsonb(p)->>''full_address'', ''''), nullif(to_jsonb(p)->>''route_code'', ''''), nullif(to_jsonb(p)->>''external_id'', ''''))';

        v_source_match_expr := '(coalesce(to_jsonb(p)->>''external_id'', '''') = s.external_id OR coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)::text LIKE ''%%'' || s.external_id || ''%%'' OR coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)::text LIKE ''%%'' || coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'', s.external_id) || ''%%'')';

        v_name_match_expr := format(
            '(%1$s IS NOT NULL AND %2$s IS NOT NULL AND lower(%1$s) = lower(%2$s))',
            v_staging_name_expr,
            v_prod_name_expr
        );

        v_spatial_expand_degrees := greatest(coalesce(cfg.spatial_threshold_m, 30) / 111320.0, 0.000001);

        v_spatial_match_expr := 'false';

        IF v_has_staging_point AND v_has_prod_point THEN
            v_spatial_match_expr := v_spatial_match_expr || format(
                ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s))',
                cfg.staging_point_column,
                cfg.prod_point_column,
                coalesce(cfg.spatial_threshold_m, 30),
                v_spatial_expand_degrees
            );
        END IF;

        IF v_has_staging_point AND v_has_prod_geom THEN
            v_spatial_match_expr := v_spatial_match_expr || format(
                ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s))',
                cfg.staging_point_column,
                cfg.prod_geom_column,
                coalesce(cfg.spatial_threshold_m, 30),
                v_spatial_expand_degrees
            );
        END IF;

        IF v_has_staging_geom AND v_has_prod_point THEN
            v_spatial_match_expr := v_spatial_match_expr || format(
                ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s))',
                cfg.staging_geom_column,
                cfg.prod_point_column,
                coalesce(cfg.spatial_threshold_m, 30),
                v_spatial_expand_degrees
            );
        END IF;

        IF v_has_staging_geom AND v_has_prod_geom THEN
            v_spatial_match_expr := v_spatial_match_expr || format(
                ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND (ST_Intersects(s.%1$I, p.%2$I) OR ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s)))',
                cfg.staging_geom_column,
                cfg.prod_geom_column,
                coalesce(cfg.spatial_threshold_m, 10),
                v_spatial_expand_degrees
            );
        END IF;

        IF v_has_staging_geom_multi AND v_has_prod_geom THEN
            v_spatial_match_expr := v_spatial_match_expr || format(
                ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND (ST_Intersects(s.%1$I, p.%2$I) OR ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s)))',
                cfg.staging_geom_multi_column,
                cfg.prod_geom_column,
                coalesce(cfg.spatial_threshold_m, 10),
                v_spatial_expand_degrees
            );
        END IF;

        IF cfg.entity_family = 'roads' AND v_has_staging_geom AND v_has_prod_geom THEN
            -- Road F2 matching avoids line-to-line geography distance because it
            -- is too slow for local pipeline conflict detection. Precise routing
            -- graph matching will happen later; F2 only detects production conflicts.
            v_source_match_expr := '('
                || 'nullif(s.external_id, '''') IS NOT NULL AND ('
                || 'coalesce(to_jsonb(p)->>''external_id'', '''') = s.external_id'
                || ' OR coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''external_id'' = s.external_id'
                || ' OR coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_external_id'' = s.external_id'
                || ' OR (nullif(coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'', ''''), '''') IS NOT NULL'
                || '     AND coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_id'' = coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id''))'
                || ' OR (nullif(coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type'', ''''), '''') IS NOT NULL'
                || '     AND nullif(coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'', ''''), '''') IS NOT NULL'
                || '     AND coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_feature_type'' = coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type'')'
                || '     AND coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_id'' = coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id''))'
                || '))';

            v_road_intersection_match_expr := format(
                '(s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, 0.00015) AND ST_Intersects(s.%1$I, p.%2$I))',
                cfg.staging_geom_column,
                cfg.prod_geom_column
            );

            v_road_distance_match_expr := format(
                '(s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, 0.00015) AND ST_DWithin(s.%1$I, p.%2$I, 0.00015))',
                cfg.staging_geom_column,
                cfg.prod_geom_column
            );

            v_spatial_match_expr := format(
                '(%s OR %s)',
                v_road_intersection_match_expr,
                v_road_distance_match_expr
            );
            v_match_where := format(
                '(%s OR %s OR %s)',
                v_source_match_expr,
                v_road_intersection_match_expr,
                v_road_distance_match_expr
            );
            v_match_rank_expr := format(
                'CASE WHEN %1$s THEN 1 WHEN %2$s THEN 2 WHEN %3$s THEN 3 ELSE 9 END',
                v_source_match_expr,
                v_road_intersection_match_expr,
                v_road_distance_match_expr
            );
        ELSIF cfg.entity_family = 'buildings' AND v_has_staging_geom AND v_has_prod_geom THEN
            -- Building polygons can be numerous, so avoid polygon::geography
            -- distance checks here. For F2 conflict detection, polygon overlap
            -- plus centroid proximity is enough to identify likely matches.
            v_building_centroid_target_expr := CASE
                WHEN v_has_prod_point THEN format('COALESCE(p.%1$I, ST_PointOnSurface(p.%2$I))', cfg.prod_point_column, cfg.prod_geom_column)
                ELSE format('ST_PointOnSurface(p.%1$I)', cfg.prod_geom_column)
            END;

            v_building_intersection_match_expr := format(
                '(s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND s.%1$I && ST_Expand(p.%2$I, 0.0002) AND s.%1$I && p.%2$I AND ST_Intersects(s.%1$I, p.%2$I))',
                cfg.staging_geom_column,
                cfg.prod_geom_column
            );

            v_building_centroid_match_expr := format(
                '(s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND s.%1$I && ST_Expand(p.%2$I, 0.0002) AND ST_DWithin(ST_PointOnSurface(s.%1$I)::geography, %3$s::geography, %4$s))',
                cfg.staging_geom_column,
                cfg.prod_geom_column,
                v_building_centroid_target_expr,
                coalesce(cfg.spatial_threshold_m, 10)
            );

            v_spatial_match_expr := format(
                '(%s OR %s)',
                v_building_intersection_match_expr,
                v_building_centroid_match_expr
            );
            v_match_where := format(
                '(%s OR %s OR %s)',
                v_source_match_expr,
                v_building_intersection_match_expr,
                v_building_centroid_match_expr
            );
            v_match_rank_expr := format(
                'CASE WHEN %1$s THEN 1 WHEN %2$s THEN 2 WHEN %3$s THEN 3 ELSE 9 END',
                v_source_match_expr,
                v_building_intersection_match_expr,
                v_building_centroid_match_expr
            );
        ELSE
            v_match_where := format('(%s OR %s OR (%s AND (%s)))', v_source_match_expr, v_spatial_match_expr, v_name_match_expr, v_spatial_match_expr);
            v_match_rank_expr := format(
                'CASE WHEN %1$s THEN 1 WHEN (%2$s AND (%3$s)) THEN 2 WHEN %2$s THEN 3 ELSE 9 END',
                v_source_match_expr,
                v_spatial_match_expr,
                v_name_match_expr
            );
        END IF;

        v_changed_expr := format(
            '(to_jsonb(s) - ''id'' - ''source_snapshot_id'' - ''raw_id'' - ''created_at'' - ''updated_at'' - ''match_status'' - ''review_status'' - ''auto_action'' - ''source_refs'' - ''confidence_score'' - ''geom'' - ''geom_multi'' - ''point_geom'' - ''footprint_geom'' - ''centroid'' IS DISTINCT FROM to_jsonb(p) - ''id'' - ''public_id'' - ''created_at'' - ''updated_at'' - ''deleted_at'' - ''source_refs'' - ''geom'' - ''point_geom'' - ''centroid'')'
        );

        v_manual_expr := '(CASE WHEN to_jsonb(p)->>''is_verified'' IN (''true'', ''false'') THEN (to_jsonb(p)->>''is_verified'')::boolean ELSE false END OR CASE WHEN to_jsonb(p)->>''manual_override'' IN (''true'', ''false'') THEN (to_jsonb(p)->>''manual_override'')::boolean ELSE false END OR coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)::text ILIKE ''%%manual_dashboard%%'' OR coalesce(to_jsonb(p)->>''source_type'', '''') ILIKE ''%%manual%%'' OR coalesce(to_jsonb(p)->>''source_type'', '''') ILIKE ''%%dashboard%%'')';

        IF v_has_staging_confidence THEN
            v_confidence_expr := 'coalesce(s.confidence_score, 50.0000)';
        ELSE
            v_confidence_expr := '50.0000';
        END IF;

        q := format(
            $q$
            WITH staging_rows AS (
                SELECT *
                FROM %1$I.%2$I
                WHERE source_snapshot_id = $2
            ),
            matched AS (
                SELECT
                    s.id AS staging_id,
                    s.external_id,
                    to_jsonb(s) AS staging_data,
                    %3$s AS confidence_score,
                    prod_match.prod_data,
                    prod_match.match_rank,
                    prod_match.source_matched,
                    prod_match.spatial_matched,
                    prod_match.name_matched,
                    prod_match.manual_protected,
                    prod_match.changed
                FROM staging_rows AS s
                LEFT JOIN LATERAL (
                    SELECT
                        to_jsonb(p) AS prod_data,
                        %4$s AS match_rank,
                        %5$s AS source_matched,
                        (%6$s) AS spatial_matched,
                        (%7$s) AS name_matched,
                        (%8$s) AS manual_protected,
                        (%9$s) AS changed
                    FROM %10$I.%11$I AS p
                    WHERE %12$s
                    ORDER BY
                        %4$s,
                        CASE WHEN %8$s THEN 0 ELSE 1 END
                    LIMIT 1
                ) AS prod_match ON true
            ),
            classified AS (
                SELECT
                    matched.*,
                    CASE
                        WHEN matched.prod_data IS NULL THEN 'prod_no_match'
                        WHEN %15$L = 'roads' AND NOT matched.source_matched AND matched.spatial_matched THEN 'possible_duplicate'
                        WHEN %15$L = 'roads' AND matched.source_matched AND matched.changed THEN 'prod_conflict'
                        WHEN %15$L = 'roads' AND matched.source_matched THEN 'prod_match'
                        WHEN matched.manual_protected THEN 'manual_protected'
                        WHEN NOT matched.source_matched AND matched.spatial_matched THEN 'possible_duplicate'
                        WHEN %14$L::boolean THEN 'needs_review'
                        WHEN matched.changed THEN 'prod_conflict'
                        ELSE 'prod_match'
                    END AS f2_result,
                    CASE
                        WHEN matched.prod_data IS NULL THEN 'new'
                        WHEN %15$L = 'roads' AND NOT matched.source_matched AND matched.spatial_matched THEN 'changed'
                        WHEN %15$L = 'roads' AND matched.source_matched AND matched.changed THEN 'changed'
                        WHEN %15$L = 'roads' AND matched.source_matched THEN 'unchanged'
                        WHEN matched.manual_protected THEN 'changed'
                        WHEN NOT matched.source_matched AND matched.spatial_matched THEN 'changed'
                        WHEN %14$L::boolean THEN 'changed'
                        WHEN matched.changed THEN 'changed'
                        ELSE 'unchanged'
                    END AS diff_type,
                    CASE
                        WHEN matched.prod_data IS NULL THEN 'insert_candidate'
                        WHEN %15$L = 'roads' AND NOT matched.source_matched AND matched.spatial_matched THEN 'possible_duplicate'
                        WHEN %15$L = 'roads' AND matched.source_matched AND matched.changed THEN 'update_candidate'
                        WHEN %15$L = 'roads' AND matched.source_matched THEN 'ignore_unchanged'
                        WHEN matched.manual_protected THEN 'protect_manual'
                        WHEN NOT matched.source_matched AND matched.spatial_matched THEN 'possible_duplicate'
                        WHEN %14$L::boolean THEN 'needs_review'
                        WHEN matched.changed THEN 'update_candidate'
                        ELSE 'ignore_unchanged'
                    END AS auto_action,
                    CASE
                        WHEN %15$L = 'roads' AND matched.prod_data IS NOT NULL AND matched.source_matched AND NOT matched.changed THEN 'ignored'
                        WHEN matched.prod_data IS NOT NULL AND NOT matched.manual_protected AND matched.source_matched AND NOT matched.changed THEN 'ignored'
                        ELSE 'pending'
                    END AS review_status
                FROM matched
            )
            INSERT INTO system.system_diff_items (
                diff_run_id,
                entity_family,
                diff_type,
                external_id,
                local_entity_id,
                before_data,
                after_data,
                confidence_score,
                auto_action,
                review_status,
                created_at
            )
            SELECT
                $1,
                %15$L,
                diff_type,
                external_id,
                staging_id,
                prod_data,
                staging_data || jsonb_build_object(
                    'f2_comparison',
                    jsonb_build_object(
                        'f2_result', f2_result,
                        'prod_match_rank', match_rank,
                        'source_matched', coalesce(source_matched, false),
                        'spatial_matched', coalesce(spatial_matched, false),
                        'name_matched', coalesce(name_matched, false),
                        'manual_protected', coalesce(manual_protected, false)
                    )
                ),
                confidence_score,
                auto_action,
                review_status,
                now()
            FROM classified
            $q$,
            v_staging_schema,
            cfg.staging_table,
            v_confidence_expr,
            v_match_rank_expr,
            v_source_match_expr,
            v_spatial_match_expr,
            v_name_match_expr,
            v_manual_expr,
            v_changed_expr,
            v_prod_mirror_schema,
            cfg.prod_table,
            v_match_where,
            cfg.sensitive,
            cfg.conservative,
            cfg.entity_family
        );

        RAISE NOTICE 'stage07_insert_start family=% diff_run_id=% at=%',
            cfg.entity_family,
            v_diff_run_id,
            clock_timestamp();
        PERFORM pg_temp.stage07_log(
            cfg.entity_family,
            'insert_start',
            format('diff_run_id=%s', v_diff_run_id),
            NULL,
            jsonb_build_object('diff_run_id', v_diff_run_id)
        );

        BEGIN
            v_insert_start_ts := clock_timestamp();
            EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id;
            GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
            v_elapsed_ms := round((extract(epoch FROM (clock_timestamp() - v_insert_start_ts)) * 1000.0)::numeric, 2);

            RAISE NOTICE 'stage07_insert_done family=% inserted=% elapsed_ms=% at=%',
                cfg.entity_family,
                v_inserted_count,
                v_elapsed_ms,
                clock_timestamp();
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'insert_done',
                format('inserted=%s diff_run_id=%s', v_inserted_count, v_diff_run_id),
                v_elapsed_ms,
                jsonb_build_object('diff_run_id', v_diff_run_id, 'inserted', v_inserted_count)
            );
        EXCEPTION
            WHEN OTHERS THEN
                UPDATE system.system_diff_runs AS run
                SET
                    status = 'failed',
                    finished_at = now(),
                    summary = run.summary || jsonb_build_object(
                        'error_sqlstate', SQLSTATE,
                        'error_message', SQLERRM
                    )
                WHERE run.id = v_diff_run_id;

                RAISE NOTICE 'stage07_insert_fail family=% sqlstate=% sqlerrm=% at=%',
                    cfg.entity_family,
                    SQLSTATE,
                    SQLERRM,
                    clock_timestamp();
                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'insert_fail',
                    SQLERRM,
                    NULL,
                    jsonb_build_object(
                        'diff_run_id', v_diff_run_id,
                        'sqlstate', SQLSTATE,
                        'sqlerrm', SQLERRM
                    )
                );
                RAISE;
        END;

        UPDATE system.system_diff_runs AS run
        SET
            status = 'completed',
            finished_at = now(),
            summary = run.summary
                || jsonb_build_object(
                    'counts_by_diff_type',
                    coalesce((
                        SELECT jsonb_object_agg(counts.diff_type, counts.value_n)
                        FROM (
                            SELECT item.diff_type, count(*)::bigint AS value_n
                            FROM system.system_diff_items AS item
                            WHERE item.diff_run_id = v_diff_run_id
                            GROUP BY item.diff_type
                        ) AS counts
                    ), '{}'::jsonb),
                    'counts_by_auto_action',
                    coalesce((
                        SELECT jsonb_object_agg(counts.auto_action, counts.value_n)
                        FROM (
                            SELECT item.auto_action, count(*)::bigint AS value_n
                            FROM system.system_diff_items AS item
                            WHERE item.diff_run_id = v_diff_run_id
                            GROUP BY item.auto_action
                        ) AS counts
                    ), '{}'::jsonb),
                    'total_items',
                    (
                        SELECT count(*)::bigint
                        FROM system.system_diff_items AS item
                        WHERE item.diff_run_id = v_diff_run_id
                    )
                )
        WHERE run.id = v_diff_run_id;

        PERFORM pg_temp.stage07_log(
            cfg.entity_family,
            'family_done',
            format('diff_run_id=%s status=completed', v_diff_run_id),
            NULL,
            jsonb_build_object('diff_run_id', v_diff_run_id)
        );

        INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
        SELECT
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.staging_table),
            format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
            item.auto_action,
            count(*)::bigint,
            'PASS',
            'F2 staging-vs-prod_mirror diff items written.'
        FROM system.system_diff_items AS item
        WHERE item.diff_run_id = v_diff_run_id
        GROUP BY item.auto_action;
    END LOOP;

    RAISE NOTICE 'stage07_compare_end at=%', clock_timestamp();
    PERFORM pg_temp.stage07_log(
        NULL,
        'compare_end',
        'Stage F2 entity comparisons finished',
        NULL,
        jsonb_build_object('only_entity_family', v_only_entity_family)
    );
END
$stage07_compare$;

SELECT
    'stage07_context' AS section,
    current_snapshot_id,
    snapshot_version,
    region_code,
    prod_mirror_schema
FROM stage07_context;

SELECT
    'stage07_diff_runs' AS section,
    entity_family,
    staging_table,
    prod_table,
    diff_run_id,
    staging_rows,
    prod_rows
FROM stage07_diff_runs
ORDER BY entity_family;

SELECT
    'stage07_report' AS section,
    entity_family,
    staging_table,
    prod_table,
    auto_action,
    value_n,
    status,
    note
FROM stage07_report
ORDER BY
    entity_family,
    CASE auto_action
        WHEN 'ready' THEN 1
        WHEN 'staging_rows' THEN 2
        WHEN 'prod_rows' THEN 3
        WHEN 'insert_candidate' THEN 4
        WHEN 'update_candidate' THEN 5
        WHEN 'ignore_unchanged' THEN 6
        WHEN 'needs_review' THEN 7
        WHEN 'protect_manual' THEN 8
        WHEN 'possible_duplicate' THEN 9
        ELSE 99
    END;

SELECT
    'stage07_counts_by_entity_auto_action_diff_type' AS section,
    run.entity_family,
    item.auto_action,
    item.diff_type,
    count(*)::bigint AS item_count
FROM system.system_diff_runs AS run
JOIN system.system_diff_items AS item
    ON item.diff_run_id = run.id
JOIN stage07_context AS ctx
    ON ctx.current_snapshot_id = run.current_snapshot_id
WHERE run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
GROUP BY run.entity_family, item.auto_action, item.diff_type
ORDER BY run.entity_family, item.auto_action, item.diff_type;

SELECT
    'stage07_summary' AS section,
    (SELECT current_snapshot_id FROM stage07_context) AS current_snapshot_id,
    (SELECT snapshot_version FROM stage07_context) AS snapshot_version,
    (SELECT count(*) FROM stage07_diff_runs) AS diff_run_count,
    (
        SELECT count(*)::bigint
        FROM system.system_diff_items AS item
        JOIN system.system_diff_runs AS run
            ON run.id = item.diff_run_id
        JOIN stage07_context AS ctx
            ON ctx.current_snapshot_id = run.current_snapshot_id
        WHERE run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
    ) AS diff_item_count,
    (SELECT count(*) FROM stage07_report WHERE status = 'WARN') AS warn_count,
    (SELECT count(*) FROM stage07_report WHERE status = 'FAIL') AS fail_count,
    CASE
        WHEN (SELECT count(*) FROM stage07_report WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN (SELECT count(*) FROM stage07_report WHERE status = 'WARN') > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status;

SELECT
    'stage07_debug_log' AS section,
    event_at,
    entity_family,
    event_type,
    message,
    elapsed_ms,
    details
FROM stage07_debug_log
ORDER BY event_at;

-- Verification only: if road F2 is still slow, confirm these local indexes
-- exist before rerunning. Do not apply them from this comparison script.
--
-- CREATE INDEX IF NOT EXISTS staging_road_candidates_geom_gix
--     ON staging.staging_road_candidates USING gist (geom);
--
-- CREATE INDEX IF NOT EXISTS core_streets_geom_gix
--     ON prod_mirror.core_streets USING gist (geom);

COMMIT;
