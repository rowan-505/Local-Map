-- =============================================================================
-- Stage 10: summary_report (read-only)
-- Local OSM pipeline summary for one snapshot_version.
--
-- Scope:
--   - Read-only (temporary helper tables only).
--   - Does not modify staging, raw, core, prod_mirror, or Supabase.
--
-- Note: staging.confidence_score is documented as 0–100 (production-aligned); this script does not interpret scores.
--
-- Input psql variables:
--   snapshot_version (required)
--   staging_schema, raw_schema, system_schema, tmp_import_schema optional
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif
\if :{?system_schema}
\else
\set system_schema 'system'
\endif
\if :{?tmp_import_schema}
\else
\set tmp_import_schema 'tmp_import'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage10_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL,
    system_schema text NOT NULL,
    tmp_import_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_params;

INSERT INTO stage10_params (
    snapshot_version,
    staging_schema,
    raw_schema,
    system_schema,
    tmp_import_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw'),
    coalesce(NULLIF(btrim(:'system_schema'), ''), 'system'),
    coalesce(NULLIF(btrim(:'tmp_import_schema'), ''), 'tmp_import')
);

DO $stage10_params$
BEGIN
    IF (SELECT snapshot_version IS NULL FROM stage10_params LIMIT 1) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
END
$stage10_params$;

CREATE TEMP TABLE IF NOT EXISTS stage10_context (
    snapshot_id bigint NOT NULL PRIMARY KEY,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL,
    system_schema text NOT NULL,
    tmp_import_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_context;

DO $stage10_resolve$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*)::integer
    INTO v_n
    FROM system.system_source_snapshots AS s
    INNER JOIN stage10_params AS p
        ON p.snapshot_version = s.snapshot_version;

    IF v_n = 0 THEN
        RAISE EXCEPTION
            'snapshot_version "%" not found in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage10_params LIMIT 1);
    END IF;

    IF v_n > 1 THEN
        RAISE EXCEPTION
            'snapshot_version "%" is ambiguous (% rows) in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage10_params LIMIT 1),
            v_n;
    END IF;

    INSERT INTO stage10_context (
        snapshot_id,
        snapshot_version,
        staging_schema,
        raw_schema,
        system_schema,
        tmp_import_schema
    )
    SELECT
        s.id,
        s.snapshot_version,
        p.staging_schema,
        p.raw_schema,
        p.system_schema,
        p.tmp_import_schema
    FROM system.system_source_snapshots AS s
    INNER JOIN stage10_params AS p
        ON p.snapshot_version = s.snapshot_version;
END
$stage10_resolve$;

CREATE TEMP TABLE IF NOT EXISTS stage10_manifest (
    entity_family text PRIMARY KEY,
    base_table text NOT NULL,
    nc_view text NOT NULL,
    rv_view text NOT NULL,
    mn_view text
) ON COMMIT DROP;

TRUNCATE stage10_manifest;

INSERT INTO stage10_manifest (
    entity_family,
    base_table,
    nc_view,
    rv_view,
    mn_view
)
VALUES
    ('places', 'staging_place_candidates', 'v_no_conflict_place_candidates', 'v_review_place_conflicts', 'v_manual_protected_place_candidates'),
    ('roads', 'staging_road_candidates', 'v_no_conflict_road_candidates', 'v_review_road_conflicts', 'v_manual_protected_road_candidates'),
    ('buildings', 'staging_building_candidates', 'v_no_conflict_building_candidates', 'v_review_building_conflicts', 'v_manual_protected_building_candidates'),
    ('landuse', 'staging_landuse_candidates', 'v_no_conflict_landuse_candidates', 'v_review_landuse_conflicts', 'v_manual_protected_landuse_candidates'),
    ('water_lines', 'staging_water_line_candidates', 'v_no_conflict_water_line_candidates', 'v_review_water_line_conflicts', NULL),
    ('water_polygons', 'staging_water_polygon_candidates', 'v_no_conflict_water_polygon_candidates', 'v_review_water_polygon_conflicts', NULL),
    ('admin_areas', 'staging_admin_area_candidates', 'v_no_conflict_admin_area_candidates', 'v_review_admin_area_conflicts', NULL),
    ('bus_stops', 'staging_bus_stop_candidates', 'v_no_conflict_bus_stop_candidates', 'v_review_bus_stop_conflicts', NULL),
    ('addresses', 'staging_address_candidates', 'v_no_conflict_address_candidates', 'v_review_address_conflicts', NULL),
    ('routing_barriers', 'staging_routing_barrier_candidates', 'v_no_conflict_routing_barrier_candidates', 'v_review_routing_barrier_conflicts', NULL);

CREATE TEMP TABLE IF NOT EXISTS stage10_snapshot_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    boundary_id bigint,
    source_registry_id bigint NOT NULL,
    captured_at timestamptz NOT NULL,
    import_batch_id bigint NOT NULL,
    import_batch_name text,
    import_batch_status text,
    import_batch_trigger_type text,
    import_batch_started_at timestamptz,
    import_batch_finished_at timestamptz
) ON COMMIT DROP;

TRUNCATE stage10_snapshot_context;

CREATE TEMP TABLE IF NOT EXISTS stage10_layer_counts (
    layer_kind text NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    row_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_layer_counts;

CREATE TEMP TABLE IF NOT EXISTS stage10_staging_status_summary (
    staging_table text NOT NULL,
    match_status text,
    auto_action text,
    review_status text,
    row_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_staging_status_summary;

CREATE TEMP TABLE IF NOT EXISTS stage10_review_workload (
    entity_family text NOT NULL,
    no_conflict_count bigint NOT NULL,
    review_or_conflict_count bigint NOT NULL,
    manual_protected_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_review_workload;

CREATE TEMP TABLE IF NOT EXISTS stage10_warnings (
    warning_type text NOT NULL,
    entity_scope text NOT NULL,
    metric text NOT NULL,
    value_n bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage10_warnings;

DO $stage10_dynamic$
DECLARE
    ctx stage10_context%ROWTYPE;
    v_has_boundary boolean;
    v_sql text;
    r record;
    v_reg oid;
    v_has_snap_col boolean;
    v_has_match boolean;
    v_has_auto boolean;
    v_has_review boolean;
    v_nc bigint;
    v_rv bigint;
    v_mn bigint;
    v_nc_view_exists boolean;
    v_rv_view_exists boolean;
    v_mn_view_exists boolean;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage10_context;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = ctx.system_schema
          AND c.table_name = 'system_source_snapshots'
          AND c.column_name = 'boundary_id'
    )
    INTO v_has_boundary;

    v_sql := format(
        $q$
        INSERT INTO stage10_snapshot_context (
            source_snapshot_id,
            snapshot_version,
            region_code,
            boundary_id,
            source_registry_id,
            captured_at,
            import_batch_id,
            import_batch_name,
            import_batch_status,
            import_batch_trigger_type,
            import_batch_started_at,
            import_batch_finished_at
        )
        SELECT
            s.id,
            s.snapshot_version,
            s.region_code,
            %s,
            s.source_registry_id,
            s.captured_at,
            s.import_batch_id,
            b.batch_name,
            b.status,
            b.trigger_type,
            b.started_at,
            b.finished_at
        FROM %I.system_source_snapshots AS s
        LEFT JOIN %I.system_import_batches AS b
            ON b.id = s.import_batch_id
        WHERE s.id = %s
        $q$,
        CASE WHEN v_has_boundary THEN 's.boundary_id' ELSE 'NULL::bigint' END,
        ctx.system_schema,
        ctx.system_schema,
        ctx.snapshot_id
    );

    EXECUTE v_sql;

    FOR r IN
        SELECT DISTINCT c.table_name AS tname
        FROM information_schema.columns AS c
        WHERE c.table_schema = ctx.raw_schema
          AND c.column_name = 'source_snapshot_id'
        ORDER BY c.table_name
    LOOP
        v_reg := to_regclass(format('%I.%I', ctx.raw_schema, r.tname));
        IF v_reg IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            $q$
            INSERT INTO stage10_layer_counts (layer_kind, schema_name, table_name, row_count)
            SELECT 'raw_table', %L, %L, count(*)::bigint
            FROM %I.%I AS t
            WHERE t.source_snapshot_id = %s
            $q$,
            ctx.raw_schema,
            r.tname,
            ctx.raw_schema,
            r.tname,
            ctx.snapshot_id
        );
    END LOOP;

    FOR r IN
        SELECT DISTINCT c.table_name AS tname
        FROM information_schema.columns AS c
        WHERE c.table_schema = ctx.tmp_import_schema
          AND c.column_name = 'source_snapshot_id'
        ORDER BY c.table_name
    LOOP
        v_reg := to_regclass(format('%I.%I', ctx.tmp_import_schema, r.tname));
        IF v_reg IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            $q$
            INSERT INTO stage10_layer_counts (layer_kind, schema_name, table_name, row_count)
            SELECT 'tmp_import_table', %L, %L, count(*)::bigint
            FROM %I.%I AS t
            WHERE t.source_snapshot_id = %s
            $q$,
            ctx.tmp_import_schema,
            r.tname,
            ctx.tmp_import_schema,
            r.tname,
            ctx.snapshot_id
        );
    END LOOP;

    FOR r IN
        SELECT base_table FROM stage10_manifest ORDER BY entity_family
    LOOP
        v_reg := to_regclass(format('%I.%I', ctx.staging_schema, r.base_table));
        IF v_reg IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            $q$
            INSERT INTO stage10_layer_counts (layer_kind, schema_name, table_name, row_count)
            SELECT 'staging_candidate', %L, %L, count(*)::bigint
            FROM %I.%I AS t
            WHERE t.source_snapshot_id = %s
            $q$,
            ctx.staging_schema,
            r.base_table,
            ctx.staging_schema,
            r.base_table,
            ctx.snapshot_id
        );

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.base_table
              AND c.column_name = 'source_snapshot_id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.base_table
              AND c.column_name = 'match_status'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.base_table
              AND c.column_name = 'auto_action'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.base_table
              AND c.column_name = 'review_status'
        )
        INTO v_has_snap_col, v_has_match, v_has_auto, v_has_review;

        IF v_has_snap_col AND v_has_match THEN
            IF v_has_auto AND v_has_review THEN
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_staging_status_summary (
                        staging_table,
                        match_status,
                        auto_action,
                        review_status,
                        row_count
                    )
                    SELECT
                        %L,
                        c.match_status,
                        c.auto_action,
                        c.review_status,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                    GROUP BY c.match_status, c.auto_action, c.review_status
                    $q$,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            ELSIF v_has_auto THEN
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_staging_status_summary (
                        staging_table,
                        match_status,
                        auto_action,
                        review_status,
                        row_count
                    )
                    SELECT
                        %L,
                        c.match_status,
                        c.auto_action,
                        NULL::text,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                    GROUP BY c.match_status, c.auto_action
                    $q$,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            ELSIF v_has_review THEN
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_staging_status_summary (
                        staging_table,
                        match_status,
                        auto_action,
                        review_status,
                        row_count
                    )
                    SELECT
                        %L,
                        c.match_status,
                        NULL::text,
                        c.review_status,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                    GROUP BY c.match_status, c.review_status
                    $q$,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            ELSE
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_staging_status_summary (
                        staging_table,
                        match_status,
                        auto_action,
                        review_status,
                        row_count
                    )
                    SELECT
                        %L,
                        c.match_status,
                        NULL::text,
                        NULL::text,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                    GROUP BY c.match_status
                    $q$,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            END IF;

            EXECUTE format(
                $q$
                INSERT INTO stage10_warnings (
                    warning_type,
                    entity_scope,
                    metric,
                    value_n
                )
                SELECT
                    'missing_match_status',
                    %L,
                    %L,
                    count(*)::bigint
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = %s
                  AND (
                      c.match_status IS NULL
                      OR btrim(c.match_status) = ''
                  )
                $q$,
                r.base_table,
                format('%I.%I', ctx.staging_schema, r.base_table),
                ctx.staging_schema,
                r.base_table,
                ctx.snapshot_id
            );

            IF v_has_auto THEN
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_warnings (
                        warning_type,
                        entity_scope,
                        metric,
                        value_n
                    )
                    SELECT
                        'missing_auto_action',
                        %L,
                        %L,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                      AND (
                          c.auto_action IS NULL
                          OR btrim(c.auto_action) = ''
                      )
                    $q$,
                    r.base_table,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );

                EXECUTE format(
                    $q$
                    INSERT INTO stage10_warnings (
                        warning_type,
                        entity_scope,
                        metric,
                        value_n
                    )
                    SELECT
                        'possible_duplicate_signal',
                        %L,
                        %L,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                      AND (
                          c.match_status = 'duplicate_candidate'
                          OR c.auto_action = 'possible_duplicate'
                      )
                    $q$,
                    r.base_table,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            ELSE
                EXECUTE format(
                    $q$
                    INSERT INTO stage10_warnings (
                        warning_type,
                        entity_scope,
                        metric,
                        value_n
                    )
                    SELECT
                        'possible_duplicate_signal',
                        %L,
                        %L,
                        count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                      AND c.match_status = 'duplicate_candidate'
                    $q$,
                    r.base_table,
                    format('%I.%I', ctx.staging_schema, r.base_table),
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                );
            END IF;

            EXECUTE format(
                $q$
                INSERT INTO stage10_warnings (
                    warning_type,
                    entity_scope,
                    metric,
                    value_n
                )
                SELECT
                    'manual_protected_rows',
                    %L,
                    %L,
                    count(*)::bigint
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = %s
                  AND c.match_status = 'manual_protected'
                $q$,
                r.base_table,
                format('%I.%I', ctx.staging_schema, r.base_table),
                ctx.staging_schema,
                r.base_table,
                ctx.snapshot_id
            );
        END IF;
    END LOOP;

    INSERT INTO stage10_warnings (
        warning_type,
        entity_scope,
        metric,
        value_n
    )
    SELECT
        'failed_diff_run',
        dr.entity_family,
        'runs_not_completed',
        count(*)::bigint
    FROM system.system_diff_runs AS dr
    WHERE dr.current_snapshot_id = ctx.snapshot_id
      AND dr.status IS DISTINCT FROM 'completed'
    GROUP BY dr.entity_family;

    FOR r IN SELECT * FROM stage10_manifest ORDER BY entity_family LOOP
        v_reg := to_regclass(format('%I.%I', ctx.staging_schema, r.base_table));
        IF v_reg IS NULL THEN
            INSERT INTO stage10_review_workload (
                entity_family,
                no_conflict_count,
                review_or_conflict_count,
                manual_protected_count
            )
            VALUES (r.entity_family, 0, 0, 0);
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_views AS v
            WHERE v.schemaname = ctx.staging_schema AND v.viewname = r.nc_view
        ) INTO v_nc_view_exists;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.base_table
              AND c.column_name = 'match_status'
        )
        INTO v_has_match;

        IF v_nc_view_exists THEN
            EXECUTE format(
                $q$
                SELECT count(*)::bigint FROM %I.%I
                $q$,
                ctx.staging_schema,
                r.nc_view
            )
            INTO v_nc;
        ELSIF v_has_match THEN
            EXECUTE format(
                $q$
                SELECT count(*)::bigint
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = %s
                  AND c.match_status IN ('new_auto', 'matched_auto_update', 'unchanged')
                $q$,
                ctx.staging_schema,
                r.base_table,
                ctx.snapshot_id
            )
            INTO v_nc;
        ELSE
            v_nc := 0;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_views AS v
            WHERE v.schemaname = ctx.staging_schema AND v.viewname = r.rv_view
        ) INTO v_rv_view_exists;

        IF v_rv_view_exists THEN
            EXECUTE format(
                $q$
                SELECT count(*)::bigint FROM %I.%I
                $q$,
                ctx.staging_schema,
                r.rv_view
            )
            INTO v_rv;
        ELSIF v_has_match THEN
            EXECUTE format(
                $q$
                SELECT count(*)::bigint
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = %s
                  AND c.match_status IN ('needs_review', 'conflict', 'duplicate_candidate', 'delete_candidate')
                $q$,
                ctx.staging_schema,
                r.base_table,
                ctx.snapshot_id
            )
            INTO v_rv;
        ELSE
            v_rv := 0;
        END IF;

        v_mn := 0;
        IF r.mn_view IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM pg_views AS v
                WHERE v.schemaname = ctx.staging_schema AND v.viewname = r.mn_view
            ) INTO v_mn_view_exists;

            IF v_mn_view_exists THEN
                EXECUTE format(
                    $q$
                    SELECT count(*)::bigint FROM %I.%I
                    $q$,
                    ctx.staging_schema,
                    r.mn_view
                )
                INTO v_mn;
            ELSIF v_has_match THEN
                EXECUTE format(
                    $q$
                    SELECT count(*)::bigint
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = %s
                      AND c.match_status = 'manual_protected'
                    $q$,
                    ctx.staging_schema,
                    r.base_table,
                    ctx.snapshot_id
                )
                INTO v_mn;
            END IF;
        END IF;

        INSERT INTO stage10_review_workload (
            entity_family,
            no_conflict_count,
            review_or_conflict_count,
            manual_protected_count
        )
        VALUES (r.entity_family, v_nc, v_rv, v_mn);
    END LOOP;
END
$stage10_dynamic$;

SELECT
    'stage10_snapshot_context' AS section,
    s.*
FROM stage10_snapshot_context AS s;

SELECT
    'stage10_import_batch' AS section,
    b.*
FROM stage10_snapshot_context AS s
INNER JOIN system.system_import_batches AS b
    ON b.id = s.import_batch_id;

SELECT
    'stage10_layer_counts' AS section,
    layer_kind,
    format('%I.%I', schema_name, table_name) AS qualified_table,
    row_count
FROM stage10_layer_counts
ORDER BY layer_kind, qualified_table;

WITH
ctx AS (
    SELECT * FROM stage10_context
),
latest_f1 AS (
    SELECT DISTINCT ON (run.entity_family)
        run.id AS diff_run_id,
        run.entity_family
    FROM system.system_diff_runs AS run
    INNER JOIN ctx
        ON ctx.snapshot_id = run.current_snapshot_id
    WHERE run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
      AND run.status = 'completed'
    ORDER BY
        run.entity_family,
        run.finished_at DESC NULLS LAST,
        run.id DESC
)
SELECT
    'stage10_f1_summary_latest_run_items' AS section,
    item.entity_family,
    item.diff_type,
    item.auto_action,
    count(*) AS item_count
FROM system.system_diff_items AS item
INNER JOIN latest_f1 AS lf
    ON lf.diff_run_id = item.diff_run_id
GROUP BY item.entity_family, item.diff_type, item.auto_action
ORDER BY item.entity_family, item.diff_type, item.auto_action;

WITH
ctx AS (
    SELECT * FROM stage10_context
),
latest_f2 AS (
    SELECT DISTINCT ON (run.entity_family)
        run.id AS diff_run_id,
        run.entity_family
    FROM system.system_diff_runs AS run
    INNER JOIN ctx
        ON ctx.snapshot_id = run.current_snapshot_id
    WHERE run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
      AND run.status = 'completed'
    ORDER BY
        run.entity_family,
        run.finished_at DESC NULLS LAST,
        run.id DESC
)
SELECT
    'stage10_f2_summary_latest_run_items' AS section,
    item.entity_family,
    item.diff_type,
    item.auto_action,
    item.review_status,
    count(*) AS item_count
FROM system.system_diff_items AS item
INNER JOIN latest_f2 AS lf
    ON lf.diff_run_id = item.diff_run_id
GROUP BY item.entity_family, item.diff_type, item.auto_action, item.review_status
ORDER BY item.entity_family, item.diff_type, item.auto_action, item.review_status;

SELECT
    'stage10_final_staging_status_summary' AS section,
    staging_table,
    match_status,
    auto_action,
    review_status,
    row_count
FROM stage10_staging_status_summary
ORDER BY staging_table, match_status, auto_action, review_status;

SELECT
    'stage10_review_workload_by_family' AS section,
    entity_family,
    no_conflict_count,
    review_or_conflict_count,
    manual_protected_count
FROM stage10_review_workload
ORDER BY entity_family;

WITH
ctx AS (
    SELECT * FROM stage10_context
),
typed AS (
    SELECT
        run.id AS diff_run_id,
        run.entity_family,
        run.summary->>'comparison_type' AS comparison_type,
        run.status,
        run.summary,
        run.finished_at,
        run.started_at
    FROM system.system_diff_runs AS run
    INNER JOIN ctx
        ON ctx.snapshot_id = run.current_snapshot_id
    WHERE run.summary ? 'comparison_type'
)
SELECT DISTINCT ON (entity_family, comparison_type)
    'stage10_latest_diff_runs' AS section,
    diff_run_id,
    entity_family,
    comparison_type,
    status,
    summary,
    started_at,
    finished_at
FROM typed
ORDER BY
    entity_family,
    comparison_type,
    finished_at DESC NULLS LAST,
    diff_run_id DESC;

SELECT
    'stage10_warnings' AS section,
    warning_type,
    entity_scope,
    metric,
    value_n
FROM stage10_warnings
WHERE value_n > 0
ORDER BY warning_type, entity_scope;

COMMIT;
