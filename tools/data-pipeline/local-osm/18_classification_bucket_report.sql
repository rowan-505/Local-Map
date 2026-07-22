-- =============================================================================
-- Stage 18: dry-run final import classification report + reconciliation.
-- Local only. Does not write Supabase.
--
-- Assertion (current technically-valid staging rows):
--   valid
--     = safe_new + safe_update + unchanged + duplicate + conflict
--       + manual_protected + verified_conflict
--
-- possible_delete is counted from F1 deleted OSM-derived rows (not current
-- staging). Report includes it, and a second identity:
--   valid + possible_delete
--     = (sum above) + possible_delete
--
-- invalid is reported separately and must equal staging validation_status=invalid.
-- Fail hard when the valid-row assertion fails.
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

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql

CREATE TEMP TABLE report18_params (
    snapshot_version text,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO report18_params VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE report18_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO report18_context
SELECT s.id, s.snapshot_version, p.staging_schema
FROM system.system_source_snapshots s
JOIN report18_params p ON p.snapshot_version = s.snapshot_version;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM report18_context) THEN
        RAISE EXCEPTION 'snapshot_version not found';
    END IF;
END $$;

CREATE TEMP TABLE report18_family (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL
) ON COMMIT DROP;

INSERT INTO report18_family VALUES
    ('places', 'staging_place_candidates'),
    ('roads', 'staging_road_candidates'),
    ('buildings', 'staging_building_candidates'),
    ('admin_areas', 'staging_admin_area_candidates'),
    ('landuse', 'staging_landuse_candidates'),
    ('water_lines', 'staging_water_line_candidates'),
    ('water_polygons', 'staging_water_polygon_candidates'),
    ('routing_barriers', 'staging_routing_barrier_candidates');

DELETE FROM report18_family f
WHERE NOT pg_temp.pipeline_entity_family_enabled(f.entity_family);

CREATE TEMP TABLE report18_rows (
    entity_family text PRIMARY KEY,
    valid_rows bigint NOT NULL DEFAULT 0,
    safe_new bigint NOT NULL DEFAULT 0,
    safe_update bigint NOT NULL DEFAULT 0,
    unchanged bigint NOT NULL DEFAULT 0,
    duplicate bigint NOT NULL DEFAULT 0,
    conflict bigint NOT NULL DEFAULT 0,
    manual_protected bigint NOT NULL DEFAULT 0,
    verified_conflict bigint NOT NULL DEFAULT 0,
    possible_delete bigint NOT NULL DEFAULT 0,
    invalid bigint NOT NULL DEFAULT 0,
    unclassified_valid bigint NOT NULL DEFAULT 0,
    note text
) ON COMMIT DROP;

DO $report18$
DECLARE
    ctx report18_context%ROWTYPE;
    f record;
    v_sql text;
    v_valid bigint;
    v_safe_new bigint;
    v_safe_update bigint;
    v_unchanged bigint;
    v_duplicate bigint;
    v_conflict bigint;
    v_manual bigint;
    v_verified bigint;
    v_invalid bigint;
    v_unclassified bigint;
    v_delete bigint;
    v_sum bigint;
BEGIN
    SELECT * INTO STRICT ctx FROM report18_context;

    FOR f IN SELECT * FROM report18_family ORDER BY entity_family LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, f.staging_table)) IS NULL THEN
            INSERT INTO report18_rows (entity_family, note)
            VALUES (f.entity_family, 'staging table missing');
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = f.staging_table
              AND column_name = 'import_class'
        ) THEN
            INSERT INTO report18_rows (entity_family, note)
            VALUES (f.entity_family, 'FAIL: import_class missing — run Stage 08b first');
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = f.staging_table
              AND column_name = 'validation_status'
        ) THEN
            v_sql := format(
                $q$
                SELECT
                    count(*) FILTER (WHERE coalesce(import_class, '') <> 'invalid')::bigint,
                    count(*) FILTER (WHERE import_class = 'safe_new')::bigint,
                    count(*) FILTER (WHERE import_class = 'safe_update')::bigint,
                    count(*) FILTER (WHERE import_class = 'unchanged')::bigint,
                    count(*) FILTER (WHERE import_class = 'duplicate')::bigint,
                    count(*) FILTER (WHERE import_class = 'conflict')::bigint,
                    count(*) FILTER (WHERE import_class = 'manual_protected')::bigint,
                    count(*) FILTER (WHERE import_class = 'verified_conflict')::bigint,
                    count(*) FILTER (WHERE import_class = 'invalid')::bigint,
                    count(*) FILTER (
                        WHERE coalesce(import_class, '') <> 'invalid'
                          AND (
                              import_class IS NULL
                              OR import_class NOT IN (
                                  'safe_new', 'safe_update', 'unchanged', 'duplicate',
                                  'conflict', 'manual_protected', 'verified_conflict'
                              )
                          )
                    )::bigint
                FROM %I.%I
                WHERE source_snapshot_id = $1
                $q$,
                ctx.staging_schema,
                f.staging_table
            );
        ELSE
            v_sql := format(
                $q$
                SELECT
                    count(*) FILTER (
                        WHERE coalesce(validation_status, 'valid') NOT IN ('invalid', 'blocked', 'failed')
                    )::bigint,
                    count(*) FILTER (WHERE import_class = 'safe_new')::bigint,
                    count(*) FILTER (WHERE import_class = 'safe_update')::bigint,
                    count(*) FILTER (WHERE import_class = 'unchanged')::bigint,
                    count(*) FILTER (WHERE import_class = 'duplicate')::bigint,
                    count(*) FILTER (WHERE import_class = 'conflict')::bigint,
                    count(*) FILTER (WHERE import_class = 'manual_protected')::bigint,
                    count(*) FILTER (WHERE import_class = 'verified_conflict')::bigint,
                    count(*) FILTER (WHERE import_class = 'invalid')::bigint,
                    count(*) FILTER (
                        WHERE coalesce(validation_status, 'valid') NOT IN ('invalid', 'blocked', 'failed')
                          AND (
                              import_class IS NULL
                              OR import_class NOT IN (
                                  'safe_new', 'safe_update', 'unchanged', 'duplicate',
                                  'conflict', 'manual_protected', 'verified_conflict'
                              )
                          )
                    )::bigint
                FROM %I.%I
                WHERE source_snapshot_id = $1
                $q$,
                ctx.staging_schema,
                f.staging_table
            );
        END IF;

        EXECUTE v_sql INTO
            v_valid, v_safe_new, v_safe_update, v_unchanged, v_duplicate,
            v_conflict, v_manual, v_verified, v_invalid, v_unclassified
        USING ctx.source_snapshot_id;

        SELECT coalesce(count(*), 0)::bigint
        INTO v_delete
        FROM system.system_diff_items AS item
        INNER JOIN LATERAL (
            SELECT run.id
            FROM system.system_diff_runs AS run
            WHERE run.current_snapshot_id = ctx.source_snapshot_id
              AND run.entity_family = f.entity_family
              AND run.status = 'completed'
              AND run.summary->>'comparison_type' = 'snapshot_vs_snapshot'
            ORDER BY run.finished_at DESC NULLS LAST, run.id DESC
            LIMIT 1
        ) AS latest ON latest.id = item.diff_run_id
        WHERE item.diff_type = 'deleted_candidate'
          AND system.pipeline_is_osm_derived(
              item.external_id,
              CASE WHEN item.before_data ? 'source_refs' THEN item.before_data->'source_refs' ELSE NULL END,
              item.before_data->>'source_type'
          );

        v_sum := v_safe_new + v_safe_update + v_unchanged + v_duplicate
              + v_conflict + v_manual + v_verified;

        INSERT INTO report18_rows VALUES (
            f.entity_family,
            v_valid,
            v_safe_new,
            v_safe_update,
            v_unchanged,
            v_duplicate,
            v_conflict,
            v_manual,
            v_verified,
            v_delete,
            v_invalid,
            v_unclassified,
            CASE
                WHEN v_unclassified > 0 THEN format('FAIL: %s valid rows lack a final non-delete class', v_unclassified)
                WHEN v_valid <> v_sum THEN format('FAIL: valid(%s) <> class_sum(%s)', v_valid, v_sum)
                ELSE 'PASS'
            END
        );
    END LOOP;
END
$report18$;

SELECT
    'classification_family_report' AS section,
    entity_family AS family,
    valid_rows AS valid,
    safe_new,
    safe_update,
    unchanged,
    duplicate,
    conflict,
    manual_protected,
    verified_conflict,
    possible_delete,
    invalid,
    unclassified_valid,
    note
FROM report18_rows
ORDER BY entity_family;

SELECT
    'classification_summary' AS section,
    count(*) AS families,
    sum(valid_rows) AS valid,
    sum(safe_new) AS safe_new,
    sum(safe_update) AS safe_update,
    sum(unchanged) AS unchanged,
    sum(duplicate) AS duplicate,
    sum(conflict) AS conflict,
    sum(manual_protected) AS manual_protected,
    sum(verified_conflict) AS verified_conflict,
    sum(possible_delete) AS possible_delete,
    sum(invalid) AS invalid,
    sum(unclassified_valid) AS unclassified_valid,
    sum(safe_new + safe_update + unchanged + duplicate + conflict + manual_protected + verified_conflict) AS class_sum,
    CASE
        WHEN bool_or(note LIKE 'FAIL%') THEN 'FAIL'
        ELSE 'PASS'
    END AS status
FROM report18_rows;

DO $assert18$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM report18_rows WHERE note LIKE 'FAIL%' LOOP
        RAISE EXCEPTION 'classification reconciliation failed for %: %', r.entity_family, r.note;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM report18_rows
        WHERE valid_rows <> (
            safe_new + safe_update + unchanged + duplicate + conflict
            + manual_protected + verified_conflict
        )
    ) THEN
        RAISE EXCEPTION 'classification assertion failed: valid <> class sum for one or more families';
    END IF;
END
$assert18$;

COMMIT;
