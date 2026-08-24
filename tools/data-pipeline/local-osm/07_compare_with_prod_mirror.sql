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
--   only_entity_family   optional legacy single-family filter (manual reruns)
--   entity_families      optional; default all (see pipeline_entity_families.sql)
--
--     admin_areas        → staging_admin_area_candidates vs prod_mirror.core_admin_areas
--     roads              → staging_road_candidates vs prod_mirror.core_streets
--     all                → every configured family (current behavior)
--
-- Matching rules:
--   Source identity uses system.pipeline_osm_identity_key() so canonical
--   osm:node|way|relation:<id> matches legacy production osm:N|W|R:<id>.
--   admin_areas → primary identity_key; cautious fallback when prod external_id is
--                 missing: same admin_level_id + similar canonical_name + geom overlap
--   roads       → identity_key only (never name-only or spatial-only matching)
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
--   - prod_mirror.core_buildings geom GIST
--   - prod_mirror.core_buildings centroid GIST
--   - staging.staging_road_candidates geom GIST
--   - prod_mirror.core_streets geom GIST
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
-- National places/roads/buildings F2 against full prod_mirror often exceeds 30min locally.
-- This stage is local-only (prod_mirror copy). Disable statement timeout by default.
-- Override: psql -v pipeline_statement_timeout="'2h'" or pass PIPELINE_STATEMENT_TIMEOUT via runner.
\if :{?pipeline_statement_timeout}
SET statement_timeout = :'pipeline_statement_timeout';
\else
SET statement_timeout = '0';
\endif
SET lock_timeout = '30s';
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
\if :{?entity_families}
\else
\set entity_families 'all'
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
    ('settlements', 'staging_settlement_candidates', 'core_settlements', false, false, false, 'point_geom', NULL, NULL, 'point_geom', NULL, 80),
    ('roads', 'staging_road_candidates', 'core_streets', true, false, false, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('buildings', 'staging_building_candidates', 'core_buildings', true, false, false, NULL, 'geom', NULL, 'centroid', 'geom', 10),
    ('admin_areas', 'staging_admin_area_candidates', 'core_admin_areas', false, true, true, NULL, 'geom', NULL, 'centroid', 'geom', 10),
    ('landuse', 'staging_landuse_candidates', 'core_land_areas', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 5),
    ('protected_areas', 'staging_protected_area_candidates', 'core_protected_areas', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 5),
    ('water_lines', 'staging_water_line_candidates', 'core_water_lines', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 10),
    ('water_polygons', 'staging_water_polygon_candidates', 'core_water_polygons', false, false, false, NULL, 'geom', NULL, NULL, 'geom', 5),
    ('addresses', 'staging_address_candidates', 'core_addresses', false, false, false, 'point_geom', 'geom', NULL, 'point_geom', 'geom', 30),
    ('routing_roads', 'staging_routing_road_candidates', 'core_streets', false, false, true, NULL, 'geom', 'geom_multi', NULL, 'geom', 10),
    ('routing_barriers', 'staging_routing_barrier_candidates', 'core_routing_barriers', false, false, true, 'point_geom', 'geom', NULL, 'point_geom', 'geom', 10);

-- routing_roads are derived from staging_road_candidates and are compared
-- indirectly through roads. Routing graph-specific validation will happen in a
-- later routing stage, so F2 skips this duplicate prod_mirror comparison for now.
UPDATE stage07_family_config
SET skip_f2_for_now = true
WHERE entity_family = 'routing_roads';

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql
\ir pipeline_settlements.sql
\ir pipeline_f2_stable_compare.sql

DELETE FROM stage07_family_config AS fc
WHERE NOT pg_temp.pipeline_entity_family_enabled(fc.entity_family);

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
-- When only_entity_family is set (legacy), delete only that family's prior F2 output.
-- When ENTITY_FAMILIES is narrowed, delete only selected families' prior F2 output.
DELETE FROM system.system_diff_items AS item
USING system.system_diff_runs AS run
JOIN stage07_context AS ctx
    ON ctx.current_snapshot_id = run.current_snapshot_id
CROSS JOIN stage07_params AS p
WHERE item.diff_run_id = run.id
  AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
  AND (
      (
          p.only_entity_family IS NOT NULL
          AND run.entity_family = p.only_entity_family
      )
      OR (
          p.only_entity_family IS NULL
          AND (
              pg_temp.pipeline_entity_families_is_all()
              OR pg_temp.pipeline_entity_family_enabled(run.entity_family)
          )
      )
  );

DELETE FROM system.system_diff_runs AS run
USING stage07_context AS ctx
CROSS JOIN stage07_params AS p
WHERE run.current_snapshot_id = ctx.current_snapshot_id
  AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
  AND (
      (
          p.only_entity_family IS NOT NULL
          AND run.entity_family = p.only_entity_family
      )
      OR (
          p.only_entity_family IS NULL
          AND (
              pg_temp.pipeline_entity_families_is_all()
              OR pg_temp.pipeline_entity_family_enabled(run.entity_family)
          )
      )
  );

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
        RAISE EXCEPTION
            'Stage F2 required prod_mirror minimum is not available for selected ENTITY_FAMILIES. Missing required staging/prod_mirror table pairs: %',
            (
                SELECT string_agg(cfg.entity_family, ', ' ORDER BY cfg.entity_family)
                FROM stage07_family_config AS cfg
                JOIN stage07_report AS report
                    ON report.entity_family = cfg.entity_family
                   AND report.auto_action = 'skip'
                   AND report.status = 'FAIL'
            );
    END IF;
END
$stage07_validate_targets$;

-- Slim F2 payloads (geometry already hashed / matched separately).
CREATE SCHEMA IF NOT EXISTS system;
CREATE OR REPLACE FUNCTION system.pipeline_staging_diff_payload(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_strip_nulls(
        coalesce(p_row, '{}'::jsonb)
        - 'geom'
        - 'point_geom'
        - 'centroid'
        - 'footprint_geom'
        - 'geom_multi'
        - 'entrance_geom'
    );
$$;

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
    v_road_no_match_count bigint;
    v_admin_source_match_count bigint;
    v_admin_fallback_match_count bigint;
    v_admin_no_match_count bigint;
    v_building_source_match_count bigint;
    v_building_spatial_match_count bigint;
    v_building_no_match_count bigint;
    v_chunk_size bigint;
    v_min_id bigint;
    v_max_id bigint;
    v_lo bigint;
    v_hi bigint;
    v_done bigint;
    v_batch bigint;
    v_pct numeric;
    v_t0 timestamptz;
    v_elapsed_s numeric;
    v_eta_s numeric;
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

    CREATE OR REPLACE FUNCTION pg_temp.stage07_write_family_summary(
        p_entity_family text,
        p_staging_table text,
        p_prod_table text,
        p_diff_run_id bigint,
        p_staging_rows bigint,
        p_prod_rows bigint
    ) RETURNS void
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
        DELETE FROM stage07_report AS report
        WHERE report.entity_family = p_entity_family
          AND report.auto_action IN (
              'staging_rows', 'prod_rows', 'new_candidate', 'matched_existing',
              'protected_match', 'needs_review'
          );

        INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
        VALUES
            (p_entity_family, p_staging_table, p_prod_table, 'staging_rows', coalesce(p_staging_rows, 0), 'PASS', 'Selected family F2 summary metric.'),
            (p_entity_family, p_staging_table, p_prod_table, 'prod_rows', coalesce(p_prod_rows, 0), 'PASS', 'Selected family F2 summary metric.');

        INSERT INTO stage07_report (entity_family, staging_table, prod_table, auto_action, value_n, status, note)
        SELECT
            p_entity_family,
            p_staging_table,
            p_prod_table,
            summary.metric,
            summary.value_n,
            'PASS',
            'Selected family F2 summary metric.'
        FROM (
            SELECT 'new_candidate'::text AS metric, count(*)::bigint AS value_n
            FROM system.system_diff_items
            WHERE diff_run_id = p_diff_run_id
              AND auto_action = 'insert_candidate'
            UNION ALL
            SELECT 'matched_existing', count(*)::bigint
            FROM system.system_diff_items
            WHERE diff_run_id = p_diff_run_id
              AND auto_action = 'ignore_unchanged'
            UNION ALL
            SELECT 'protected_match', count(*)::bigint
            FROM system.system_diff_items
            WHERE diff_run_id = p_diff_run_id
              AND auto_action = 'protect_manual'
            UNION ALL
            SELECT 'needs_review', count(*)::bigint
            FROM system.system_diff_items
            WHERE diff_run_id = p_diff_run_id
              AND auto_action IN ('needs_review', 'update_candidate', 'possible_duplicate')
        ) AS summary;
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
        format(
            'snapshot_version=%s only_entity_family=%s entity_families=%s',
            ctx.snapshot_version,
            coalesce(v_only_entity_family, '<all>'),
            coalesce((SELECT c.entity_families FROM _pipeline_entity_families_ctx AS c LIMIT 1), 'all')
        ),
        NULL,
        jsonb_build_object(
            'current_snapshot_id', ctx.current_snapshot_id,
            'staging_schema', v_staging_schema,
            'prod_mirror_schema', v_prod_mirror_schema,
            'entity_families', coalesce((SELECT c.entity_families FROM _pipeline_entity_families_ctx AS c LIMIT 1), 'all')
        )
    );

    IF NULLIF(btrim(v_only_entity_family), '') IS NOT NULL
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
        WHERE (
            NULLIF(btrim(v_only_entity_family), '') IS NULL
            OR entity_family = v_only_entity_family
        )
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
                        system.pipeline_osm_identity_key(s.external_id) AS identity_key,
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
                CREATE INDEX stage07_road_staging_identity_key_idx
                    ON stage07_road_staging (identity_key);
                CREATE INDEX stage07_road_staging_geom_gix
                    ON stage07_road_staging USING gist (geom);
                ANALYZE stage07_road_staging;

                DROP TABLE IF EXISTS stage07_road_prod;
                -- Do not copy the full national streets mirror (can be 800k+ rows).
                -- Keep prod candidates that share an OSM identity with staging, or
                -- that intersect a small pad around the staging extent (sample/local clips).
                RAISE NOTICE 'stage07_road_prod_extract_start [65%%] at=%', clock_timestamp();
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_road_prod ON COMMIT DROP AS
                    WITH staging_extent AS (
                        SELECT ST_Expand(ST_Envelope(ST_Collect(s.geom)), 0.02) AS geom
                        FROM stage07_road_staging AS s
                        WHERE s.geom IS NOT NULL
                    ),
                    staging_ids AS (
                        SELECT identity_key
                        FROM stage07_road_staging
                        WHERE identity_key IS NOT NULL
                    )
                    SELECT
                        p.id AS prod_id,
                        p.geom,
                        coalesce(nullif(to_jsonb(p)->>'canonical_name', ''), nullif(to_jsonb(p)->>'name', '')) AS canonical_name,
                        to_jsonb(p) AS prod_data,
                        coalesce(to_jsonb(p)->'source_refs', '{}'::jsonb) AS source_refs,
                        nullif(to_jsonb(p)->>'external_id', '') AS external_id,
                        system.pipeline_osm_identity_key(nullif(to_jsonb(p)->>'external_id', '')) AS identity_key,
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
                    LEFT JOIN staging_extent AS se ON true
                    WHERE
                        system.pipeline_osm_identity_key(nullif(to_jsonb(p)->>'external_id', '')) IN (SELECT identity_key FROM staging_ids)
                        OR (
                            p.geom IS NOT NULL
                            AND se.geom IS NOT NULL
                            AND p.geom && se.geom
                        )
                    $q$,
                    v_prod_mirror_schema,
                    cfg.prod_table
                );

                CREATE INDEX stage07_road_prod_prod_id_idx
                    ON stage07_road_prod (prod_id);
                CREATE INDEX stage07_road_prod_external_id_idx
                    ON stage07_road_prod (external_id);
                CREATE INDEX stage07_road_prod_identity_key_idx
                    ON stage07_road_prod (identity_key);
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
                    p.geom AS prod_geom,
                    1 AS match_rank,
                    true AS source_matched,
                    false AS fallback_matched,
                    p.manual_protected
                FROM stage07_road_staging AS s
                JOIN stage07_road_prod AS p
                    ON s.identity_key IS NOT NULL
                   AND (
                       p.identity_key = s.identity_key
                       OR system.pipeline_osm_identity_key(p.source_refs->>'external_id') = s.identity_key
                       OR system.pipeline_osm_identity_key(p.source_refs->>'osm_external_id') = s.identity_key
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

                DROP TABLE IF EXISTS stage07_road_best_matches;
                CREATE TEMP TABLE stage07_road_best_matches ON COMMIT DROP AS
                SELECT *
                FROM stage07_road_source_matches;

                CREATE INDEX stage07_road_best_matches_staging_id_idx
                    ON stage07_road_best_matches (staging_id);
                ANALYZE stage07_road_best_matches;

                SELECT count(*)::bigint
                INTO v_road_no_match_count
                FROM stage07_road_staging AS s
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM stage07_road_best_matches AS bm
                    WHERE bm.staging_id = s.staging_id
                );

                RAISE NOTICE 'stage07_road_no_match_count count=%', v_road_no_match_count;
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
                        coalesce(bm.fallback_matched, false) AS fallback_matched,
                        coalesce(bm.manual_protected, false) AS manual_protected,
                        system.pipeline_f2_roads_staging_payload(
                            s.canonical_name,
                            coalesce(
                                s.staging_data->>'class_code',
                                s.normalized_data->>'class_code',
                                s.normalized_data->'tags'->>'highway'
                            ),
                            nullif(s.staging_data->>'road_class_id', '')::bigint,
                            s.geom,
                            nullif(s.staging_data->>'admin_area_id', '')::bigint,
                            CASE
                                WHEN s.staging_data ? 'is_oneway'
                                    THEN (s.staging_data->>'is_oneway')::boolean
                                ELSE NULL
                            END,
                            coalesce(
                                s.normalized_data->'routing'->>'surface',
                                s.normalized_data->'tags'->>'surface'
                            ),
                            s.normalized_data->'tags'->>'bridge',
                            s.normalized_data->'tags'->>'tunnel',
                            s.normalized_data->'tags'->>'layer',
                            -- Slim prod_mirror lacks oneway/surface/bridge/tunnel/layer.
                            false
                        ) AS staging_payload,
                        CASE
                            WHEN bm.prod_data IS NULL THEN NULL
                            ELSE system.pipeline_f2_roads_prod_payload(
                                coalesce(bm.prod_data->>'canonical_name', bm.prod_data->>'name'),
                                coalesce(
                                    bm.prod_data->>'road_class',
                                    bm.prod_data->>'class_code',
                                    bm.prod_data->>'road_class_code'
                                ),
                                nullif(bm.prod_data->>'road_class_id', '')::bigint,
                                bm.prod_geom,
                                nullif(bm.prod_data->>'admin_area_id', '')::bigint,
                                CASE
                                    WHEN bm.prod_data ? 'is_oneway'
                                        THEN (bm.prod_data->>'is_oneway')::boolean
                                    ELSE NULL
                                END,
                                coalesce(bm.prod_data->>'surface', bm.prod_data->'source_tags'->>'surface'),
                                coalesce(bm.prod_data->>'bridge', bm.prod_data->'source_tags'->>'bridge'),
                                coalesce(bm.prod_data->>'tunnel', bm.prod_data->'source_tags'->>'tunnel'),
                                coalesce(bm.prod_data->>'layer', bm.prod_data->'source_tags'->>'layer'),
                                CASE
                                    WHEN nullif(bm.prod_data->>'deleted_at', '') IS NOT NULL
                                        THEN (bm.prod_data->>'deleted_at')::timestamptz
                                    ELSE NULL
                                END,
                                false,
                                -- Staging road candidates usually have no admin_area_id.
                                (nullif(s.staging_data->>'admin_area_id', '') IS NOT NULL)
                            )
                        END AS prod_payload
                    FROM stage07_road_staging AS s
                    LEFT JOIN stage07_road_best_matches AS bm
                        ON bm.staging_id = s.staging_id
                ),
                classified_changed AS (
                    SELECT
                        c.*,
                        CASE
                            WHEN c.prod_data IS NULL THEN true
                            ELSE system.pipeline_f2_roads_changed(c.staging_payload, c.prod_payload)
                        END AS changed,
                        CASE
                            WHEN c.prod_data IS NULL THEN '{}'::jsonb
                            ELSE system.pipeline_f2_payload_field_diffs(c.staging_payload, c.prod_payload)
                        END AS field_diffs
                    FROM classified AS c
                ),
                road_items AS (
                    SELECT
                        classified_changed.*,
                        CASE
                            WHEN prod_data IS NULL THEN 'prod_no_match'
                            WHEN manual_protected THEN 'manual_protected'
                            WHEN source_matched AND NOT changed THEN 'prod_match'
                            WHEN source_matched AND changed THEN 'prod_conflict'
                            ELSE 'prod_no_match'
                        END AS f2_result,
                        CASE
                            WHEN prod_data IS NULL THEN 'new'
                            WHEN manual_protected THEN 'changed'
                            WHEN source_matched AND NOT changed THEN 'unchanged'
                            WHEN source_matched AND changed THEN 'changed'
                            ELSE 'new'
                        END AS diff_type,
                        CASE
                            WHEN prod_data IS NULL THEN 'insert_candidate'
                            WHEN manual_protected THEN 'protect_manual'
                            WHEN source_matched AND NOT changed THEN 'ignore_unchanged'
                            WHEN source_matched AND changed THEN 'update_candidate'
                            ELSE 'insert_candidate'
                        END AS auto_action,
                        CASE
                            WHEN source_matched AND NOT changed AND NOT manual_protected THEN 'ignored'
                            ELSE 'pending'
                        END AS review_status
                    FROM classified_changed
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
                            'fallback_matched', fallback_matched,
                            'manual_protected', manual_protected,
                            'content_changed', changed,
                            'stable_compare', true,
                            'field_diffs', field_diffs,
                            'staging_payload', staging_payload,
                            'prod_payload', prod_payload
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
                'F2 roads external_id-only staging-vs-prod_mirror diff items written.'
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = v_diff_run_id
            GROUP BY item.auto_action;

            PERFORM pg_temp.stage07_write_family_summary(
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                v_diff_run_id,
                v_staging_count,
                v_prod_count
            );

            UPDATE stage07_diff_runs AS runs
            SET staging_rows = v_staging_count,
                prod_rows = v_prod_count
            WHERE runs.diff_run_id = v_diff_run_id;

            CONTINUE;
        END IF;

        IF cfg.entity_family = 'admin_areas' THEN
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

                DROP TABLE IF EXISTS stage07_admin_staging;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_admin_staging ON COMMIT DROP AS
                    SELECT
                        s.id AS staging_id,
                        s.external_id,
                        system.pipeline_osm_identity_key(s.external_id) AS identity_key,
                        s.canonical_name,
                        s.admin_level_id,
                        s.geom,
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

                CREATE INDEX stage07_admin_staging_staging_id_idx
                    ON stage07_admin_staging (staging_id);
                CREATE INDEX stage07_admin_staging_external_id_idx
                    ON stage07_admin_staging (external_id);
                CREATE INDEX stage07_admin_staging_identity_key_idx
                    ON stage07_admin_staging (identity_key);
                CREATE INDEX stage07_admin_staging_admin_level_id_idx
                    ON stage07_admin_staging (admin_level_id);
                CREATE INDEX stage07_admin_staging_geom_gix
                    ON stage07_admin_staging USING gist (geom);
                ANALYZE stage07_admin_staging;

                DROP TABLE IF EXISTS stage07_admin_prod;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_admin_prod ON COMMIT DROP AS
                    SELECT
                        p.id AS prod_id,
                        nullif(btrim(p.external_id), '') AS external_id,
                        system.pipeline_osm_identity_key(nullif(btrim(p.external_id), '')) AS identity_key,
                        p.admin_level_id,
                        p.canonical_name,
                        p.geom,
                        to_jsonb(p) AS prod_data,
                        coalesce(p.source_refs, '{}'::jsonb) AS source_refs,
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
                            OR coalesce(p.source_refs, '{}'::jsonb)::text ILIKE '%%manual_dashboard%%'
                            OR coalesce(to_jsonb(p)->>'source_type', '') ILIKE '%%manual%%'
                            OR coalesce(to_jsonb(p)->>'source_type', '') ILIKE '%%dashboard%%'
                        ) AS manual_protected
                    FROM %I.%I AS p
                    $q$,
                    v_prod_mirror_schema,
                    cfg.prod_table
                );

                CREATE INDEX stage07_admin_prod_prod_id_idx
                    ON stage07_admin_prod (prod_id);
                CREATE INDEX stage07_admin_prod_external_id_idx
                    ON stage07_admin_prod (external_id);
                CREATE INDEX stage07_admin_prod_identity_key_idx
                    ON stage07_admin_prod (identity_key);
                CREATE INDEX stage07_admin_prod_admin_level_id_idx
                    ON stage07_admin_prod (admin_level_id);
                CREATE INDEX stage07_admin_prod_geom_gix
                    ON stage07_admin_prod USING gist (geom);
                ANALYZE stage07_admin_prod;

                SELECT count(*)::bigint INTO v_staging_count FROM stage07_admin_staging;
                SELECT count(*)::bigint INTO v_prod_count FROM stage07_admin_prod;

                DROP TABLE IF EXISTS stage07_admin_source_matches;
                CREATE TEMP TABLE stage07_admin_source_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (s.staging_id)
                    s.staging_id,
                    p.prod_id,
                    p.prod_data,
                    1 AS match_rank,
                    true AS source_matched,
                    false AS fallback_matched,
                    p.manual_protected
                FROM stage07_admin_staging AS s
                JOIN stage07_admin_prod AS p
                    ON s.identity_key IS NOT NULL
                   AND (
                       p.identity_key = s.identity_key
                       OR system.pipeline_osm_identity_key(p.source_refs->>'external_id') = s.identity_key
                       OR system.pipeline_osm_identity_key(p.source_refs->>'osm_external_id') = s.identity_key
                   )
                ORDER BY s.staging_id, p.manual_protected DESC, p.prod_id;

                CREATE INDEX stage07_admin_source_matches_staging_id_idx
                    ON stage07_admin_source_matches (staging_id);
                ANALYZE stage07_admin_source_matches;

                SELECT count(*)::bigint INTO v_admin_source_match_count FROM stage07_admin_source_matches;

                DROP TABLE IF EXISTS stage07_admin_fallback_matches;
                CREATE TEMP TABLE stage07_admin_fallback_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (s.staging_id)
                    s.staging_id,
                    p.prod_id,
                    p.prod_data,
                    2 AS match_rank,
                    false AS source_matched,
                    true AS fallback_matched,
                    p.manual_protected
                FROM stage07_admin_staging AS s
                JOIN stage07_admin_prod AS p
                    ON p.external_id IS NULL
                   AND s.admin_level_id IS NOT NULL
                   AND p.admin_level_id = s.admin_level_id
                   AND s.canonical_name IS NOT NULL
                   AND p.canonical_name IS NOT NULL
                   AND lower(btrim(s.canonical_name)) = lower(btrim(p.canonical_name))
                   AND s.geom IS NOT NULL
                   AND p.geom IS NOT NULL
                   AND p.geom && ST_Expand(s.geom, 0.0002)
                   AND ST_Intersects(s.geom, p.geom)
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM stage07_admin_source_matches AS sm
                    WHERE sm.staging_id = s.staging_id
                )
                ORDER BY s.staging_id, p.manual_protected DESC, p.prod_id;

                CREATE INDEX stage07_admin_fallback_matches_staging_id_idx
                    ON stage07_admin_fallback_matches (staging_id);
                ANALYZE stage07_admin_fallback_matches;

                SELECT count(*)::bigint INTO v_admin_fallback_match_count FROM stage07_admin_fallback_matches;

                DROP TABLE IF EXISTS stage07_admin_best_matches;
                CREATE TEMP TABLE stage07_admin_best_matches ON COMMIT DROP AS
                SELECT DISTINCT ON (matches.staging_id)
                    matches.*
                FROM (
                    SELECT * FROM stage07_admin_source_matches
                    UNION ALL
                    SELECT * FROM stage07_admin_fallback_matches
                ) AS matches
                ORDER BY matches.staging_id, matches.match_rank, matches.prod_id;

                CREATE INDEX stage07_admin_best_matches_staging_id_idx
                    ON stage07_admin_best_matches (staging_id);
                ANALYZE stage07_admin_best_matches;

                SELECT count(*)::bigint
                INTO v_admin_no_match_count
                FROM stage07_admin_staging AS s
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM stage07_admin_best_matches AS bm
                    WHERE bm.staging_id = s.staging_id
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
                        coalesce(bm.fallback_matched, false) AS fallback_matched,
                        coalesce(bm.manual_protected, false) AS manual_protected,
                        (
                            jsonb_strip_nulls(jsonb_build_object(
                                'canonical_name', nullif(lower(btrim(coalesce(s.canonical_name, ''))), ''),
                                'admin_level_id', nullif(s.admin_level_id::text, ''),
                                'class_code', nullif(coalesce(s.staging_data->>'class_code', s.normalized_data->>'mapped_admin_level_code'), '')
                            ))
                            IS DISTINCT FROM
                            jsonb_strip_nulls(jsonb_build_object(
                                'canonical_name', nullif(lower(btrim(coalesce(bm.prod_data->>'canonical_name', ''))), ''),
                                'admin_level_id', nullif(bm.prod_data->>'admin_level_id', ''),
                                'class_code', nullif(coalesce(bm.prod_data->>'class_code', bm.prod_data->'normalized_data'->>'mapped_admin_level_code'), '')
                            ))
                        ) AS changed
                    FROM stage07_admin_staging AS s
                    LEFT JOIN stage07_admin_best_matches AS bm
                        ON bm.staging_id = s.staging_id
                ),
                admin_items AS (
                    SELECT
                        classified.*,
                        CASE
                            WHEN prod_data IS NULL THEN 'prod_no_match'
                            WHEN manual_protected THEN 'manual_protected'
                            WHEN source_matched AND NOT changed THEN 'prod_match'
                            WHEN source_matched AND changed THEN 'prod_conflict'
                            WHEN fallback_matched THEN 'possible_duplicate'
                            ELSE 'prod_no_match'
                        END AS f2_result,
                        CASE
                            WHEN prod_data IS NULL THEN 'new'
                            WHEN manual_protected THEN 'changed'
                            WHEN source_matched AND NOT changed THEN 'unchanged'
                            WHEN source_matched AND changed THEN 'changed'
                            WHEN fallback_matched THEN 'changed'
                            ELSE 'new'
                        END AS diff_type,
                        CASE
                            WHEN prod_data IS NULL THEN 'insert_candidate'
                            WHEN manual_protected THEN 'protect_manual'
                            WHEN source_matched AND NOT changed THEN 'ignore_unchanged'
                            WHEN source_matched AND changed THEN 'update_candidate'
                            WHEN fallback_matched THEN 'needs_review'
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
                            'fallback_matched', fallback_matched,
                            'manual_protected', manual_protected
                        )
                    ),
                    confidence_score,
                    auto_action,
                    review_status,
                    now()
                FROM admin_items;

                GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
                v_elapsed_ms := round((extract(epoch FROM (clock_timestamp() - v_insert_start_ts)) * 1000.0)::numeric, 2);

                PERFORM pg_temp.stage07_log(
                    cfg.entity_family,
                    'admin_inserted_count',
                    format('count=%s', v_inserted_count),
                    v_elapsed_ms,
                    jsonb_build_object(
                        'count', v_inserted_count,
                        'source_matches', v_admin_source_match_count,
                        'fallback_matches', v_admin_fallback_match_count,
                        'no_matches', v_admin_no_match_count
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
                        'admin_match_counts',
                        jsonb_build_object(
                            'source_matches', v_admin_source_match_count,
                            'fallback_matches', v_admin_fallback_match_count,
                            'no_matches', v_admin_no_match_count
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
                'F2 admin_areas staging-vs-prod_mirror diff items written.'
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = v_diff_run_id
            GROUP BY item.auto_action;

            UPDATE stage07_diff_runs AS runs
            SET staging_rows = v_staging_count,
                prod_rows = v_prod_count
            WHERE runs.diff_run_id = v_diff_run_id;

            PERFORM pg_temp.stage07_write_family_summary(
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                v_diff_run_id,
                v_staging_count,
                v_prod_count
            );

            CONTINUE;
        END IF;

        IF cfg.entity_family = 'buildings' THEN
            -- Fast path for large building sets (often millions) vs small prod_mirror.
            -- Drive spatial matching FROM prod (tiny) into staging GIST, not LATERAL per staging row.
            -- Chunked slim-payload inserts with progress: N/M notices.
            RAISE NOTICE 'stage07_insert_start family=% diff_run_id=% at=%',
                cfg.entity_family,
                v_diff_run_id,
                clock_timestamp();
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'insert_start',
                format('diff_run_id=%s buildings_fast_path', v_diff_run_id),
                NULL,
                jsonb_build_object('diff_run_id', v_diff_run_id, 'mode', 'buildings_fast_path')
            );

            BEGIN
                v_insert_start_ts := clock_timestamp();
                BEGIN
                    v_chunk_size := nullif(current_setting('coremap.stage06_chunk_size', true), '')::bigint;
                EXCEPTION WHEN OTHERS THEN
                    v_chunk_size := NULL;
                END;
                IF v_chunk_size IS NULL OR v_chunk_size < 1000 THEN
                    v_chunk_size := 50000;
                END IF;

                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = v_staging_schema
                      AND table_name = cfg.staging_table
                      AND column_name = 'confidence_score'
                ) INTO v_has_staging_confidence;

                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=buildings build_prod_temp',
                    v_staging_count;

                DROP TABLE IF EXISTS stage07_bldg_prod;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_bldg_prod ON COMMIT DROP AS
                    SELECT
                        p.id AS prod_id,
                        nullif(btrim(p.external_id), '') AS external_id,
                        system.pipeline_osm_identity_key(nullif(btrim(p.external_id), '')) AS identity_key,
                        p.name,
                        p.building_type_id,
                        p.admin_area_id,
                        p.geom,
                        coalesce(p.centroid, ST_PointOnSurface(p.geom)) AS centroid,
                        coalesce(p.is_verified, false) AS is_verified,
                        false AS manual_override,
                        system.pipeline_staging_diff_payload(to_jsonb(p)) AS prod_data
                    FROM %I.%I AS p
                    WHERE p.deleted_at IS NULL
                      AND p.geom IS NOT NULL
                    $q$,
                    v_prod_mirror_schema,
                    cfg.prod_table
                );
                CREATE INDEX stage07_bldg_prod_identity_idx ON stage07_bldg_prod (identity_key);
                CREATE INDEX stage07_bldg_prod_geom_gix ON stage07_bldg_prod USING gist (geom);
                CREATE INDEX stage07_bldg_prod_centroid_gix ON stage07_bldg_prod USING gist (centroid);
                ANALYZE stage07_bldg_prod;

                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=buildings identity_match',
                    v_staging_count;

                DROP TABLE IF EXISTS stage07_bldg_matched;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_bldg_matched ON COMMIT DROP AS
                    SELECT DISTINCT ON (s.id)
                        s.id AS staging_id,
                        p.prod_id,
                        true AS source_matched,
                        false AS spatial_matched,
                        1 AS match_rank,
                        p.prod_data,
                        p.name AS prod_name,
                        p.building_type_id AS prod_building_type_id,
                        p.admin_area_id AS prod_admin_area_id,
                        p.geom AS prod_geom,
                        p.is_verified,
                        p.manual_override
                    FROM %1$I.%2$I AS s
                    JOIN stage07_bldg_prod AS p
                      ON p.identity_key IS NOT NULL
                     AND p.identity_key = system.pipeline_osm_identity_key(s.external_id)
                    WHERE s.source_snapshot_id = $1
                      AND system.pipeline_osm_identity_key(s.external_id) IS NOT NULL
                    ORDER BY s.id, p.prod_id
                    $q$,
                    v_staging_schema,
                    cfg.staging_table
                ) USING ctx.current_snapshot_id;
                CREATE UNIQUE INDEX stage07_bldg_matched_staging_id_idx ON stage07_bldg_matched (staging_id);
                ANALYZE stage07_bldg_matched;

                SELECT count(*)::bigint INTO v_building_source_match_count FROM stage07_bldg_matched;
                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=buildings spatial_match source_matched=%',
                    v_staging_count, v_building_source_match_count;

                -- Spatial: drive FROM prod (tiny) into staging GIST.
                EXECUTE format(
                    $q$
                    INSERT INTO stage07_bldg_matched (
                        staging_id, prod_id, source_matched, spatial_matched, match_rank,
                        prod_data, prod_name, prod_building_type_id, prod_admin_area_id,
                        prod_geom, is_verified, manual_override
                    )
                    SELECT DISTINCT ON (s.id)
                        s.id,
                        p.prod_id,
                        false,
                        true,
                        2,
                        p.prod_data,
                        p.name,
                        p.building_type_id,
                        p.admin_area_id,
                        p.geom,
                        p.is_verified,
                        p.manual_override
                    FROM stage07_bldg_prod AS p
                    JOIN %1$I.%2$I AS s
                      ON s.source_snapshot_id = $1
                     AND s.geom IS NOT NULL
                     AND s.geom && ST_Expand(p.geom, 0.0002)
                     AND (
                            ST_Intersects(s.geom, p.geom)
                         OR ST_DWithin(
                                ST_PointOnSurface(s.geom)::geography,
                                coalesce(p.centroid, ST_PointOnSurface(p.geom))::geography,
                                %3$s
                            )
                     )
                    WHERE NOT EXISTS (
                        SELECT 1 FROM stage07_bldg_matched AS m WHERE m.staging_id = s.id
                    )
                    ORDER BY s.id, p.prod_id
                    $q$,
                    v_staging_schema,
                    cfg.staging_table,
                    coalesce(cfg.spatial_threshold_m, 10)
                ) USING ctx.current_snapshot_id;

                SELECT count(*)::bigint INTO v_building_spatial_match_count
                FROM stage07_bldg_matched WHERE source_matched = false AND spatial_matched = true;
                v_building_no_match_count := v_staging_count
                    - v_building_source_match_count
                    - v_building_spatial_match_count;
                ANALYZE stage07_bldg_matched;

                RAISE NOTICE 'stage07_building_match_counts source=% spatial=% no_match=%',
                    v_building_source_match_count,
                    v_building_spatial_match_count,
                    v_building_no_match_count;

                q := format(
                    'SELECT coalesce(min(id),0), coalesce(max(id),-1) FROM %I.%I WHERE source_snapshot_id = $1',
                    v_staging_schema, cfg.staging_table
                );
                EXECUTE q INTO v_min_id, v_max_id USING ctx.current_snapshot_id;

                v_done := 0;
                v_t0 := clock_timestamp();
                v_lo := v_min_id;
                WHILE v_lo <= v_max_id LOOP
                    v_hi := v_lo + v_chunk_size - 1;

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
                            'buildings',
                            CASE
                                WHEN m.staging_id IS NULL THEN 'new'
                                WHEN m.is_verified OR m.manual_override THEN 'changed'
                                WHEN NOT m.source_matched AND m.spatial_matched THEN 'changed'
                                WHEN (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR nullif(s.normalized_data->>'building_type_id', '')::bigint
                                        IS DISTINCT FROM m.prod_building_type_id
                                    OR (
                                        nullif(s.normalized_data->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(s.normalized_data->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                ) THEN 'changed'
                                ELSE 'unchanged'
                            END,
                            s.external_id,
                            s.id,
                            m.prod_data,
                            system.pipeline_staging_diff_payload(to_jsonb(s)) || jsonb_build_object(
                                'f2_comparison',
                                jsonb_build_object(
                                    'f2_result',
                                    CASE
                                        WHEN m.staging_id IS NULL THEN 'prod_no_match'
                                        WHEN m.is_verified OR m.manual_override THEN 'manual_protected'
                                        WHEN NOT m.source_matched AND m.spatial_matched THEN 'possible_duplicate'
                                        WHEN (
                                            system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                                IS DISTINCT FROM
                                            system.pipeline_meaningful_name(m.prod_name)
                                            OR nullif(s.normalized_data->>'building_type_id', '')::bigint
                                                IS DISTINCT FROM m.prod_building_type_id
                                            OR (
                                                nullif(s.normalized_data->>'admin_area_id', '') IS NOT NULL
                                                AND nullif(s.normalized_data->>'admin_area_id', '')::bigint
                                                    IS DISTINCT FROM m.prod_admin_area_id
                                            )
                                            OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                        ) THEN 'prod_conflict'
                                        ELSE 'prod_match'
                                    END,
                                    'prod_match_rank', m.match_rank,
                                    'source_matched', coalesce(m.source_matched, false),
                                    'spatial_matched', coalesce(m.spatial_matched, false),
                                    'name_matched', false,
                                    'manual_protected', coalesce(m.is_verified OR m.manual_override, false)
                                )
                            ),
                            %s,
                            CASE
                                WHEN m.staging_id IS NULL THEN 'insert_candidate'
                                WHEN m.is_verified OR m.manual_override THEN 'protect_manual'
                                WHEN NOT m.source_matched AND m.spatial_matched THEN 'possible_duplicate'
                                WHEN (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR nullif(s.normalized_data->>'building_type_id', '')::bigint
                                        IS DISTINCT FROM m.prod_building_type_id
                                    OR (
                                        nullif(s.normalized_data->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(s.normalized_data->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                ) THEN 'update_candidate'
                                ELSE 'ignore_unchanged'
                            END,
                            CASE
                                WHEN m.staging_id IS NOT NULL
                                 AND NOT coalesce(m.is_verified OR m.manual_override, false)
                                 AND m.source_matched
                                 AND NOT (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR nullif(s.normalized_data->>'building_type_id', '')::bigint
                                        IS DISTINCT FROM m.prod_building_type_id
                                    OR (
                                        nullif(s.normalized_data->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(s.normalized_data->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                 ) THEN 'ignored'
                                ELSE 'pending'
                            END,
                            now()
                        FROM %I.%I AS s
                        LEFT JOIN stage07_bldg_matched AS m
                          ON m.staging_id = s.id
                        WHERE s.source_snapshot_id = $2
                          AND s.id BETWEEN $3 AND $4
                        $q$,
                        CASE WHEN v_has_staging_confidence THEN 'coalesce(s.confidence_score, 50.0000)' ELSE '50.0000' END,
                        v_staging_schema,
                        cfg.staging_table
                    );
                    EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id, v_lo, v_hi;
                    GET DIAGNOSTICS v_batch = ROW_COUNT;
                    v_done := v_done + v_batch;

                    v_elapsed_s := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0));
                    IF v_staging_count > 0 THEN
                        v_pct := round(100.0 * v_done / v_staging_count, 2);
                    ELSE
                        v_pct := 100;
                    END IF;
                    IF v_done > 0 AND v_elapsed_s > 0 AND v_done < v_staging_count THEN
                        v_eta_s := (v_elapsed_s * (v_staging_count - v_done)) / v_done;
                    ELSE
                        v_eta_s := 0;
                    END IF;

                    RAISE NOTICE 'progress: %/% (%)%% stage07 family=buildings insert_f2 chunk=%-% batch=% eta_s=%',
                        v_done, v_staging_count, v_pct, v_lo, v_hi, v_batch, round(v_eta_s)::bigint;

                    v_lo := v_hi + 1;
                END LOOP;

                v_inserted_count := v_done;
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
                    jsonb_build_object(
                        'diff_run_id', v_diff_run_id,
                        'inserted', v_inserted_count,
                        'mode', 'buildings_fast_path',
                        'source_matches', v_building_source_match_count,
                        'spatial_matches', v_building_spatial_match_count,
                        'no_matches', v_building_no_match_count
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
                            'error_message', SQLERRM,
                            'mode', 'buildings_fast_path'
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
                        'mode', 'buildings_fast_path',
                        'building_match_counts',
                        jsonb_build_object(
                            'source_matches', v_building_source_match_count,
                            'spatial_matches', v_building_spatial_match_count,
                            'no_matches', v_building_no_match_count
                        ),
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
                'F2 buildings fast-path staging-vs-prod_mirror diff items written.'
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = v_diff_run_id
            GROUP BY item.auto_action;

            UPDATE stage07_diff_runs AS runs
            SET staging_rows = v_staging_count,
                prod_rows = v_prod_count
            WHERE runs.diff_run_id = v_diff_run_id;

            PERFORM pg_temp.stage07_write_family_summary(
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                v_diff_run_id,
                v_staging_count,
                v_prod_count
            );

            RAISE NOTICE 'progress: %/% (100.00%%) stage07 family=buildings done',
                v_done, v_done;
            CONTINUE;
        END IF;

        -- Landuse / land areas: national extracts are large (~100k+ polys) while
        -- prod_mirror.core_land_areas is tiny. Drive identity + spatial FROM prod
        -- into staging GIST (same shape as buildings_fast_path).
        IF cfg.entity_family = 'landuse' THEN
            RAISE NOTICE 'stage07_insert_start family=% diff_run_id=% at=%',
                cfg.entity_family,
                v_diff_run_id,
                clock_timestamp();
            PERFORM pg_temp.stage07_log(
                cfg.entity_family,
                'insert_start',
                format('diff_run_id=%s landuse_fast_path', v_diff_run_id),
                NULL,
                jsonb_build_object('diff_run_id', v_diff_run_id, 'mode', 'landuse_fast_path')
            );

            BEGIN
                v_insert_start_ts := clock_timestamp();
                BEGIN
                    v_chunk_size := nullif(current_setting('coremap.stage06_chunk_size', true), '')::bigint;
                EXCEPTION WHEN OTHERS THEN
                    v_chunk_size := NULL;
                END;
                IF v_chunk_size IS NULL OR v_chunk_size < 1000 THEN
                    v_chunk_size := 50000;
                END IF;

                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = v_staging_schema
                      AND table_name = cfg.staging_table
                      AND column_name = 'confidence_score'
                ) INTO v_has_staging_confidence;

                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=landuse build_prod_temp',
                    v_staging_count;

                DROP TABLE IF EXISTS stage07_land_prod;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_land_prod ON COMMIT DROP AS
                    SELECT
                        p.id AS prod_id,
                        nullif(btrim(p.external_id), '') AS external_id,
                        system.pipeline_osm_identity_key(nullif(btrim(p.external_id), '')) AS identity_key,
                        p.name,
                        p.class_code,
                        p.admin_area_id,
                        p.geom,
                        coalesce(p.centroid, ST_PointOnSurface(p.geom)) AS centroid,
                        coalesce(p.is_verified, false) AS is_verified,
                        coalesce(p.manual_override, false) AS manual_override,
                        system.pipeline_staging_diff_payload(to_jsonb(p)) AS prod_data
                    FROM %I.%I AS p
                    WHERE p.deleted_at IS NULL
                      AND p.geom IS NOT NULL
                    $q$,
                    v_prod_mirror_schema,
                    cfg.prod_table
                );
                CREATE INDEX stage07_land_prod_identity_idx ON stage07_land_prod (identity_key);
                CREATE INDEX stage07_land_prod_geom_gix ON stage07_land_prod USING gist (geom);
                CREATE INDEX stage07_land_prod_centroid_gix ON stage07_land_prod USING gist (centroid);
                ANALYZE stage07_land_prod;

                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=landuse identity_match',
                    v_staging_count;

                DROP TABLE IF EXISTS stage07_land_matched;
                EXECUTE format(
                    $q$
                    CREATE TEMP TABLE stage07_land_matched ON COMMIT DROP AS
                    SELECT DISTINCT ON (s.id)
                        s.id AS staging_id,
                        p.prod_id,
                        true AS source_matched,
                        false AS spatial_matched,
                        1 AS match_rank,
                        p.prod_data,
                        p.name AS prod_name,
                        p.class_code AS prod_class_code,
                        p.admin_area_id AS prod_admin_area_id,
                        p.geom AS prod_geom,
                        p.is_verified,
                        p.manual_override
                    FROM %1$I.%2$I AS s
                    JOIN stage07_land_prod AS p
                      ON p.identity_key IS NOT NULL
                     AND p.identity_key = system.pipeline_osm_identity_key(s.external_id)
                    WHERE s.source_snapshot_id = $1
                      AND system.pipeline_osm_identity_key(s.external_id) IS NOT NULL
                    ORDER BY s.id, p.prod_id
                    $q$,
                    v_staging_schema,
                    cfg.staging_table
                ) USING ctx.current_snapshot_id;
                CREATE UNIQUE INDEX stage07_land_matched_staging_id_idx ON stage07_land_matched (staging_id);
                ANALYZE stage07_land_matched;

                SELECT count(*)::bigint INTO v_building_source_match_count FROM stage07_land_matched;
                RAISE NOTICE 'progress: 0/% (0.00%%) stage07 family=landuse spatial_match source_matched=%',
                    v_staging_count, v_building_source_match_count;

                EXECUTE format(
                    $q$
                    INSERT INTO stage07_land_matched (
                        staging_id, prod_id, source_matched, spatial_matched, match_rank,
                        prod_data, prod_name, prod_class_code, prod_admin_area_id,
                        prod_geom, is_verified, manual_override
                    )
                    SELECT DISTINCT ON (s.id)
                        s.id,
                        p.prod_id,
                        false,
                        true,
                        2,
                        p.prod_data,
                        p.name,
                        p.class_code,
                        p.admin_area_id,
                        p.geom,
                        p.is_verified,
                        p.manual_override
                    FROM stage07_land_prod AS p
                    JOIN %1$I.%2$I AS s
                      ON s.source_snapshot_id = $1
                     AND s.geom IS NOT NULL
                     AND s.geom && ST_Expand(p.geom, 0.0002)
                     AND (
                            ST_Intersects(s.geom, p.geom)
                         OR ST_DWithin(
                                ST_PointOnSurface(s.geom)::geography,
                                coalesce(p.centroid, ST_PointOnSurface(p.geom))::geography,
                                %3$s
                            )
                     )
                    WHERE NOT EXISTS (
                        SELECT 1 FROM stage07_land_matched AS m WHERE m.staging_id = s.id
                    )
                    ORDER BY s.id, p.prod_id
                    $q$,
                    v_staging_schema,
                    cfg.staging_table,
                    coalesce(cfg.spatial_threshold_m, 5)
                ) USING ctx.current_snapshot_id;

                SELECT count(*)::bigint INTO v_building_spatial_match_count
                FROM stage07_land_matched WHERE source_matched = false AND spatial_matched = true;
                v_building_no_match_count := v_staging_count
                    - v_building_source_match_count
                    - v_building_spatial_match_count;
                ANALYZE stage07_land_matched;

                RAISE NOTICE 'stage07_landuse_match_counts source=% spatial=% no_match=%',
                    v_building_source_match_count,
                    v_building_spatial_match_count,
                    v_building_no_match_count;

                q := format(
                    'SELECT coalesce(min(id),0), coalesce(max(id),-1) FROM %I.%I WHERE source_snapshot_id = $1',
                    v_staging_schema, cfg.staging_table
                );
                EXECUTE q INTO v_min_id, v_max_id USING ctx.current_snapshot_id;

                v_done := 0;
                v_t0 := clock_timestamp();
                v_lo := v_min_id;
                WHILE v_lo <= v_max_id LOOP
                    v_hi := v_lo + v_chunk_size - 1;

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
                            'landuse',
                            CASE
                                WHEN m.staging_id IS NULL THEN 'new'
                                WHEN m.is_verified OR m.manual_override THEN 'changed'
                                WHEN NOT m.source_matched AND m.spatial_matched THEN 'changed'
                                WHEN (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR system.pipeline_norm_text(s.class_code)
                                        IS DISTINCT FROM system.pipeline_norm_text(m.prod_class_code)
                                    OR (
                                        nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(to_jsonb(s)->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                ) THEN 'changed'
                                ELSE 'unchanged'
                            END,
                            s.external_id,
                            s.id,
                            m.prod_data,
                            system.pipeline_staging_diff_payload(to_jsonb(s)) || jsonb_build_object(
                                'f2_comparison',
                                jsonb_build_object(
                                    'f2_result',
                                    CASE
                                        WHEN m.staging_id IS NULL THEN 'prod_no_match'
                                        WHEN m.is_verified OR m.manual_override THEN 'manual_protected'
                                        WHEN NOT m.source_matched AND m.spatial_matched THEN 'possible_duplicate'
                                        WHEN (
                                            system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                                IS DISTINCT FROM
                                            system.pipeline_meaningful_name(m.prod_name)
                                            OR system.pipeline_norm_text(s.class_code)
                                                IS DISTINCT FROM system.pipeline_norm_text(m.prod_class_code)
                                            OR (
                                                nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                                                AND nullif(to_jsonb(s)->>'admin_area_id', '')::bigint
                                                    IS DISTINCT FROM m.prod_admin_area_id
                                            )
                                            OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                        ) THEN 'prod_conflict'
                                        ELSE 'prod_match'
                                    END,
                                    'prod_match_rank', m.match_rank,
                                    'source_matched', coalesce(m.source_matched, false),
                                    'spatial_matched', coalesce(m.spatial_matched, false),
                                    'name_matched', false,
                                    'manual_protected', coalesce(m.is_verified OR m.manual_override, false)
                                )
                            ),
                            %s,
                            CASE
                                WHEN m.staging_id IS NULL THEN 'insert_candidate'
                                WHEN m.is_verified OR m.manual_override THEN 'protect_manual'
                                WHEN NOT m.source_matched AND m.spatial_matched THEN 'possible_duplicate'
                                WHEN (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR system.pipeline_norm_text(s.class_code)
                                        IS DISTINCT FROM system.pipeline_norm_text(m.prod_class_code)
                                    OR (
                                        nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(to_jsonb(s)->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                ) THEN 'update_candidate'
                                ELSE 'ignore_unchanged'
                            END,
                            CASE
                                WHEN m.staging_id IS NULL THEN 'pending'
                                WHEN m.is_verified OR m.manual_override THEN 'ignored'
                                WHEN NOT m.source_matched AND m.spatial_matched THEN 'pending'
                                WHEN (
                                    system.pipeline_meaningful_name(coalesce(s.canonical_name, s.normalized_data->>'name'))
                                        IS DISTINCT FROM
                                    system.pipeline_meaningful_name(m.prod_name)
                                    OR system.pipeline_norm_text(s.class_code)
                                        IS DISTINCT FROM system.pipeline_norm_text(m.prod_class_code)
                                    OR (
                                        nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                                        AND nullif(to_jsonb(s)->>'admin_area_id', '')::bigint
                                            IS DISTINCT FROM m.prod_admin_area_id
                                    )
                                    OR system.pipeline_geometry_meaningfully_changed(s.geom, m.prod_geom)
                                ) THEN 'pending'
                                ELSE 'ignored'
                            END,
                            now()
                        FROM %I.%I AS s
                        LEFT JOIN stage07_land_matched AS m
                          ON m.staging_id = s.id
                        WHERE s.source_snapshot_id = $2
                          AND s.id BETWEEN $3 AND $4
                        $q$,
                        CASE WHEN v_has_staging_confidence THEN 'coalesce(s.confidence_score, 50.0000)' ELSE '50.0000' END,
                        v_staging_schema,
                        cfg.staging_table
                    );
                    EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id, v_lo, v_hi;
                    GET DIAGNOSTICS v_batch = ROW_COUNT;
                    v_done := v_done + v_batch;

                    v_elapsed_s := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0));
                    IF v_staging_count > 0 THEN
                        v_pct := round(100.0 * v_done / v_staging_count, 2);
                    ELSE
                        v_pct := 100;
                    END IF;
                    IF v_done > 0 AND v_elapsed_s > 0 AND v_done < v_staging_count THEN
                        v_eta_s := (v_elapsed_s * (v_staging_count - v_done)) / v_done;
                    ELSE
                        v_eta_s := 0;
                    END IF;

                    RAISE NOTICE 'progress: %/% (%)%% stage07 family=landuse insert_f2 chunk=%-% batch=% eta_s=%',
                        v_done, v_staging_count, v_pct, v_lo, v_hi, v_batch, round(v_eta_s)::bigint;

                    v_lo := v_hi + 1;
                END LOOP;

                v_inserted_count := v_done;
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
                    jsonb_build_object(
                        'diff_run_id', v_diff_run_id,
                        'inserted', v_inserted_count,
                        'mode', 'landuse_fast_path',
                        'source_matches', v_building_source_match_count,
                        'spatial_matches', v_building_spatial_match_count,
                        'no_matches', v_building_no_match_count
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
                            'error_message', SQLERRM,
                            'mode', 'landuse_fast_path'
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
                        'mode', 'landuse_fast_path',
                        'landuse_match_counts',
                        jsonb_build_object(
                            'source_matches', v_building_source_match_count,
                            'spatial_matches', v_building_spatial_match_count,
                            'no_matches', v_building_no_match_count
                        ),
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
                'F2 landuse fast-path staging-vs-prod_mirror diff items written.'
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = v_diff_run_id
            GROUP BY item.auto_action;

            UPDATE stage07_diff_runs AS runs
            SET staging_rows = v_staging_count,
                prod_rows = v_prod_count
            WHERE runs.diff_run_id = v_diff_run_id;

            PERFORM pg_temp.stage07_write_family_summary(
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.staging_table),
                format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
                v_diff_run_id,
                v_staging_count,
                v_prod_count
            );

            RAISE NOTICE 'progress: %/% (100.00%%) stage07 family=landuse done',
                v_done, v_done;
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

        v_source_match_expr := '('
            || 'nullif(s.external_id, '''') IS NOT NULL AND ('
            || 'system.pipeline_osm_identity_matches(to_jsonb(p)->>''external_id'', s.external_id)'
            || ' OR system.pipeline_osm_identity_matches(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''external_id'', s.external_id)'
            || ' OR system.pipeline_osm_identity_matches(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_external_id'', s.external_id)'
            || ' OR (nullif(coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'', ''''), '''') IS NOT NULL'
            || '     AND coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_id'' = coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'')'
            || '     AND ('
            || '         nullif(coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type'', ''''), '''') IS NULL'
            || '         OR system.pipeline_osm_feature_type_canonical(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_feature_type'')'
            || '            IS NOT DISTINCT FROM system.pipeline_osm_feature_type_canonical(coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type''))'
            || '     ))'
            || '))';

        v_name_match_expr := format(
            '(%1$s IS NOT NULL AND %2$s IS NOT NULL AND lower(%1$s) = lower(%2$s))',
            v_staging_name_expr,
            v_prod_name_expr
        );

        v_spatial_expand_degrees := greatest(coalesce(cfg.spatial_threshold_m, 30) / 111320.0, 0.000001);

        -- Places: type-aware radius for settlements (city/town larger, neighbourhood denser).
        IF cfg.entity_family = 'places' THEN
            v_spatial_expand_degrees := greatest(500.0 / 111320.0, 0.000001);
        END IF;

        v_spatial_match_expr := 'false';

        IF v_has_staging_point AND v_has_prod_point THEN
            IF cfg.entity_family = 'places' THEN
                v_spatial_match_expr := v_spatial_match_expr || format(
                    ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, system.pipeline_places_duplicate_threshold_m(s.class_code)))',
                    cfg.staging_point_column,
                    cfg.prod_point_column,
                    coalesce(cfg.spatial_threshold_m, 30),
                    v_spatial_expand_degrees
                );
            ELSE
                v_spatial_match_expr := v_spatial_match_expr || format(
                    ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s))',
                    cfg.staging_point_column,
                    cfg.prod_point_column,
                    coalesce(cfg.spatial_threshold_m, 30),
                    v_spatial_expand_degrees
                );
            END IF;
        END IF;

        IF v_has_staging_point AND v_has_prod_geom THEN
            IF cfg.entity_family = 'places' THEN
                v_spatial_match_expr := v_spatial_match_expr || format(
                    ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, system.pipeline_places_duplicate_threshold_m(s.class_code)))',
                    cfg.staging_point_column,
                    cfg.prod_geom_column,
                    coalesce(cfg.spatial_threshold_m, 30),
                    v_spatial_expand_degrees
                );
            ELSE
                v_spatial_match_expr := v_spatial_match_expr || format(
                    ' OR (s.%1$I IS NOT NULL AND p.%2$I IS NOT NULL AND p.%2$I && ST_Expand(s.%1$I, %4$L) AND ST_DWithin(s.%1$I::geography, p.%2$I::geography, %3$s))',
                    cfg.staging_point_column,
                    cfg.prod_geom_column,
                    coalesce(cfg.spatial_threshold_m, 30),
                    v_spatial_expand_degrees
                );
            END IF;
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
                || 'system.pipeline_osm_identity_matches(to_jsonb(p)->>''external_id'', s.external_id)'
                || ' OR system.pipeline_osm_identity_matches(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''external_id'', s.external_id)'
                || ' OR system.pipeline_osm_identity_matches(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_external_id'', s.external_id)'
                || ' OR (nullif(coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'', ''''), '''') IS NOT NULL'
                || '     AND coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_id'' = coalesce(s.normalized_data->>''osm_id'', s.source_refs->>''osm_id'')'
                || '     AND ('
                || '         nullif(coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type'', ''''), '''') IS NULL'
                || '         OR system.pipeline_osm_feature_type_canonical(coalesce(to_jsonb(p)->''source_refs'', ''{}''::jsonb)->>''osm_feature_type'')'
                || '            IS NOT DISTINCT FROM system.pipeline_osm_feature_type_canonical(coalesce(s.normalized_data->>''osm_feature_type'', s.source_refs->>''osm_feature_type''))'
                || '     ))'
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
        ELSIF cfg.entity_family = 'places' THEN
            -- Dense-region performance: prefer identity-key equality (btree-friendly)
            -- and keep spatial as a separate indexed OR arm. Avoid scanning every
            -- prod row with multi-branch pipeline_osm_identity_matches() per candidate.
            v_source_match_expr := '('
                || 'nullif(s.external_id, '''') IS NOT NULL'
                || ' AND nullif(p.external_id, '''') IS NOT NULL'
                || ' AND system.pipeline_osm_identity_key(p.external_id)'
                || '     = system.pipeline_osm_identity_key(s.external_id)'
                || ')';
            v_match_where := format('(%s OR %s)', v_source_match_expr, v_spatial_match_expr);
            v_match_rank_expr := format(
                'CASE WHEN %1$s THEN 1 WHEN (%2$s AND (%3$s)) THEN 2 WHEN %2$s THEN 3 ELSE 9 END',
                v_source_match_expr,
                v_spatial_match_expr,
                v_name_match_expr
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

        -- Stable family comparison (not full-row to_jsonb).
        -- Roads use a dedicated branch above. Places use typed payloads here.
        -- Other families: compare allowlisted slim-mirror fields only.
        IF cfg.entity_family = 'places' THEN
            v_changed_expr := format(
                $c$
                system.pipeline_f2_places_changed(
                    system.pipeline_f2_places_staging_payload(
                        coalesce(to_jsonb(s)->>'canonical_name', to_jsonb(s)->>'primary_name'),
                        nullif(to_jsonb(s)->>'poi_category_id', '')::bigint,
                        %1$s,
                        nullif(to_jsonb(s)->>'admin_area_id', '')::bigint
                    ),
                    system.pipeline_f2_places_prod_payload(
                        coalesce(to_jsonb(p)->>'primary_name', to_jsonb(p)->>'canonical_name'),
                        to_jsonb(p)->>'display_name',
                        nullif(to_jsonb(p)->>'category_id', '')::bigint,
                        %2$s,
                        nullif(to_jsonb(p)->>'admin_area_id', '')::bigint,
                        CASE
                            WHEN nullif(to_jsonb(p)->>'deleted_at', '') IS NOT NULL
                                THEN (to_jsonb(p)->>'deleted_at')::timestamptz
                            ELSE NULL
                        END,
                        -- Only compare category when staging resolved one.
                        (nullif(to_jsonb(s)->>'poi_category_id', '') IS NOT NULL),
                        (nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL)
                    )
                )
                $c$,
                CASE
                    WHEN v_has_staging_point THEN format('s.%I', cfg.staging_point_column)
                    WHEN v_has_staging_geom THEN format('s.%I', cfg.staging_geom_column)
                    ELSE 'NULL::geometry'
                END,
                CASE
                    WHEN v_has_prod_point THEN format('p.%I', cfg.prod_point_column)
                    WHEN v_has_prod_geom THEN format('p.%I', cfg.prod_geom_column)
                    ELSE 'NULL::geometry'
                END
            );
        ELSIF cfg.entity_family = 'buildings' THEN
            v_changed_expr := format(
                $c$
                (
                    system.pipeline_meaningful_name(coalesce(to_jsonb(s)->>'canonical_name', to_jsonb(s)->>'name'))
                        IS DISTINCT FROM
                    system.pipeline_meaningful_name(coalesce(to_jsonb(p)->>'name', to_jsonb(p)->>'canonical_name'))
                    OR nullif(to_jsonb(s)->>'building_type_id', '')
                        IS DISTINCT FROM nullif(to_jsonb(p)->>'building_type_id', '')
                    OR (
                        nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                        AND nullif(to_jsonb(s)->>'admin_area_id', '')
                            IS DISTINCT FROM nullif(to_jsonb(p)->>'admin_area_id', '')
                    )
                    OR system.pipeline_geometry_meaningfully_changed(%1$s, %2$s)
                )
                $c$,
                CASE WHEN v_has_staging_geom THEN format('s.%I', cfg.staging_geom_column) ELSE 'NULL::geometry' END,
                CASE WHEN v_has_prod_geom THEN format('p.%I', cfg.prod_geom_column) ELSE 'NULL::geometry' END
            );
        ELSIF cfg.entity_family IN ('landuse', 'water_polygons', 'water_lines') THEN
            v_changed_expr := format(
                $c$
                (
                    system.pipeline_meaningful_name(coalesce(to_jsonb(s)->>'canonical_name', to_jsonb(s)->>'name'))
                        IS DISTINCT FROM
                    system.pipeline_meaningful_name(coalesce(to_jsonb(p)->>'name', to_jsonb(p)->>'canonical_name'))
                    OR system.pipeline_norm_text(to_jsonb(s)->>'class_code')
                        IS DISTINCT FROM system.pipeline_norm_text(to_jsonb(p)->>'class_code')
                    OR (
                        nullif(to_jsonb(s)->>'admin_area_id', '') IS NOT NULL
                        AND nullif(to_jsonb(s)->>'admin_area_id', '')
                            IS DISTINCT FROM nullif(to_jsonb(p)->>'admin_area_id', '')
                    )
                    OR system.pipeline_geometry_meaningfully_changed(%1$s, %2$s)
                )
                $c$,
                CASE WHEN v_has_staging_geom THEN format('s.%I', cfg.staging_geom_column) ELSE 'NULL::geometry' END,
                CASE WHEN v_has_prod_geom THEN format('p.%I', cfg.prod_geom_column) ELSE 'NULL::geometry' END
            );
        ELSE
            -- Fallback: still avoid full-row to_jsonb; compare name + class + geom only.
            v_changed_expr := format(
                $c$
                (
                    system.pipeline_meaningful_name(coalesce(
                        to_jsonb(s)->>'canonical_name', to_jsonb(s)->>'primary_name', to_jsonb(s)->>'name'
                    ))
                        IS DISTINCT FROM
                    system.pipeline_meaningful_name(coalesce(
                        to_jsonb(p)->>'canonical_name', to_jsonb(p)->>'primary_name', to_jsonb(p)->>'name'
                    ))
                    OR system.pipeline_norm_text(coalesce(to_jsonb(s)->>'class_code', to_jsonb(s)->>'road_class'))
                        IS DISTINCT FROM
                    system.pipeline_norm_text(coalesce(to_jsonb(p)->>'class_code', to_jsonb(p)->>'road_class'))
                    OR system.pipeline_geometry_meaningfully_changed(
                        COALESCE(%1$s, %2$s),
                        COALESCE(%3$s, %4$s)
                    )
                )
                $c$,
                CASE WHEN v_has_staging_point THEN format('s.%I', cfg.staging_point_column) ELSE 'NULL::geometry' END,
                CASE WHEN v_has_staging_geom THEN format('s.%I', cfg.staging_geom_column) ELSE 'NULL::geometry' END,
                CASE WHEN v_has_prod_point THEN format('p.%I', cfg.prod_point_column) ELSE 'NULL::geometry' END,
                CASE WHEN v_has_prod_geom THEN format('p.%I', cfg.prod_geom_column) ELSE 'NULL::geometry' END
            );
        END IF;

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

        PERFORM pg_temp.stage07_write_family_summary(
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.staging_table),
            format('%s.%s', v_prod_mirror_schema, cfg.prod_table),
            v_diff_run_id,
            v_staging_count,
            v_prod_count
        );
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
WHERE pg_temp.pipeline_entity_family_enabled(entity_family)
ORDER BY entity_family;

SELECT
    'stage07_family_summary' AS section,
    report.entity_family,
    report.staging_table,
    report.prod_table,
    max(report.value_n) FILTER (WHERE report.auto_action = 'staging_rows') AS staging_rows,
    max(report.value_n) FILTER (WHERE report.auto_action = 'prod_rows') AS prod_rows,
    max(report.value_n) FILTER (WHERE report.auto_action = 'new_candidate') AS new_candidate,
    max(report.value_n) FILTER (WHERE report.auto_action = 'matched_existing') AS matched_existing,
    max(report.value_n) FILTER (WHERE report.auto_action = 'protected_match') AS protected_match,
    max(report.value_n) FILTER (WHERE report.auto_action = 'needs_review') AS needs_review
FROM stage07_report AS report
WHERE report.auto_action IN (
    'staging_rows', 'prod_rows', 'new_candidate', 'matched_existing',
    'protected_match', 'needs_review'
)
GROUP BY report.entity_family, report.staging_table, report.prod_table
ORDER BY report.entity_family;

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
JOIN stage07_diff_runs AS selected
    ON selected.diff_run_id = run.id
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
        JOIN stage07_diff_runs AS selected
            ON selected.diff_run_id = run.id
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
