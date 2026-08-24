-- =============================================================================
-- Stage 06: diff_current_vs_previous (F1)
-- Compare current OSM staging candidates to the previous OSM staging snapshot.
--
-- Scope:
--   - Local database only.
--   - Snapshot-vs-snapshot only: current OSM staging vs previous OSM staging.
--   - Writes system.system_diff_runs / system.system_diff_items.
--   - Writes staging.source_status for current rows (not deleted/missing).
--   - Does not write core or Supabase.
--
-- Compare keys (preferred):
--   pipeline_osm_identity_key(external_id) + normalized_hash
--   (geometry is already inside content hash; do not re-diff raw JSON fields)
--
-- Diff item types stay legacy for Stage 08:
--   new | changed | unchanged | deleted_candidate
-- Staging source_status uses:
--   source_new | source_changed | source_unchanged
-- deleted_candidate → report as source_missing (no current row to update)
--
-- Input psql variables:
--   snapshot_version
--   staging_schema optional, defaults to staging
--   entity_families  optional; default all (see pipeline_entity_families.sql)
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

\ir pipeline_source_identity.sql
\ir pipeline_candidate_validation.sql

-- Content-hash helper only (do NOT include pipeline_stage05_reset.sql here —
-- that file also deletes current-snapshot staging).
CREATE SCHEMA IF NOT EXISTS system;
CREATE OR REPLACE FUNCTION system.pipeline_staging_content_hash(
    p_external_id text,
    p_normalized_data jsonb,
    p_geom geometry DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(
        coalesce(nullif(btrim(p_external_id), ''), '')
        || E'\n'
        || coalesce(p_normalized_data, '{}'::jsonb)::text
        || E'\n'
        || CASE
            WHEN p_geom IS NULL THEN ''
            ELSE encode(
                ST_AsBinary(ST_SnapToGrid(ST_Force2D(p_geom), 0.0000001)),
                'hex'
            )
        END
    );
$$;

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
    ('settlements', 'staging_settlement_candidates', false, 'point_geom', NULL, NULL, NULL, 10, NULL, NULL, NULL, NULL, NULL, NULL, false),
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

\ir pipeline_entity_families.sql

DELETE FROM stage06_family_config AS fc
WHERE NOT pg_temp.pipeline_entity_family_enabled(fc.entity_family);

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
  AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
  AND (
      pg_temp.pipeline_entity_families_is_all()
      OR pg_temp.pipeline_entity_family_enabled(run.entity_family)
  );

DELETE FROM system.system_diff_runs AS run
USING stage06_context AS ctx
WHERE run.current_snapshot_id = ctx.current_snapshot_id
  AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
  AND (
      pg_temp.pipeline_entity_families_is_all()
      OR pg_temp.pipeline_entity_family_enabled(run.entity_family)
  );

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

\ir pipeline_stage06_hash_diff.sql

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
