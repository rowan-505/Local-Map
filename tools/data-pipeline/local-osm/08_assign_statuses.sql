-- =============================================================================
-- Stage G / Stage 08: assign_statuses (F1 + F2 → staging candidate statuses)
--
-- Scope:
--   - Local database only.
--   - Reads system.system_source_snapshots, system.system_diff_runs,
--     system.system_diff_items for the requested snapshot_version.
--   - Assigns staging.match_status, staging.auto_action, and optionally
--     staging.review_status / staging.updated_at from merged F1/F2 signals.
--   - Does not promote to core, touch prod_mirror or Supabase, delete staging,
--     or modify diff rows.
--   - staging.confidence_score is on a 0–100 scale (production core–aligned); logic here does not rescale it.
--
-- Input psql variables:
--   snapshot_version (required)
--   staging_schema optional, defaults to staging
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage08_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage08_params;

INSERT INTO stage08_params (
    snapshot_version,
    staging_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

DO $stage08_validate_params$
BEGIN
    IF (SELECT snapshot_version IS NULL FROM stage08_params LIMIT 1) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
END
$stage08_validate_params$;

CREATE TEMP TABLE IF NOT EXISTS stage08_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage08_context;

DO $stage08_resolve_snapshot$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*)::integer
    INTO v_count
    FROM system.system_source_snapshots AS s
    INNER JOIN stage08_params AS p
        ON p.snapshot_version = s.snapshot_version;

    IF v_count = 0 THEN
        RAISE EXCEPTION
            'snapshot_version "%" not found in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage08_params LIMIT 1);
    END IF;

    IF v_count > 1 THEN
        RAISE EXCEPTION
            'snapshot_version "%" is ambiguous (% rows) in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage08_params LIMIT 1),
            v_count;
    END IF;

    INSERT INTO stage08_context (
        source_snapshot_id,
        snapshot_version,
        staging_schema
    )
    SELECT
        s.id,
        s.snapshot_version,
        (SELECT staging_schema FROM stage08_params LIMIT 1)
    FROM system.system_source_snapshots AS s
    INNER JOIN stage08_params AS p
        ON p.snapshot_version = s.snapshot_version;
END
$stage08_resolve_snapshot$;

CREATE TEMP TABLE IF NOT EXISTS stage08_family_manifest (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL,
    has_required_cols boolean NOT NULL DEFAULT false,
    has_review_status boolean NOT NULL DEFAULT false,
    has_updated_at boolean NOT NULL DEFAULT false,
    skip_reason text
) ON COMMIT DROP;

TRUNCATE stage08_family_manifest;

INSERT INTO stage08_family_manifest (entity_family, staging_table)
VALUES
    ('places', 'staging_place_candidates'),
    ('roads', 'staging_road_candidates'),
    ('buildings', 'staging_building_candidates'),
    ('landuse', 'staging_landuse_candidates'),
    ('water_lines', 'staging_water_line_candidates'),
    ('water_polygons', 'staging_water_polygon_candidates'),
    ('admin_areas', 'staging_admin_area_candidates'),
    ('bus_stops', 'staging_bus_stop_candidates'),
    ('bus_routes', 'staging_bus_route_candidates'),
    ('addresses', 'staging_address_candidates'),
    ('routing_barriers', 'staging_routing_barrier_candidates');

DO $stage08_inspect_manifest$
DECLARE
    ctx stage08_context%ROWTYPE;
    r record;
    v_req constant text[] := ARRAY[
        'source_snapshot_id',
        'id',
        'match_status',
        'auto_action'
    ];
    v_missing text[];
    v_col text;
    v_has_review boolean;
    v_has_updated boolean;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    FOR r IN
        SELECT *
        FROM stage08_family_manifest
    LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table)) IS NULL THEN
            UPDATE stage08_family_manifest AS m
            SET
                has_required_cols = false,
                has_review_status = false,
                has_updated_at = false,
                skip_reason = format(
                    'staging table does not exist: %I.%I',
                    ctx.staging_schema,
                    r.staging_table
                )
            WHERE m.entity_family = r.entity_family;
            CONTINUE;
        END IF;

        v_missing := ARRAY[]::text[];
        FOREACH v_col IN ARRAY v_req LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns AS c
                WHERE c.table_schema = ctx.staging_schema
                  AND c.table_name = r.staging_table
                  AND c.column_name = v_col
            ) THEN
                v_missing := array_append(v_missing, v_col);
            END IF;
        END LOOP;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.staging_table
              AND c.column_name = 'review_status'
        )
        INTO v_has_review;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = ctx.staging_schema
              AND c.table_name = r.staging_table
              AND c.column_name = 'updated_at'
        )
        INTO v_has_updated;

        UPDATE stage08_family_manifest AS m
        SET
            has_required_cols = cardinality(v_missing) = 0,
            has_review_status = coalesce(v_has_review, false),
            has_updated_at = coalesce(v_has_updated, false),
            skip_reason = CASE
                WHEN cardinality(v_missing) = 0 THEN NULL
                ELSE format(
                    'missing required columns on %I.%I: %s',
                    ctx.staging_schema,
                    r.staging_table,
                    array_to_string(v_missing, ', ')
                )
            END
        WHERE m.entity_family = r.entity_family;
    END LOOP;
END
$stage08_inspect_manifest$;

CREATE TEMP TABLE IF NOT EXISTS stage08_status_decisions (
    entity_family text NOT NULL,
    staging_table text NOT NULL,
    local_entity_id bigint NOT NULL,
    external_id text,
    f1_diff_type text,
    f1_auto_action text,
    f2_diff_type text,
    f2_auto_action text,
    final_match_status text NOT NULL,
    final_auto_action text NOT NULL,
    final_review_status text NOT NULL,
    decision_reason jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

TRUNCATE stage08_status_decisions;

INSERT INTO stage08_status_decisions (
    entity_family,
    staging_table,
    local_entity_id,
    external_id,
    f1_diff_type,
    f1_auto_action,
    f2_diff_type,
    f2_auto_action,
    final_match_status,
    final_auto_action,
    final_review_status,
    decision_reason
)
WITH
ctx AS (
    SELECT *
    FROM stage08_context
),
manifest AS (
    SELECT *
    FROM stage08_family_manifest
    WHERE has_required_cols
),
latest_f1 AS (
    SELECT DISTINCT ON (run.entity_family)
        run.entity_family,
        run.id AS diff_run_id
    FROM system.system_diff_runs AS run
    INNER JOIN ctx
        ON ctx.source_snapshot_id = run.current_snapshot_id
    WHERE run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
      AND run.status = 'completed'
      AND EXISTS (
          SELECT 1
          FROM manifest AS m
          WHERE m.entity_family = run.entity_family
      )
    ORDER BY
        run.entity_family,
        run.finished_at DESC NULLS LAST,
        run.id DESC
),
latest_f2 AS (
    SELECT DISTINCT ON (run.entity_family)
        run.entity_family,
        run.id AS diff_run_id
    FROM system.system_diff_runs AS run
    INNER JOIN ctx
        ON ctx.source_snapshot_id = run.current_snapshot_id
    WHERE run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
      AND run.status = 'completed'
      AND EXISTS (
          SELECT 1
          FROM manifest AS m
          WHERE m.entity_family = run.entity_family
      )
    ORDER BY
        run.entity_family,
        run.finished_at DESC NULLS LAST,
        run.id DESC
),
f1_items AS (
    SELECT DISTINCT ON (item.entity_family, item.local_entity_id)
        item.entity_family,
        item.local_entity_id,
        item.external_id,
        item.diff_type AS f1_diff_type,
        item.auto_action AS f1_auto_action,
        item.after_data AS f1_after_data,
        item.id AS f1_item_id
    FROM system.system_diff_items AS item
    INNER JOIN latest_f1 AS lf
        ON lf.diff_run_id = item.diff_run_id
    WHERE item.local_entity_id IS NOT NULL
    ORDER BY
        item.entity_family,
        item.local_entity_id,
        item.id DESC
),
f2_items AS (
    SELECT DISTINCT ON (item.entity_family, item.local_entity_id)
        item.entity_family,
        item.local_entity_id,
        item.external_id,
        item.diff_type AS f2_diff_type,
        item.auto_action AS f2_auto_action,
        item.after_data AS f2_after_data,
        item.id AS f2_item_id
    FROM system.system_diff_items AS item
    INNER JOIN latest_f2 AS lf
        ON lf.diff_run_id = item.diff_run_id
    WHERE item.local_entity_id IS NOT NULL
    ORDER BY
        item.entity_family,
        item.local_entity_id,
        item.id DESC
),
combined AS (
    SELECT
        coalesce(f1.entity_family, f2.entity_family) AS entity_family,
        coalesce(f1.external_id, f2.external_id) AS external_id,
        coalesce(f1.local_entity_id, f2.local_entity_id) AS local_entity_id,
        f1.f1_diff_type,
        f1.f1_auto_action,
        f2.f2_diff_type,
        f2.f2_auto_action,
        coalesce(f2.f2_after_data->'f2_comparison'->>'f2_result', '') AS f2_result,
        f1.f1_item_id IS NOT NULL AS has_f1,
        f2.f2_item_id IS NOT NULL AS has_f2,
        f1.f1_item_id,
        f2.f2_item_id
    FROM f1_items AS f1
    FULL OUTER JOIN f2_items AS f2
        ON f2.entity_family = f1.entity_family
       AND f2.local_entity_id IS NOT DISTINCT FROM f1.local_entity_id
),
merged AS (
    SELECT
        c.*,
        m.staging_table,
        (
            c.has_f2
            AND (
                c.f2_auto_action = 'protect_manual'
                OR c.f2_result = 'manual_protected'
            )
        ) AS sig_protect,
        (
            c.has_f2
            AND (
                c.f2_auto_action = 'possible_duplicate'
                OR c.f2_result = 'possible_duplicate'
            )
        ) AS sig_dup,
        (
            (c.has_f2 AND c.f2_auto_action = 'needs_review')
            OR (
                c.has_f1
                AND coalesce(c.f1_auto_action, '') = 'needs_review'
                AND coalesce(c.f1_diff_type, '') <> 'deleted_candidate'
            )
        ) AS sig_nr,
        (
            (c.has_f2 AND c.f2_auto_action = 'update_candidate')
            OR coalesce(c.f1_auto_action, '') = 'update_candidate'
        ) AS sig_upd,
        (
            (
                coalesce(c.f2_auto_action, '') = 'ignore_unchanged'
                OR coalesce(c.f1_auto_action, '') = 'ignore_unchanged'
            )
            AND NOT (
                (c.has_f2 AND c.f2_auto_action = 'update_candidate')
                OR coalesce(c.f1_auto_action, '') = 'update_candidate'
            )
            AND NOT (
                (c.has_f2 AND c.f2_auto_action = 'needs_review')
                OR (
                    c.has_f1
                    AND coalesce(c.f1_auto_action, '') = 'needs_review'
                    AND coalesce(c.f1_diff_type, '') <> 'deleted_candidate'
                )
            )
            AND NOT (
                (c.has_f2 AND c.f2_auto_action = 'protect_manual')
                OR (c.has_f2 AND c.f2_result = 'manual_protected')
            )
            AND NOT (
                c.has_f2
                AND (
                    c.f2_auto_action = 'possible_duplicate'
                    OR c.f2_result = 'possible_duplicate'
                )
            )
            AND NOT (
                (c.has_f2 AND c.f2_auto_action = 'insert_candidate')
                OR (
                    NOT c.has_f2
                    AND coalesce(c.f1_auto_action, '') = 'insert_candidate'
                )
            )
        ) AS sig_ign,
        (
            (c.has_f2 AND c.f2_auto_action = 'insert_candidate')
            OR (
                NOT c.has_f2
                AND coalesce(c.f1_auto_action, '') = 'insert_candidate'
            )
        ) AS sig_ins,
        (
            coalesce(c.f1_diff_type, '') = 'deleted_candidate'
            OR coalesce(c.f2_diff_type, '') = 'deleted_candidate'
            OR coalesce(c.f2_auto_action, c.f1_auto_action, '')
                = 'do_not_delete_manual'
        ) AS sig_del
    FROM combined AS c
    INNER JOIN manifest AS m
        ON m.entity_family = c.entity_family
)
SELECT DISTINCT ON (entity_family, local_entity_id)
    entity_family,
    staging_table,
    local_entity_id,
    external_id,
    f1_diff_type,
    f1_auto_action,
    f2_diff_type,
    f2_auto_action,
    x.final_match_status,
    x.final_auto_action,
    x.final_review_status,
    x.decision_reason
FROM merged
CROSS JOIN LATERAL (
    SELECT
        CASE
            WHEN sig_protect THEN 'protect_manual'
            WHEN sig_dup THEN 'possible_duplicate'
            WHEN sig_nr THEN 'needs_review'
            WHEN sig_upd THEN 'update_candidate'
            WHEN sig_ign THEN 'ignore_unchanged'
            WHEN sig_ins THEN 'insert_candidate'
            WHEN sig_del THEN 'deleted_candidate'
            ELSE 'fallback'
        END AS rule_key,
        CASE
            WHEN sig_protect THEN 'manual_protected'
            WHEN sig_dup THEN 'duplicate_candidate'
            WHEN sig_nr THEN 'needs_review'
            WHEN sig_upd THEN 'matched_auto_update'
            WHEN sig_ign THEN 'unchanged'
            WHEN sig_ins THEN 'new_auto'
            WHEN sig_del THEN 'delete_candidate'
            ELSE 'needs_review'
        END AS final_match_status,
        CASE
            WHEN sig_protect THEN 'protect_manual'
            WHEN sig_dup THEN 'possible_duplicate'
            WHEN sig_nr THEN 'needs_review'
            WHEN sig_upd THEN 'update_candidate'
            WHEN sig_ign THEN 'ignore_unchanged'
            WHEN sig_ins THEN 'insert_candidate'
            WHEN sig_del THEN
                CASE
                    WHEN coalesce(f2_auto_action, f1_auto_action, '')
                        = 'do_not_delete_manual'
                    THEN 'do_not_delete_manual'
                    ELSE 'needs_review'
                END
            ELSE 'needs_review'
        END AS final_auto_action,
        CASE
            WHEN sig_ign THEN 'ignored'
            ELSE 'pending'
        END AS final_review_status
) AS r
CROSS JOIN LATERAL (
    SELECT
        r.final_match_status,
        r.final_auto_action,
        r.final_review_status,
        jsonb_strip_nulls(jsonb_build_object(
            'rule', r.rule_key,
            'has_f1', has_f1,
            'has_f2', has_f2,
            'f1_item_id', f1_item_id,
            'f2_item_id', f2_item_id,
            'f1_diff_type', f1_diff_type,
            'f1_auto_action', f1_auto_action,
            'f2_diff_type', f2_diff_type,
            'f2_auto_action', f2_auto_action,
            'f2_result', nullif(f2_result, '')
        )) AS decision_reason
) AS x
ORDER BY
    entity_family,
    local_entity_id,
    COALESCE(f1_item_id, 0) DESC,
    COALESCE(f2_item_id, 0) DESC;

DO $stage08_apply_updates$
DECLARE
    ctx stage08_context%ROWTYPE;
    r record;
    v_set text;
    v_sql text;
    v_updated bigint;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    FOR r IN
        SELECT *
        FROM stage08_family_manifest
        WHERE has_required_cols
    LOOP
        v_set := 'match_status = d.final_match_status, auto_action = d.final_auto_action';

        IF r.has_review_status THEN
            v_set := v_set || ', review_status = d.final_review_status';
        END IF;

        IF r.has_updated_at THEN
            v_set := v_set || ', updated_at = now()';
        END IF;

        v_sql := format(
            $fmt$
            UPDATE %I.%I AS s
            SET %s
            FROM stage08_status_decisions AS d
            WHERE d.entity_family = %L
              AND d.local_entity_id = s.id
              AND s.source_snapshot_id = %s
            $fmt$,
            ctx.staging_schema,
            r.staging_table,
            v_set,
            r.entity_family,
            ctx.source_snapshot_id
        );

        EXECUTE v_sql;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        RAISE NOTICE 'stage08_updated_rows entity_family=% staging_table=% rows=%',
            r.entity_family,
            r.staging_table,
            v_updated;
    END LOOP;
END
$stage08_apply_updates$;

SELECT
    'stage08_snapshot_context' AS section,
    source_snapshot_id,
    snapshot_version,
    staging_schema
FROM stage08_context;

SELECT
    'stage08_skipped_families' AS section,
    entity_family,
    staging_table,
    skip_reason
FROM stage08_family_manifest
WHERE NOT has_required_cols OR skip_reason IS NOT NULL
ORDER BY entity_family;

SELECT
    'stage08_counts_by_entity_family_final_match_status' AS section,
    entity_family,
    final_match_status,
    count(*) AS row_count
FROM stage08_status_decisions
GROUP BY entity_family, final_match_status
ORDER BY entity_family, final_match_status;

SELECT
    'stage08_counts_by_entity_family_final_auto_action' AS section,
    entity_family,
    final_auto_action,
    count(*) AS row_count
FROM stage08_status_decisions
GROUP BY entity_family, final_auto_action
ORDER BY entity_family, final_auto_action;

SELECT
    'stage08_decision_row_count' AS section,
    count(*) AS decision_rows
FROM stage08_status_decisions;

COMMIT;
