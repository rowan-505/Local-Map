-- =============================================================================
-- Stage 00b: cleanup_current_snapshot (after create_admin_snapshot)
--
-- Prepares scratch/raw/staging for a (re)run of the current snapshot_version.
-- Does not delete system snapshots/batches or core.core_admin_areas.
--
-- psql variables: snapshot_version, tmp_admin_schema, raw_schema, staging_schema
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?tmp_admin_schema}
\else
\set tmp_admin_schema 'tmp_admin_import'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE cleanup_params (
    snapshot_version text NOT NULL,
    tmp_admin_schema text NOT NULL,
    raw_schema text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO cleanup_params (snapshot_version, tmp_admin_schema, raw_schema, staging_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(nullif(trim(:'tmp_admin_schema'), ''), 'tmp_admin_import'),
    coalesce(nullif(trim(:'raw_schema'), ''), 'raw'),
    coalesce(nullif(trim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE cleanup_report (
    step text NOT NULL,
    detail text NOT NULL,
    deleted_rows bigint
) ON COMMIT DROP;

DO $cleanup$
DECLARE
    p cleanup_params%ROWTYPE;
    v_snapshot_id bigint;
    v_deleted bigint;
    v_raw_polygons regclass;
    v_staging_admin regclass;
    v_sql text;
BEGIN
    SELECT * INTO p FROM cleanup_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    SELECT s.id
    INTO v_snapshot_id
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version;

    IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', p.snapshot_version;
    END IF;

    INSERT INTO cleanup_report (step, detail, deleted_rows)
    VALUES (
        'resolve_snapshot',
        format('source_snapshot_id=%s snapshot_version=%s', v_snapshot_id, p.snapshot_version),
        0
    );

    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', p.tmp_admin_schema);
    EXECUTE format('CREATE SCHEMA %I', p.tmp_admin_schema);

    INSERT INTO cleanup_report (step, detail, deleted_rows)
    VALUES (
        'tmp_admin_schema',
        format('dropped and recreated schema %I', p.tmp_admin_schema),
        0
    );

    v_raw_polygons := to_regclass(format('%I.raw_osm_polygons', p.raw_schema));
    IF v_raw_polygons IS NULL THEN
        INSERT INTO cleanup_report (step, detail, deleted_rows)
        VALUES (
            'raw_osm_polygons',
            format('table %I.raw_osm_polygons does not exist — skipped', p.raw_schema),
            0
        );
    ELSE
        v_sql := format(
            'DELETE FROM %I.raw_osm_polygons WHERE source_snapshot_id = $1',
            p.raw_schema
        );
        EXECUTE v_sql USING v_snapshot_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        INSERT INTO cleanup_report (step, detail, deleted_rows)
        VALUES (
            'raw_osm_polygons',
            format(
                'deleted rows for source_snapshot_id=%s from %I.raw_osm_polygons',
                v_snapshot_id,
                p.raw_schema
            ),
            v_deleted
        );
    END IF;

    v_staging_admin := to_regclass(format('%I.staging_admin_area_candidates', p.staging_schema));
    IF v_staging_admin IS NULL THEN
        INSERT INTO cleanup_report (step, detail, deleted_rows)
        VALUES (
            'staging_admin_area_candidates',
            format('table %I.staging_admin_area_candidates does not exist — skipped', p.staging_schema),
            0
        );
    ELSE
        v_sql := format(
            'DELETE FROM %I.staging_admin_area_candidates WHERE source_snapshot_id = $1',
            p.staging_schema
        );
        EXECUTE v_sql USING v_snapshot_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        INSERT INTO cleanup_report (step, detail, deleted_rows)
        VALUES (
            'staging_admin_area_candidates',
            format(
                'deleted rows for source_snapshot_id=%s from %I.staging_admin_area_candidates',
                v_snapshot_id,
                p.staging_schema
            ),
            v_deleted
        );
    END IF;
END
$cleanup$;

SELECT step, detail, deleted_rows
FROM cleanup_report
ORDER BY step, detail;

COMMIT;
