-- =============================================================================
-- Stage G / Stage 08: assign_statuses (F1 + F2 → staging candidate statuses)
--
-- Scope:
--   - Local database only.
--   - Reads system.system_source_snapshots, system.system_diff_runs,
--     system.system_diff_items for the requested snapshot_version.
--   - Assigns staging.match_status, staging.auto_action, and optionally
--     staging.review_status / staging.updated_at from merged F1/F2 signals.
--   - Applies classification-specific status defaults for staged places,
--     addresses, and place-address links created by Stage 05.
--   - Does not promote to core, touch prod_mirror or Supabase, delete staging,
--     or modify diff rows.
--   - staging.confidence_score is on a 0–100 scale (production core–aligned); logic here does not rescale it.
--
-- Input psql variables:
--   snapshot_version (required)
--   staging_schema optional, defaults to staging
--   entity_families  optional; default all (see pipeline_entity_families.sql)
--     admin_areas        → assign statuses for admin_areas only
--     roads              → assign statuses for roads only
--     admin_areas,roads  → both selected families
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

BEGIN;

SET LOCAL work_mem = '512MB';
SET LOCAL maintenance_work_mem = '1GB';

-- Index system_diff_items_diff_run_local_entity_idx: apply once via
-- infrastructure/database/migrations/local/007_system_diff_items_diff_run_local_entity_idx.sql

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

    RAISE NOTICE 'stage08: snapshot resolved — source_snapshot_id=% snapshot_version=% staging_schema=%',
        (SELECT c.source_snapshot_id FROM stage08_context AS c LIMIT 1),
        (SELECT c.snapshot_version FROM stage08_context AS c LIMIT 1),
        (SELECT c.staging_schema FROM stage08_context AS c LIMIT 1);
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
    ('settlements', 'staging_settlement_candidates'),
    ('roads', 'staging_road_candidates'),
    ('buildings', 'staging_building_candidates'),
    ('landuse', 'staging_landuse_candidates'),
    ('water_lines', 'staging_water_line_candidates'),
    ('water_polygons', 'staging_water_polygon_candidates'),
    ('admin_areas', 'staging_admin_area_candidates'),
    ('bus_stops', 'staging_bus_stop_candidates'),
    ('bus_routes', 'staging_bus_route_candidates'),
    ('addresses', 'staging_address_candidates'),
    ('place_address_links', 'staging_place_address_link_candidates'),
    ('routing_barriers', 'staging_routing_barrier_candidates');

\ir pipeline_entity_families.sql

DELETE FROM stage08_family_manifest AS m
WHERE NOT pg_temp.pipeline_entity_family_enabled(m.entity_family);

DO $stage08_prepare_typed_status_columns$
DECLARE
    ctx stage08_context%ROWTYPE;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.staging_place_candidates', ctx.staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_place_candidates
                ADD COLUMN IF NOT EXISTS promotion_status text not null default ''not_ready'',
                ADD COLUMN IF NOT EXISTS source_classification text null,
                ADD COLUMN IF NOT EXISTS has_place_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS has_address_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS address_strength text null,
                ADD COLUMN IF NOT EXISTS source_name text null,
                ADD COLUMN IF NOT EXISTS source_type_hint text null,
                ADD COLUMN IF NOT EXISTS source_category_hint text null',
            ctx.staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_candidates_promotion_status_idx
                ON %I.staging_place_candidates (promotion_status)',
            ctx.staging_schema
        );
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.staging_address_candidates', ctx.staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_address_candidates
                ADD COLUMN IF NOT EXISTS validation_status text not null default ''not_ready'',
                ADD COLUMN IF NOT EXISTS promotion_status text not null default ''not_ready'',
                ADD COLUMN IF NOT EXISTS source_classification text null,
                ADD COLUMN IF NOT EXISTS has_place_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS has_address_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS address_strength text null,
                ADD COLUMN IF NOT EXISTS source_name text null,
                ADD COLUMN IF NOT EXISTS source_type_hint text null,
                ADD COLUMN IF NOT EXISTS source_category_hint text null',
            ctx.staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_address_candidates_validation_status_idx
                ON %I.staging_address_candidates (validation_status)',
            ctx.staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_address_candidates_promotion_status_idx
                ON %I.staging_address_candidates (promotion_status)',
            ctx.staging_schema
        );
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.staging_place_address_link_candidates', ctx.staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_place_address_link_candidates
                ADD COLUMN IF NOT EXISTS validation_status text not null default ''not_ready'',
                ADD COLUMN IF NOT EXISTS promotion_status text not null default ''not_ready'',
                ADD COLUMN IF NOT EXISTS match_status text not null default ''new_candidate'',
                ADD COLUMN IF NOT EXISTS auto_action text null,
                ADD COLUMN IF NOT EXISTS review_status text not null default ''pending'',
                ADD COLUMN IF NOT EXISTS updated_at timestamptz not null default now()',
            ctx.staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_address_link_candidates_validation_status_idx
                ON %I.staging_place_address_link_candidates (validation_status)',
            ctx.staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_address_link_candidates_promotion_status_idx
                ON %I.staging_place_address_link_candidates (promotion_status)',
            ctx.staging_schema
        );
    END IF;
END
$stage08_prepare_typed_status_columns$;

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

    RAISE NOTICE 'stage08: manifest inspected — enabled_families=%',
        (SELECT count(*)::bigint FROM stage08_family_manifest WHERE has_required_cols);
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

DO $stage08_build_status_decisions$
DECLARE
    v_run_started_at timestamptz := clock_timestamp();
    v_step_started_at timestamptz;
    v_row_count bigint;
    v_f1_only bigint;
    v_f2_only bigint;
    v_both bigint;
    v_decision_rows bigint;
    v_f2_all_insert_candidate boolean := false;
    v_f2_non_insert_count bigint := 0;
    v_f2_insert_count bigint := 0;
BEGIN
    TRUNCATE stage08_status_decisions;

    v_step_started_at := clock_timestamp();
    DROP TABLE IF EXISTS stage08_latest_diff_runs;
    CREATE TEMP TABLE stage08_latest_diff_runs (
        entity_family text PRIMARY KEY,
        f1_diff_run_id bigint NOT NULL,
        f2_diff_run_id bigint
    ) ON COMMIT DROP;

    INSERT INTO stage08_latest_diff_runs (entity_family, f1_diff_run_id, f2_diff_run_id)
    SELECT
        m.entity_family,
        f1.diff_run_id,
        f2.diff_run_id
    FROM stage08_family_manifest AS m
    INNER JOIN LATERAL (
        SELECT run.id AS diff_run_id
        FROM system.system_diff_runs AS run
        INNER JOIN stage08_context AS ctx
            ON ctx.source_snapshot_id = run.current_snapshot_id
        WHERE run.entity_family = m.entity_family
          AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
          AND run.status = 'completed'
        ORDER BY run.finished_at DESC NULLS LAST, run.id DESC
        LIMIT 1
    ) AS f1 ON true
    LEFT JOIN LATERAL (
        SELECT run.id AS diff_run_id
        FROM system.system_diff_runs AS run
        INNER JOIN stage08_context AS ctx
            ON ctx.source_snapshot_id = run.current_snapshot_id
        WHERE run.entity_family = m.entity_family
          AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
          AND run.status = 'completed'
        ORDER BY run.finished_at DESC NULLS LAST, run.id DESC
        LIMIT 1
    ) AS f2 ON true
    WHERE m.has_required_cols;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    RAISE NOTICE 'stage08 | step=resolve_diff_runs | families=% | step_elapsed=% | total_elapsed=%',
        v_row_count, clock_timestamp() - v_step_started_at, clock_timestamp() - v_run_started_at;

    v_step_started_at := clock_timestamp();
    DROP TABLE IF EXISTS stage08_f2_items;
    CREATE TEMP TABLE stage08_f2_items ON COMMIT DROP AS
    SELECT DISTINCT ON (item.entity_family, item.local_entity_id)
        item.entity_family,
        item.local_entity_id,
        item.external_id,
        item.diff_type AS f2_diff_type,
        item.auto_action AS f2_auto_action,
        coalesce(item.after_data->'f2_comparison'->>'f2_result', '') AS f2_result,
        item.id AS f2_item_id
    FROM system.system_diff_items AS item
    INNER JOIN stage08_latest_diff_runs AS lr
        ON lr.entity_family = item.entity_family
       AND lr.f2_diff_run_id = item.diff_run_id
    WHERE item.local_entity_id IS NOT NULL
    ORDER BY item.entity_family, item.local_entity_id, item.id DESC;

    SELECT count(*)::bigint INTO v_row_count FROM stage08_f2_items;
    SELECT count(*)::bigint
    INTO v_f2_insert_count
    FROM stage08_f2_items AS f2
    WHERE f2.f2_auto_action = 'insert_candidate';
    v_f2_non_insert_count := greatest(v_row_count - v_f2_insert_count, 0);
    v_f2_all_insert_candidate := (v_f2_non_insert_count = 0);

    RAISE NOTICE 'stage08 | step=materialize_f2_items | rows=% | all_insert_candidate=% | insert_candidate=% | non_insert=% | step_elapsed=% | total_elapsed=%',
        v_row_count, v_f2_all_insert_candidate, v_f2_insert_count, v_f2_non_insert_count,
        clock_timestamp() - v_step_started_at, clock_timestamp() - v_run_started_at;

    v_step_started_at := clock_timestamp();

    -- Fast path for the insert_candidate majority (typical national dry-run: >99%).
    IF v_f2_insert_count > 0 THEN
        RAISE NOTICE 'progress: 0/% (0.00%%) stage08 bulk_insert_candidate rows=%',
            v_row_count, v_f2_insert_count;
        RAISE NOTICE 'stage08 | step=insert_status_decisions | mode=bulk_insert_candidate_fast_path | rows=%',
            v_f2_insert_count;

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
        SELECT
            f2.entity_family,
            m.staging_table,
            f2.local_entity_id,
            f2.external_id,
            NULL,
            NULL,
            f2.f2_diff_type,
            f2.f2_auto_action,
            'new_auto',
            'insert_candidate',
            'pending',
            jsonb_build_object(
                'rule', 'insert_candidate',
                'fast_path', true,
                'has_f1', false,
                'has_f2', true,
                'f2_item_id', f2.f2_item_id
            )
        FROM stage08_f2_items AS f2
        INNER JOIN stage08_family_manifest AS m
            ON m.entity_family = f2.entity_family
           AND m.has_required_cols
        WHERE f2.f2_auto_action = 'insert_candidate';
    END IF;

    IF v_f2_non_insert_count = 0 THEN
        v_f1_only := 0;
        v_f2_only := v_row_count;
        v_both := 0;
    ELSE
        -- Exception path: only merge the small non-insert_candidate set with F1.
        RAISE NOTICE 'progress: %/% (%)%% stage08 exception_merge non_insert=%',
            v_f2_insert_count, v_row_count,
            CASE WHEN v_row_count > 0 THEN round(100.0 * v_f2_insert_count / v_row_count, 2) ELSE 100 END,
            v_f2_non_insert_count;
        RAISE NOTICE 'stage08 | step=materialize_f1_items | starting (exception path) | non_insert=%',
            v_f2_non_insert_count;

        DROP TABLE IF EXISTS stage08_f2_exceptions;
        CREATE TEMP TABLE stage08_f2_exceptions ON COMMIT DROP AS
        SELECT *
        FROM stage08_f2_items AS f2
        WHERE f2.f2_auto_action IS DISTINCT FROM 'insert_candidate';
        CREATE INDEX stage08_f2_exceptions_join_idx
            ON stage08_f2_exceptions (entity_family, local_entity_id);
        ANALYZE stage08_f2_exceptions;

        DROP TABLE IF EXISTS stage08_f1_items;
        CREATE TEMP TABLE stage08_f1_items ON COMMIT DROP AS
        SELECT DISTINCT ON (item.entity_family, item.local_entity_id)
            item.entity_family,
            item.local_entity_id,
            item.external_id,
            item.diff_type AS f1_diff_type,
            item.auto_action AS f1_auto_action,
            item.id AS f1_item_id
        FROM system.system_diff_items AS item
        INNER JOIN stage08_latest_diff_runs AS lr
            ON lr.entity_family = item.entity_family
           AND lr.f1_diff_run_id = item.diff_run_id
        INNER JOIN stage08_f2_exceptions AS ex
            ON ex.entity_family = item.entity_family
           AND ex.local_entity_id = item.local_entity_id
        WHERE item.local_entity_id IS NOT NULL
        ORDER BY item.entity_family, item.local_entity_id, item.id DESC;

        CREATE INDEX stage08_f1_items_join_idx ON stage08_f1_items (entity_family, local_entity_id);
        ANALYZE stage08_f1_items;

        DROP TABLE IF EXISTS stage08_combined;
        CREATE TEMP TABLE stage08_combined ON COMMIT DROP AS
        SELECT
            coalesce(f1.entity_family, f2.entity_family) AS entity_family,
            coalesce(f1.external_id, f2.external_id) AS external_id,
            coalesce(f1.local_entity_id, f2.local_entity_id) AS local_entity_id,
            f1.f1_diff_type,
            f1.f1_auto_action,
            f2.f2_diff_type,
            f2.f2_auto_action,
            coalesce(f2.f2_result, '') AS f2_result,
            f1.f1_item_id IS NOT NULL AS has_f1,
            f2.f2_item_id IS NOT NULL AS has_f2,
            f1.f1_item_id,
            f2.f2_item_id
        FROM stage08_f2_exceptions AS f2
        LEFT JOIN stage08_f1_items AS f1
            ON f1.entity_family = f2.entity_family
           AND f1.local_entity_id IS NOT DISTINCT FROM f2.local_entity_id;

        SELECT count(*)::bigint INTO v_row_count FROM stage08_combined;
        SELECT count(*)::bigint INTO v_both FROM stage08_combined WHERE has_f1 AND has_f2;
        SELECT count(*)::bigint INTO v_f1_only FROM stage08_combined WHERE has_f1 AND NOT has_f2;
        SELECT count(*)::bigint INTO v_f2_only FROM stage08_combined WHERE has_f2 AND NOT has_f1;

        RAISE NOTICE 'stage08 | step=combine_f1_f2 | rows=% | f1_only=% | f2_only=% | both=% | step_elapsed=% | total_elapsed=%',
            v_row_count, v_f1_only, v_f2_only, v_both,
            clock_timestamp() - v_step_started_at, clock_timestamp() - v_run_started_at;

        v_step_started_at := clock_timestamp();
        RAISE NOTICE 'stage08 | step=insert_status_decisions | mode=exception_rule_merge | rows=%',
            v_row_count;

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
manifest AS (
    SELECT *
    FROM stage08_family_manifest
    WHERE has_required_cols
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
    FROM stage08_combined AS c
    INNER JOIN manifest AS m
        ON m.entity_family = c.entity_family
)
SELECT
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
) AS x;
    END IF;

    SELECT count(*)::bigint INTO v_decision_rows FROM stage08_status_decisions;
    RAISE NOTICE 'progress: %/% (100.00%%) stage08 decisions_done',
        v_decision_rows, v_decision_rows;
    RAISE NOTICE 'stage08 | step=insert_status_decisions | rows=% / % | step_elapsed=% | total_elapsed=%',
        v_decision_rows, greatest(v_f2_insert_count + v_f2_non_insert_count, v_decision_rows),
        clock_timestamp() - v_step_started_at, clock_timestamp() - v_run_started_at;
END
$stage08_build_status_decisions$;

DO $stage08_apply_updates$
DECLARE
    ctx stage08_context%ROWTYPE;
    r record;
    v_set text;
    v_sql text;
    v_updated bigint;
    v_row_count bigint;
    v_apply_started_at timestamptz := clock_timestamp();
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    RAISE NOTICE 'stage08: applying decisions to staging tables (started %)', v_apply_started_at;

    FOR r IN
        SELECT *
        FROM stage08_family_manifest
        WHERE has_required_cols
    LOOP
        SELECT count(*)::bigint
        INTO v_row_count
        FROM stage08_status_decisions AS d
        WHERE d.entity_family = r.entity_family;

        RAISE NOTICE 'stage08 | step=apply_staging_updates | family=% | table=% | decisions=% | starting',
            r.entity_family, r.staging_table, v_row_count;

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

        RAISE NOTICE 'stage08 | step=apply_staging_updates | family=% | updated=% / % | complete',
            r.entity_family, v_updated, v_row_count;
    END LOOP;

    RAISE NOTICE 'stage08 | step=apply_staging_updates | all_families_done | total_elapsed=%',
        clock_timestamp() - v_apply_started_at;
END
$stage08_apply_updates$;

DO $stage08_apply_classification_statuses$
DECLARE
    ctx stage08_context%ROWTYPE;
    v_sql text;
    v_updated bigint;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    -- Places: only Stage 05 rows with place evidence should exist here. Keep them
    -- review-ready but not promotion-ready until a reviewer approves and validation
    -- is run. Address-only rows must not become place rows.
    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.staging_place_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            UPDATE %I.staging_place_candidates AS p
            SET
                match_status = CASE
                    WHEN coalesce(p.source_classification, '') IN ('place_only', 'place_with_address') THEN 'new_candidate'
                    ELSE coalesce(nullif(p.match_status, ''), 'needs_review')
                END,
                auto_action = CASE
                    WHEN coalesce(p.source_classification, '') IN ('place_only', 'place_with_address') THEN 'needs_review'
                    ELSE coalesce(nullif(p.auto_action, ''), 'needs_review')
                END,
                review_status = coalesce(nullif(p.review_status, ''), 'pending'),
                promotion_status = CASE
                    WHEN p.promotion_status = 'promoted' THEN p.promotion_status
                    WHEN coalesce(p.source_classification, '') IN ('place_only', 'place_with_address') THEN 'not_ready'
                    ELSE 'blocked'
                END,
                confidence_score = least(100, greatest(0, coalesce(
                    p.confidence_score,
                    CASE
                        WHEN coalesce(p.source_classification, '') = 'place_with_address' THEN 85
                        WHEN coalesce(p.source_classification, '') = 'place_only' THEN 70
                        ELSE 40
                    END
                ))),
                updated_at = now()
            WHERE p.source_snapshot_id = %s
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        RAISE NOTICE 'stage08_classification_statuses entity_family=places rows=%', v_updated;
    END IF;

    -- Addresses: weak/place-only address rows are explicitly not ready for address
    -- promotion. Stronger address evidence can be reviewed as an address, but still
    -- remains promotion not_ready until approval/validation.
    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.staging_address_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            UPDATE %I.staging_address_candidates AS a
            SET
                match_status = CASE
                    WHEN coalesce(a.source_classification, '') = 'weak_address' THEN 'needs_review'
                    WHEN coalesce(a.source_classification, '') = 'place_only' THEN 'needs_review'
                    WHEN coalesce(a.source_classification, '') IN ('address_only', 'place_with_address') THEN 'new_candidate'
                    ELSE coalesce(nullif(a.match_status, ''), 'needs_review')
                END,
                auto_action = CASE
                    WHEN coalesce(a.source_classification, '') = 'weak_address' THEN 'needs_review'
                    WHEN coalesce(a.source_classification, '') = 'place_only' THEN 'needs_review'
                    WHEN coalesce(a.source_classification, '') IN ('address_only', 'place_with_address') THEN 'needs_review'
                    ELSE coalesce(nullif(a.auto_action, ''), 'needs_review')
                END,
                review_status = coalesce(nullif(a.review_status, ''), 'pending'),
                validation_status = CASE
                    WHEN coalesce(a.source_classification, '') = 'place_only' THEN 'blocked'
                    WHEN coalesce(a.address_strength, '') IN ('none', 'weak') THEN 'blocked'
                    WHEN coalesce(a.address_strength, '') = 'partial' THEN 'valid_with_warnings'
                    WHEN coalesce(a.address_strength, '') IN ('strong', 'full') THEN 'valid'
                    ELSE 'not_ready'
                END,
                promotion_status = CASE
                    WHEN a.promotion_status = 'promoted' THEN a.promotion_status
                    WHEN coalesce(a.source_classification, '') = 'place_only' THEN 'not_ready'
                    WHEN coalesce(a.address_strength, '') IN ('none', 'weak') THEN 'not_ready'
                    ELSE 'not_ready'
                END,
                confidence_score = least(100, greatest(0, coalesce(
                    a.confidence_score,
                    CASE coalesce(a.address_strength, '')
                        WHEN 'full' THEN 85
                        WHEN 'strong' THEN 75
                        WHEN 'partial' THEN 60
                        WHEN 'weak' THEN 35
                        ELSE 0
                    END
                ))),
                updated_at = now()
            WHERE a.source_snapshot_id = %s
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        RAISE NOTICE 'stage08_classification_statuses entity_family=addresses rows=%', v_updated;
    END IF;

    -- Links: only place_with_address + partial/strong/full rows should be staged.
    -- Links are valid for review only when both staged sides exist.
    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.staging_place_address_link_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            UPDATE %I.staging_place_address_link_candidates AS l
            SET
                match_status = 'new_candidate',
                auto_action = 'needs_review',
                review_status = coalesce(nullif(l.review_status, ''), 'pending'),
                validation_status = CASE
                    WHEN l.place_candidate_id IS NOT NULL
                         AND l.address_candidate_id IS NOT NULL
                         AND coalesce(l.source_classification, '') = 'place_with_address'
                         AND coalesce(l.address_strength, '') IN ('partial', 'strong', 'full')
                    THEN CASE WHEN coalesce(l.address_strength, '') = 'partial'
                        THEN 'valid_with_warnings'
                        ELSE 'valid'
                    END
                    ELSE 'blocked'
                END,
                promotion_status = CASE
                    WHEN l.promotion_status = 'promoted' THEN l.promotion_status
                    ELSE 'not_ready'
                END,
                confidence_score = least(100, greatest(0, coalesce(
                    l.confidence_score,
                    CASE coalesce(l.address_strength, '')
                        WHEN 'full' THEN 85
                        WHEN 'strong' THEN 75
                        WHEN 'partial' THEN 60
                        ELSE 0
                    END
                ))),
                updated_at = now()
            WHERE l.source_snapshot_id = %s
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        RAISE NOTICE 'stage08_classification_statuses entity_family=place_address_links rows=%', v_updated;
    END IF;
END
$stage08_apply_classification_statuses$;

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

DO $stage08_typed_verification$
DECLARE
    ctx stage08_context%ROWTYPE;
    v_sql text;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    CREATE TEMP TABLE IF NOT EXISTS stage08_typed_status_counts (
        entity_family text,
        source_classification text,
        address_strength text,
        match_status text,
        auto_action text,
        review_status text,
        validation_status text,
        promotion_status text,
        row_count bigint
    ) ON COMMIT DROP;

    TRUNCATE stage08_typed_status_counts;

    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.staging_place_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            INSERT INTO stage08_typed_status_counts
            SELECT
                'places',
                source_classification,
                address_strength,
                match_status,
                auto_action,
                review_status,
                NULL::text,
                promotion_status,
                count(*)::bigint
            FROM %I.staging_place_candidates
            WHERE source_snapshot_id = %s
            GROUP BY source_classification, address_strength, match_status, auto_action, review_status, promotion_status
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.staging_address_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            INSERT INTO stage08_typed_status_counts
            SELECT
                'addresses',
                source_classification,
                address_strength,
                match_status,
                auto_action,
                review_status,
                validation_status,
                promotion_status,
                count(*)::bigint
            FROM %I.staging_address_candidates
            WHERE source_snapshot_id = %s
            GROUP BY source_classification, address_strength, match_status, auto_action, review_status, validation_status, promotion_status
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.staging_place_address_link_candidates', ctx.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            $sql$
            INSERT INTO stage08_typed_status_counts
            SELECT
                'place_address_links',
                source_classification,
                address_strength,
                match_status,
                auto_action,
                review_status,
                validation_status,
                promotion_status,
                count(*)::bigint
            FROM %I.staging_place_address_link_candidates
            WHERE source_snapshot_id = %s
            GROUP BY source_classification, address_strength, match_status, auto_action, review_status, validation_status, promotion_status
            $sql$,
            ctx.staging_schema,
            ctx.source_snapshot_id
        );
        EXECUTE v_sql;
    END IF;
END
$stage08_typed_verification$;

SELECT
    'stage08_typed_status_counts' AS section,
    entity_family,
    source_classification,
    address_strength,
    match_status,
    auto_action,
    review_status,
    validation_status,
    promotion_status,
    row_count
FROM stage08_typed_status_counts
ORDER BY entity_family, source_classification, address_strength, validation_status, promotion_status;

SELECT
    'stage08_expected_counts_by_entity_family' AS section,
    entity_family,
    sum(row_count)::bigint AS row_count
FROM stage08_typed_status_counts
GROUP BY entity_family
ORDER BY entity_family;

DO $stage08_family_summary$
DECLARE
    ctx stage08_context%ROWTYPE;
    r record;
    v_staging_rows bigint;
    v_sql text;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage08_context;

    CREATE TEMP TABLE IF NOT EXISTS stage08_family_summary (
        entity_family text NOT NULL,
        staging_table text NOT NULL,
        staging_rows bigint NOT NULL,
        decision_rows bigint NOT NULL,
        new_candidate bigint NOT NULL,
        matched_existing bigint NOT NULL,
        protected_match bigint NOT NULL,
        needs_review bigint NOT NULL
    ) ON COMMIT DROP;

    TRUNCATE stage08_family_summary;

    FOR r IN
        SELECT *
        FROM stage08_family_manifest
        ORDER BY entity_family
    LOOP
        v_staging_rows := 0;

        IF to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table)) IS NOT NULL THEN
            v_sql := format(
                'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
                ctx.staging_schema,
                r.staging_table
            );
            EXECUTE v_sql INTO v_staging_rows USING ctx.source_snapshot_id;
        END IF;

        INSERT INTO stage08_family_summary (
            entity_family,
            staging_table,
            staging_rows,
            decision_rows,
            new_candidate,
            matched_existing,
            protected_match,
            needs_review
        )
        SELECT
            r.entity_family,
            format('%I.%I', ctx.staging_schema, r.staging_table),
            coalesce(v_staging_rows, 0),
            coalesce(s.decision_rows, 0),
            coalesce(s.new_candidate, 0),
            coalesce(s.matched_existing, 0),
            coalesce(s.protected_match, 0),
            coalesce(s.needs_review, 0)
        FROM (
            SELECT
                count(*)::bigint AS decision_rows,
                count(*) FILTER (WHERE d.final_auto_action = 'insert_candidate')::bigint AS new_candidate,
                count(*) FILTER (WHERE d.final_auto_action = 'ignore_unchanged')::bigint AS matched_existing,
                count(*) FILTER (WHERE d.final_auto_action = 'protect_manual')::bigint AS protected_match,
                count(*) FILTER (
                    WHERE d.final_auto_action IN ('needs_review', 'update_candidate', 'possible_duplicate')
                )::bigint AS needs_review
            FROM stage08_status_decisions AS d
            WHERE d.entity_family = r.entity_family
        ) AS s;
    END LOOP;
END
$stage08_family_summary$;

SELECT
    'stage08_family_summary' AS section,
    entity_family,
    staging_table,
    staging_rows,
    decision_rows,
    new_candidate,
    matched_existing,
    protected_match,
    needs_review
FROM stage08_family_summary
ORDER BY entity_family;

DO $stage08_complete$
BEGIN
    RAISE NOTICE 'stage08: assign_statuses complete — see stage08_family_summary above';
END
$stage08_complete$;

COMMIT;
