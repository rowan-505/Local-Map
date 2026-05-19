-- =============================================================================
-- Stage 06: diff_current_vs_previous (F1)
-- Compare current OSM staging candidates to the previous OSM staging snapshot.
--
-- Scope:
--   - Local database only.
--   - Snapshot-vs-snapshot only: current OSM staging vs previous OSM staging.
--   - Writes only system.system_diff_runs and system.system_diff_items.
--   - Does not touch staging rows, core, or Supabase.
--
-- Input psql variables:
--   snapshot_version
--   staging_schema optional, defaults to staging
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage06_params (
    snapshot_version text,
    staging_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage06_params;

INSERT INTO stage06_params (
    snapshot_version,
    staging_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE IF NOT EXISTS stage06_context (
    current_snapshot_id bigint NOT NULL,
    current_snapshot_version text,
    previous_snapshot_id bigint,
    previous_snapshot_version text,
    source_registry_id bigint NOT NULL,
    region_code text,
    is_first_snapshot boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage06_context;

CREATE TEMP TABLE IF NOT EXISTS stage06_report (
    entity_family text,
    target_table text,
    diff_type text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

TRUNCATE stage06_report;

CREATE TEMP TABLE IF NOT EXISTS stage06_diff_runs (
    entity_family text NOT NULL,
    target_table text NOT NULL,
    diff_run_id bigint NOT NULL,
    current_rows bigint NOT NULL,
    previous_rows bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage06_diff_runs;

CREATE TEMP TABLE IF NOT EXISTS stage06_family_config (
    entity_family text NOT NULL,
    target_table text NOT NULL,
    required_table boolean NOT NULL DEFAULT false,
    point_column text,
    centroid_column text,
    geom_column text,
    geom_multi_column text,
    point_threshold_m numeric,
    geom_threshold_m numeric,
    length_column text,
    length_abs_threshold_m numeric,
    length_pct_threshold numeric,
    area_column text,
    area_pct_threshold numeric,
    admin_needs_review boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

TRUNCATE stage06_family_config;

INSERT INTO stage06_family_config (
    entity_family,
    target_table,
    required_table,
    point_column,
    centroid_column,
    geom_column,
    geom_multi_column,
    point_threshold_m,
    geom_threshold_m,
    length_column,
    length_abs_threshold_m,
    length_pct_threshold,
    area_column,
    area_pct_threshold,
    admin_needs_review
)
VALUES
    ('places', 'staging_place_candidates', true, 'point_geom', NULL, 'footprint_geom', NULL, 10, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('roads', 'staging_road_candidates', true, NULL, NULL, 'geom', NULL, NULL, 5, 'length_m', 5, 0.05, NULL, NULL, false),
    ('buildings', 'staging_building_candidates', true, NULL, 'centroid', 'geom', NULL, 5, 5, NULL, NULL, NULL, 'area_m2', 0.10, false),
    ('landuse', 'staging_landuse_candidates', false, NULL, NULL, 'geom', NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('water_lines', 'staging_water_line_candidates', false, NULL, NULL, 'geom', NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('water_polygons', 'staging_water_polygon_candidates', false, NULL, NULL, 'geom', NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('admin_areas', 'staging_admin_area_candidates', false, NULL, 'centroid', 'geom', NULL, 5, 5, NULL, NULL, NULL, 'area_m2', 0.10, true),
    ('bus_stops', 'staging_bus_stop_candidates', false, 'point_geom', NULL, NULL, NULL, 10, NULL, NULL, NULL, NULL, NULL, NULL, false),
    ('bus_routes', 'staging_bus_route_candidates', false, NULL, NULL, 'geom', NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('addresses', 'staging_address_candidates', false, 'point_geom', NULL, 'geom', NULL, 10, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('routing_roads', 'staging_routing_road_candidates', false, NULL, NULL, 'geom', 'geom_multi', NULL, 5, 'length_m', 5, 0.05, NULL, NULL, false),
    ('routing_turn_restrictions', 'staging_routing_turn_restriction_candidates', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false),
    ('routing_barriers', 'staging_routing_barrier_candidates', false, 'point_geom', NULL, 'geom', NULL, 5, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('bus_route_variants', 'staging_bus_route_variant_candidates', false, NULL, NULL, 'geom', NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, false),
    ('bus_route_stops', 'staging_bus_route_stop_candidates', false, 'point_geom', NULL, NULL, NULL, 10, NULL, NULL, NULL, NULL, NULL, NULL, false);

DO $stage06_context$
DECLARE
    v_snapshot_version text;
BEGIN
    SELECT p.snapshot_version
    INTO v_snapshot_version
    FROM stage06_params AS p;

    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    INSERT INTO stage06_context (
        current_snapshot_id,
        current_snapshot_version,
        previous_snapshot_id,
        previous_snapshot_version,
        source_registry_id,
        region_code,
        is_first_snapshot
    )
    SELECT
        current_snapshot.id,
        current_snapshot.snapshot_version,
        previous_snapshot.id,
        previous_snapshot.snapshot_version,
        current_snapshot.source_registry_id,
        current_snapshot.region_code,
        previous_snapshot.id IS NULL
    FROM system.system_source_snapshots AS current_snapshot
    LEFT JOIN LATERAL (
        SELECT previous_candidate.*
        FROM system.system_source_snapshots AS previous_candidate
        WHERE previous_candidate.source_registry_id = current_snapshot.source_registry_id
          AND previous_candidate.region_code IS NOT DISTINCT FROM current_snapshot.region_code
          AND previous_candidate.captured_at < current_snapshot.captured_at
        ORDER BY previous_candidate.captured_at DESC, previous_candidate.id DESC
        LIMIT 1
    ) AS previous_snapshot ON true
    WHERE current_snapshot.snapshot_version = v_snapshot_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', v_snapshot_version;
    END IF;
END
$stage06_context$;

SELECT
    'stage06_snapshot_context' AS section,
    current_snapshot_id,
    current_snapshot_version,
    region_code,
    previous_snapshot_id,
    previous_snapshot_version,
    source_registry_id,
    is_first_snapshot
FROM stage06_context;

-- Rerun safety: remove only prior F1 snapshot-vs-snapshot output for this
-- current snapshot. F2 and other comparison types are preserved.
DELETE FROM system.system_diff_items AS item
USING system.system_diff_runs AS run
JOIN stage06_context AS ctx
    ON ctx.current_snapshot_id = run.current_snapshot_id
WHERE item.diff_run_id = run.id
  AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot';

DELETE FROM system.system_diff_runs AS run
USING stage06_context AS ctx
WHERE run.current_snapshot_id = ctx.current_snapshot_id
  AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot';

DO $stage06_validate_targets$
DECLARE
    v_staging_schema text;
    cfg record;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage06_params AS p;

    FOR cfg IN SELECT * FROM stage06_family_config LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, cfg.target_table)) IS NULL THEN
            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.target_table),
                'table_missing',
                0,
                CASE WHEN cfg.required_table THEN 'FAIL' ELSE 'WARN' END,
                CASE
                    WHEN cfg.required_table THEN 'Required Stage E staging table is missing.'
                    ELSE 'Optional Stage E staging table is missing; skipped this entity family.'
                END
            );

            IF cfg.required_table THEN
                RAISE EXCEPTION 'required Stage E staging table %.% is missing', v_staging_schema, cfg.target_table;
            END IF;
        ELSE
            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.target_table),
                'table_exists',
                1,
                'PASS',
                NULL
            );
        END IF;
    END LOOP;
END
$stage06_validate_targets$;

DO $stage06_create_diffs$
DECLARE
    v_staging_schema text;
    ctx stage06_context%ROWTYPE;
    cfg record;
    v_current_count bigint;
    v_previous_count bigint;
    v_diff_run_id bigint;
    v_has_confidence boolean;
    v_has_point boolean;
    v_has_centroid boolean;
    v_has_geom boolean;
    v_has_geom_multi boolean;
    v_has_length boolean;
    v_has_area boolean;
    v_compare_current_json text;
    v_compare_previous_json text;
    v_geom_changed text;
    v_length_changed text;
    v_area_changed text;
    v_change_expr text;
    v_confidence_expr text;
    q text;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage06_params AS p;

    SELECT *
    INTO STRICT ctx
    FROM stage06_context;

    FOR cfg IN SELECT * FROM stage06_family_config LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, cfg.target_table)) IS NULL THEN
            CONTINUE;
        END IF;

        q := format('SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1', v_staging_schema, cfg.target_table);
        EXECUTE q INTO v_current_count USING ctx.current_snapshot_id;

        IF ctx.previous_snapshot_id IS NULL THEN
            v_previous_count := 0;
        ELSE
            EXECUTE q INTO v_previous_count USING ctx.previous_snapshot_id;
        END IF;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        VALUES
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), 'current_rows', v_current_count, 'PASS', NULL),
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), 'previous_rows', v_previous_count, 'PASS', NULL);

        IF v_current_count = 0 AND v_previous_count = 0 THEN
            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), 'skipped_empty_family', 0, 'PASS', 'No current or previous rows; no diff_run created.');
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
            ctx.previous_snapshot_id,
            ctx.current_snapshot_id,
            cfg.entity_family,
            'running',
            now(),
            jsonb_build_object(
                'comparison_type', 'snapshot_vs_snapshot',
                'first_snapshot', ctx.is_first_snapshot,
                'current_snapshot_id', ctx.current_snapshot_id,
                'previous_snapshot_id', ctx.previous_snapshot_id,
                'current_snapshot_version', ctx.current_snapshot_version,
                'previous_snapshot_version', ctx.previous_snapshot_version,
                'region_code', ctx.region_code,
                'target_table', format('%s.%s', v_staging_schema, cfg.target_table)
            )
        )
        RETURNING id INTO v_diff_run_id;

        INSERT INTO stage06_diff_runs (entity_family, target_table, diff_run_id, current_rows, previous_rows)
        VALUES (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), v_diff_run_id, v_current_count, v_previous_count);

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = 'confidence_score'
        ) INTO v_has_confidence;

        SELECT cfg.point_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.point_column
        ) INTO v_has_point;

        SELECT cfg.centroid_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.centroid_column
        ) INTO v_has_centroid;

        SELECT cfg.geom_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.geom_column
        ) INTO v_has_geom;

        SELECT cfg.geom_multi_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.geom_multi_column
        ) INTO v_has_geom_multi;

        SELECT cfg.length_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.length_column
        ) INTO v_has_length;

        SELECT cfg.area_column IS NOT NULL AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = cfg.target_table AND column_name = cfg.area_column
        ) INTO v_has_area;

        v_compare_current_json := 'to_jsonb(c) - ''id'' - ''source_snapshot_id'' - ''raw_id'' - ''created_at'' - ''updated_at'' - ''match_status'' - ''review_status'' - ''auto_action'' - ''source_refs'' - ''confidence_score'' - ''geom'' - ''geom_multi'' - ''point_geom'' - ''footprint_geom'' - ''centroid'' - ''area_m2'' - ''length_m'' - ''matched_core_place_id'' - ''matched_core_edge_id'' - ''matched_core_admin_area_id'' - ''matched_core_bus_stop_id'' - ''matched_core_bus_route_id'' - ''matched_core_address_id''';
        v_compare_previous_json := replace(v_compare_current_json, 'to_jsonb(c)', 'to_jsonb(p)');

        v_geom_changed := 'false';

        IF v_has_point THEN
            v_geom_changed := v_geom_changed || format(
                ' OR ((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND NOT ST_DWithin(c.%1$I::geography, p.%1$I::geography, %2$s))',
                cfg.point_column,
                coalesce(cfg.point_threshold_m, 10)
            );
        END IF;

        IF v_has_centroid THEN
            v_geom_changed := v_geom_changed || format(
                ' OR ((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND NOT ST_DWithin(c.%1$I::geography, p.%1$I::geography, %2$s))',
                cfg.centroid_column,
                coalesce(cfg.point_threshold_m, 5)
            );
        END IF;

        IF v_has_geom THEN
            v_geom_changed := v_geom_changed || format(
                ' OR ((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND NOT ST_Equals(c.%1$I, p.%1$I) AND NOT ST_DWithin(c.%1$I::geography, p.%1$I::geography, %2$s))',
                cfg.geom_column,
                coalesce(cfg.geom_threshold_m, 5)
            );
        END IF;

        IF v_has_geom_multi THEN
            v_geom_changed := v_geom_changed || format(
                ' OR ((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND NOT ST_Equals(c.%1$I, p.%1$I) AND NOT ST_DWithin(c.%1$I::geography, p.%1$I::geography, %2$s))',
                cfg.geom_multi_column,
                coalesce(cfg.geom_threshold_m, 5)
            );
        END IF;

        IF v_has_length THEN
            v_length_changed := format(
                '((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND abs(c.%1$I - p.%1$I) > %2$s AND (abs(c.%1$I - p.%1$I) / greatest(abs(p.%1$I), 1)) > %3$s)',
                cfg.length_column,
                coalesce(cfg.length_abs_threshold_m, 5),
                coalesce(cfg.length_pct_threshold, 0.05)
            );
        ELSE
            v_length_changed := 'false';
        END IF;

        IF v_has_area THEN
            v_area_changed := format(
                '((c.%1$I IS NULL) <> (p.%1$I IS NULL)) OR (c.%1$I IS NOT NULL AND p.%1$I IS NOT NULL AND (abs(c.%1$I - p.%1$I) / greatest(abs(p.%1$I), 1)) > %2$s)',
                cfg.area_column,
                coalesce(cfg.area_pct_threshold, 0.10)
            );
        ELSE
            v_area_changed := 'false';
        END IF;

        v_change_expr := format(
            '(%s IS DISTINCT FROM %s) OR (%s) OR (%s) OR (%s)',
            v_compare_current_json,
            v_compare_previous_json,
            v_geom_changed,
            v_length_changed,
            v_area_changed
        );

        IF v_has_confidence THEN
            v_confidence_expr := 'CASE WHEN paired.c_id IS NULL THEN coalesce(paired.p_confidence_score, 50.0000) ELSE coalesce(paired.c_confidence_score, 50.0000) END';
        ELSE
            v_confidence_expr := '50.0000';
        END IF;

        IF ctx.previous_snapshot_id IS NULL THEN
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
                    c.external_id,
                    c.id,
                    NULL,
                    to_jsonb(c),
                    %s,
                    'insert_candidate',
                    'pending',
                    now()
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = $2
                $q$,
                cfg.entity_family,
                CASE WHEN v_has_confidence THEN 'coalesce(c.confidence_score, 50.0000)' ELSE '50.0000' END,
                v_staging_schema,
                cfg.target_table
            );
            EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id;
        ELSE
            q := format(
                $q$
                WITH current_rows AS (
                    SELECT DISTINCT ON (external_id) *
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $2
                    ORDER BY external_id, id
                ),
                previous_rows AS (
                    SELECT DISTINCT ON (external_id) *
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $3
                    ORDER BY external_id, id
                ),
                paired AS (
                    SELECT
                        c.id AS c_id,
                        p.id AS p_id,
                        coalesce(c.external_id, p.external_id) AS external_id,
                        %3$s AS c_confidence_score,
                        %4$s AS p_confidence_score,
                        to_jsonb(c) AS current_data,
                        to_jsonb(p) AS previous_data,
                        CASE
                            WHEN c.id IS NULL THEN 'deleted_candidate'
                            WHEN p.id IS NULL THEN 'new'
                            WHEN %5$s THEN 'changed'
                            ELSE 'unchanged'
                        END AS diff_type
                    FROM current_rows AS c
                    FULL OUTER JOIN previous_rows AS p
                        ON p.external_id = c.external_id
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
                    %6$L,
                    paired.diff_type,
                    paired.external_id,
                    CASE
                        WHEN paired.diff_type = 'deleted_candidate' THEN paired.p_id
                        ELSE paired.c_id
                    END,
                    CASE WHEN paired.diff_type = 'new' THEN NULL ELSE paired.previous_data END,
                    CASE WHEN paired.diff_type = 'deleted_candidate' THEN NULL ELSE paired.current_data END,
                    %7$s,
                    CASE
                        WHEN paired.diff_type = 'new' THEN 'insert_candidate'
                        WHEN paired.diff_type = 'changed' AND %8$L::boolean THEN 'needs_review'
                        WHEN paired.diff_type = 'changed' THEN 'update_candidate'
                        WHEN paired.diff_type = 'deleted_candidate' THEN 'needs_review'
                        ELSE 'ignore_unchanged'
                    END,
                    CASE
                        WHEN paired.diff_type = 'unchanged' THEN 'ignored'
                        ELSE 'pending'
                    END,
                    now()
                FROM paired
                $q$,
                v_staging_schema,
                cfg.target_table,
                CASE WHEN v_has_confidence THEN 'c.confidence_score' ELSE 'NULL::numeric' END,
                CASE WHEN v_has_confidence THEN 'p.confidence_score' ELSE 'NULL::numeric' END,
                v_change_expr,
                cfg.entity_family,
                v_confidence_expr,
                cfg.admin_needs_review
            );
            EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id, ctx.previous_snapshot_id;
        END IF;

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
                    'total_items',
                    (
                        SELECT count(*)::bigint
                        FROM system.system_diff_items AS item
                        WHERE item.diff_run_id = v_diff_run_id
                    )
                )
        WHERE run.id = v_diff_run_id;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        SELECT
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            item.diff_type,
            count(*)::bigint,
            'PASS',
            'F1 snapshot-vs-snapshot diff items written.'
        FROM system.system_diff_items AS item
        WHERE item.diff_run_id = v_diff_run_id
        GROUP BY item.diff_type;
    END LOOP;
END
$stage06_create_diffs$;

-- Child/detail tables are intentionally not diffed as separate F1 entity
-- families yet. Main family payloads retain candidate JSON; future work can
-- enrich before_data/after_data with child summaries for names/components.
DO $stage06_child_detail_counts$
DECLARE
    v_staging_schema text;
    ctx stage06_context%ROWTYPE;
    child record;
    q text;
    v_current_count bigint;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage06_params AS p;

    SELECT *
    INTO STRICT ctx
    FROM stage06_context;

    FOR child IN
        SELECT *
        FROM (
            VALUES
                ('place_names', 'staging_place_name_candidates'),
                ('road_names', 'staging_road_name_candidates'),
                ('admin_area_names', 'staging_admin_area_name_candidates'),
                ('bus_stop_names', 'staging_bus_stop_name_candidates'),
                ('bus_route_names', 'staging_bus_route_name_candidates'),
                ('address_components', 'staging_address_component_candidates'),
                ('search_names', 'staging_search_name_candidates'),
                ('search_addresses', 'staging_search_address_candidates')
        ) AS child_tables(entity_family, table_name)
    LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, child.table_name)) IS NULL THEN
            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (
                child.entity_family,
                format('%s.%s', v_staging_schema, child.table_name),
                'child_table_missing',
                0,
                'WARN',
                'Child/detail or derived search table missing; not diffed separately in F1.'
            );
        ELSE
            q := format(
                'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
                v_staging_schema,
                child.table_name
            );
            EXECUTE q INTO v_current_count USING ctx.current_snapshot_id;

            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (
                child.entity_family,
                format('%s.%s', v_staging_schema, child.table_name),
                'current_rows_report_only',
                v_current_count,
                'PASS',
                'Reported only; child/detail and derived search tables are covered through parent families or later work.'
            );
        END IF;
    END LOOP;
END
$stage06_child_detail_counts$;

SELECT
    'stage06_snapshot_context' AS section,
    current_snapshot_id,
    current_snapshot_version,
    region_code,
    previous_snapshot_id,
    previous_snapshot_version,
    source_registry_id,
    is_first_snapshot
FROM stage06_context;

SELECT
    'stage06_diff_runs' AS section,
    entity_family,
    target_table,
    diff_run_id,
    current_rows,
    previous_rows
FROM stage06_diff_runs
ORDER BY entity_family;

SELECT
    'stage06_counts_by_entity_and_diff_type' AS section,
    entity_family,
    target_table,
    diff_type,
    value_n,
    status,
    note
FROM stage06_report
ORDER BY
    entity_family,
    CASE diff_type
        WHEN 'table_exists' THEN 1
        WHEN 'current_rows' THEN 2
        WHEN 'previous_rows' THEN 3
        WHEN 'new' THEN 4
        WHEN 'changed' THEN 5
        WHEN 'deleted_candidate' THEN 6
        WHEN 'unchanged' THEN 7
        ELSE 99
    END,
    target_table;

SELECT
    'stage06_summary' AS section,
    (SELECT current_snapshot_id FROM stage06_context) AS current_snapshot_id,
    (SELECT current_snapshot_version FROM stage06_context) AS current_snapshot_version,
    (SELECT previous_snapshot_id FROM stage06_context) AS previous_snapshot_id,
    (SELECT previous_snapshot_version FROM stage06_context) AS previous_snapshot_version,
    (SELECT count(*) FROM stage06_diff_runs) AS diff_run_count,
    (SELECT coalesce(sum(value_n), 0) FROM stage06_report WHERE diff_type IN ('new', 'changed', 'deleted_candidate', 'unchanged')) AS diff_item_count,
    (SELECT count(*) FROM stage06_report WHERE status = 'WARN') AS warn_count,
    (SELECT count(*) FROM stage06_report WHERE status = 'FAIL') AS fail_count,
    CASE
        WHEN (SELECT count(*) FROM stage06_report WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN (SELECT count(*) FROM stage06_report WHERE status = 'WARN') > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status;

COMMIT;
