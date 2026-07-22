-- =============================================================================
-- Per-family validation + previous-snapshot (F1) report.
-- Local DB only. Does not write Supabase.
--
-- psql vars:
--   snapshot_version
--   staging_schema optional (default staging)
--   entity_families optional
--   raw_schema optional (default raw)
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

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql
\ir pipeline_candidate_validation.sql

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS report17_params (
    snapshot_version text,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE report17_params;

INSERT INTO report17_params (snapshot_version, staging_schema, raw_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw')
);

CREATE TEMP TABLE IF NOT EXISTS report17_family (
    entity_family text PRIMARY KEY,
    stage05_key text NOT NULL,
    staging_table text NOT NULL,
    raw_feature_hint text
) ON COMMIT DROP;

TRUNCATE report17_family;

INSERT INTO report17_family (entity_family, stage05_key, staging_table, raw_feature_hint)
VALUES
    ('admin_areas', 'admin_area', 'staging_admin_area_candidates', 'admin'),
    ('roads', 'road', 'staging_road_candidates', 'road'),
    ('places', 'place', 'staging_place_candidates', 'place'),
    ('buildings', 'building', 'staging_building_candidates', 'building'),
    ('landuse', 'landuse', 'staging_landuse_candidates', 'landuse'),
    ('water_lines', 'water_line', 'staging_water_line_candidates', 'water'),
    ('water_polygons', 'water_polygon', 'staging_water_polygon_candidates', 'water'),
    ('routing_barriers', 'routing_barrier', 'staging_routing_barrier_candidates', 'barrier');

DELETE FROM report17_family AS f
WHERE NOT pg_temp.pipeline_entity_family_enabled(f.entity_family);

CREATE TEMP TABLE IF NOT EXISTS report17_rows (
    entity_family text NOT NULL,
    raw_count bigint NOT NULL DEFAULT 0,
    normalized_count bigint NOT NULL DEFAULT 0,
    valid_count bigint NOT NULL DEFAULT 0,
    warning_count bigint NOT NULL DEFAULT 0,
    invalid_count bigint NOT NULL DEFAULT 0,
    source_new bigint NOT NULL DEFAULT 0,
    source_changed bigint NOT NULL DEFAULT 0,
    source_unchanged bigint NOT NULL DEFAULT 0,
    source_missing bigint NOT NULL DEFAULT 0,
    valid_without_source_status bigint NOT NULL DEFAULT 0,
    normalized_without_validation bigint NOT NULL DEFAULT 0,
    note text
) ON COMMIT DROP;

TRUNCATE report17_rows;

DO $report17$
DECLARE
    v_staging text;
    v_raw text;
    v_snapshot_version text;
    v_snapshot_id bigint;
    f record;
    v_sql text;
    v_raw_count bigint;
    v_norm bigint;
    v_valid bigint;
    v_warn bigint;
    v_invalid bigint;
    v_new bigint;
    v_changed bigint;
    v_unchanged bigint;
    v_missing bigint;
    v_valid_no_source bigint;
    v_no_validation bigint;
BEGIN
    SELECT snapshot_version, staging_schema, raw_schema
    INTO v_snapshot_version, v_staging, v_raw
    FROM report17_params;

    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    SELECT id INTO v_snapshot_id
    FROM system.system_source_snapshots
    WHERE snapshot_version = v_snapshot_version;

    IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'snapshot_version "%" not found', v_snapshot_version;
    END IF;

    FOR f IN SELECT * FROM report17_family ORDER BY entity_family LOOP
        v_raw_count := 0;
        IF to_regclass(format('%I.osm_features', v_raw)) IS NOT NULL THEN
            -- Best-effort raw count: features that produced staging for this family
            -- are counted via staging raw_id when present; else 0.
            NULL;
        END IF;

        IF to_regclass(format('%I.%I', v_staging, f.staging_table)) IS NULL THEN
            INSERT INTO report17_rows (entity_family, note)
            VALUES (f.entity_family, 'staging table missing');
            CONTINUE;
        END IF;

        v_sql := format(
            $q$
            SELECT
                count(*)::bigint,
                count(*) FILTER (WHERE validation_status = 'valid')::bigint,
                count(*) FILTER (WHERE validation_status = 'warning')::bigint,
                count(*) FILTER (WHERE validation_status = 'invalid')::bigint,
                count(*) FILTER (WHERE source_status = 'source_new')::bigint,
                count(*) FILTER (WHERE source_status = 'source_changed')::bigint,
                count(*) FILTER (WHERE source_status = 'source_unchanged')::bigint,
                count(*) FILTER (
                    WHERE validation_status = 'valid'
                      AND (source_status IS NULL OR btrim(source_status) = '')
                )::bigint,
                count(*) FILTER (
                    WHERE validation_status IS NULL OR btrim(validation_status) = ''
                )::bigint
            FROM %I.%I
            WHERE source_snapshot_id = $1
            $q$,
            v_staging,
            f.staging_table
        );
        EXECUTE v_sql
            INTO v_norm, v_valid, v_warn, v_invalid, v_new, v_changed, v_unchanged,
                 v_valid_no_source, v_no_validation
            USING v_snapshot_id;

        -- Prefer distinct raw_id when column exists.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging
              AND table_name = f.staging_table
              AND column_name = 'raw_id'
        ) THEN
            EXECUTE format(
                'SELECT count(DISTINCT raw_id)::bigint FROM %I.%I WHERE source_snapshot_id = $1 AND raw_id IS NOT NULL',
                v_staging, f.staging_table
            ) INTO v_raw_count USING v_snapshot_id;
            IF v_raw_count = 0 THEN
                v_raw_count := v_norm;
            END IF;
        ELSE
            v_raw_count := v_norm;
        END IF;

        SELECT coalesce(count(*), 0)::bigint
        INTO v_missing
        FROM system.system_diff_items AS item
        INNER JOIN system.system_diff_runs AS run
            ON run.id = item.diff_run_id
        WHERE run.current_snapshot_id = v_snapshot_id
          AND run.entity_family = f.entity_family
          AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
          AND item.diff_type = 'deleted_candidate';

        INSERT INTO report17_rows (
            entity_family,
            raw_count,
            normalized_count,
            valid_count,
            warning_count,
            invalid_count,
            source_new,
            source_changed,
            source_unchanged,
            source_missing,
            valid_without_source_status,
            normalized_without_validation,
            note
        )
        VALUES (
            f.entity_family,
            v_raw_count,
            v_norm,
            v_valid,
            v_warn,
            v_invalid,
            v_new,
            v_changed,
            v_unchanged,
            v_missing,
            v_valid_no_source,
            v_no_validation,
            CASE
                WHEN v_no_validation > 0 THEN 'FAIL: normalized rows missing validation_status'
                WHEN v_valid_no_source > 0 THEN 'FAIL: valid rows missing source_status'
                ELSE 'PASS'
            END
        );
    END LOOP;
END
$report17$;

SELECT
    'validation_source_family_report' AS section,
    entity_family,
    raw_count AS raw,
    normalized_count AS normalized,
    valid_count AS valid,
    warning_count AS warning,
    invalid_count AS invalid,
    source_new,
    source_changed,
    source_unchanged,
    source_missing,
    valid_without_source_status,
    normalized_without_validation,
    note
FROM report17_rows
ORDER BY entity_family;

SELECT
    'validation_source_summary' AS section,
    count(*) AS families,
    sum(normalized_count) AS normalized_total,
    sum(valid_count) AS valid_total,
    sum(warning_count) AS warning_total,
    sum(invalid_count) AS invalid_total,
    sum(source_new + source_changed + source_unchanged) AS current_with_source_status,
    sum(source_missing) AS source_missing_total,
    sum(valid_without_source_status) AS valid_without_source_status,
    sum(normalized_without_validation) AS normalized_without_validation,
    CASE
        WHEN sum(normalized_without_validation) > 0 OR sum(valid_without_source_status) > 0 THEN 'FAIL'
        ELSE 'PASS'
    END AS status
FROM report17_rows;

COMMIT;
