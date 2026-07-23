-- =============================================================================
-- Standalone Kyauktan dry-run: core vs PMTiles selection + reclassify 08b
-- for buildings / landuse / water only. No Supabase writes. No core load.
--
-- Usage:
--   psql "$LOCAL_DATABASE_URL" \
--     -v snapshot_version='osm_myanmar_2026_05_15_kyauktan_v2' \
--     -v staging_schema='staging' \
--     -v entity_families='buildings,landuse,water_lines,water_polygons' \
--     -f 19_core_pmtiles_selection_dry_run.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?entity_families}
\else
\set entity_families 'buildings,landuse,water_lines,water_polygons'
\endif
\if :{?prod_mirror_schema}
\else
\set prod_mirror_schema 'prod_mirror'
\endif

BEGIN;

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql
\ir pipeline_core_pmtiles_selection.sql

CREATE TEMP TABLE dryrun19_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO dryrun19_params VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE dryrun19_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO dryrun19_context
SELECT s.id, s.snapshot_version, p.staging_schema
FROM system.system_source_snapshots s
JOIN dryrun19_params p ON p.snapshot_version = s.snapshot_version;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dryrun19_context) THEN
        RAISE EXCEPTION 'snapshot_version not found';
    END IF;
END $$;

CREATE TEMP TABLE stage05_params (
    snapshot_version text,
    raw_schema text,
    staging_schema text,
    import_mode text
) ON COMMIT DROP;

INSERT INTO stage05_params
SELECT snapshot_version, 'raw', staging_schema, 'full'
FROM dryrun19_context;

CREATE TEMP TABLE stage05_context (
    source_snapshot_id bigint,
    snapshot_version text,
    region_code text,
    boundary_id bigint,
    boundary_mode text
) ON COMMIT DROP;

INSERT INTO stage05_context (source_snapshot_id, snapshot_version, region_code)
SELECT c.source_snapshot_id, c.snapshot_version, s.region_code
FROM dryrun19_context c
JOIN system.system_source_snapshots s ON s.id = c.source_snapshot_id;

CREATE TEMP TABLE stage05_report (
    section text,
    entity_family text,
    target_table text,
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

\ir pipeline_stage05c_core_pmtiles_selection.sql

-- Persist snapshot id for post-08b reporting (temp tables drop on COMMIT).
CREATE TABLE IF NOT EXISTS system.pipeline_dryrun19_last (
    snapshot_version text PRIMARY KEY,
    source_snapshot_id bigint NOT NULL,
    staging_schema text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system.pipeline_dryrun19_last (snapshot_version, source_snapshot_id, staging_schema)
SELECT snapshot_version, source_snapshot_id, staging_schema
FROM dryrun19_context
ON CONFLICT (snapshot_version) DO UPDATE
SET source_snapshot_id = EXCLUDED.source_snapshot_id,
    staging_schema = EXCLUDED.staging_schema,
    captured_at = now();

COMMIT;

-- Re-run 08b so import_class reflects pmtiles_only for non-core-eligible rows.
\ir 08b_assign_import_class.sql

\echo ''
\echo '=== core vs PMTiles dry-run summary ==='

CREATE TEMP TABLE dryrun19_context AS
SELECT source_snapshot_id, snapshot_version, staging_schema
FROM system.pipeline_dryrun19_last
WHERE snapshot_version = NULLIF(btrim(:'snapshot_version'), '');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dryrun19_context) THEN
        RAISE EXCEPTION 'dry-run context missing after Stage 08b';
    END IF;
END $$;

CREATE TEMP TABLE dryrun19_totals (
    entity_family text PRIMARY KEY,
    total_normalized bigint NOT NULL,
    core_eligible bigint NOT NULL,
    pmtiles_only bigint NOT NULL,
    invalid bigint NOT NULL,
    import_class_pmtiles_only bigint NOT NULL,
    import_class_direct_core bigint NOT NULL,
    import_class_ir_conflict bigint NOT NULL
);

DO $dryrun19_totals$
DECLARE
    ctx dryrun19_context%ROWTYPE;
    r record;
    v_sql text;
BEGIN
    SELECT * INTO STRICT ctx FROM dryrun19_context;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('buildings', 'staging_building_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_lines', 'staging_water_line_candidates'),
                ('water_polygons', 'staging_water_polygon_candidates')
        ) AS t(entity_family, staging_table)
    LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table)) IS NULL THEN
            CONTINUE;
        END IF;

        v_sql := format(
            $q$
            INSERT INTO dryrun19_totals
            SELECT
                %L,
                count(*),
                count(*) FILTER (WHERE eligible_for_core IS TRUE),
                count(*) FILTER (WHERE eligible_for_core IS FALSE),
                count(*) FILTER (
                    WHERE coalesce(validation_status, 'valid') IN ('invalid', 'blocked', 'failed')
                ),
                count(*) FILTER (WHERE import_class = 'pmtiles_only'),
                count(*) FILTER (WHERE import_class IN ('safe_new', 'safe_update')),
                count(*) FILTER (
                    WHERE import_class IN (
                        'duplicate', 'conflict', 'manual_protected', 'verified_conflict'
                    )
                )
            FROM %I.%I
            WHERE source_snapshot_id = $1
            $q$,
            r.entity_family,
            ctx.staging_schema,
            r.staging_table
        );
        EXECUTE v_sql USING ctx.source_snapshot_id;
    END LOOP;
END
$dryrun19_totals$;

SELECT 'selection_family_totals' AS section, * FROM dryrun19_totals ORDER BY entity_family;

SELECT
    'selection_grand_totals' AS section,
    sum(total_normalized) AS total_normalized,
    sum(core_eligible) AS core_eligible,
    sum(pmtiles_only) AS pmtiles_only,
    sum(invalid) AS invalid,
    sum(import_class_direct_core) AS direct_core_classes,
    sum(import_class_ir_conflict) AS ir_conflict_classes,
    sum(import_class_pmtiles_only) AS pmtiles_only_classes
FROM dryrun19_totals;

CREATE TEMP TABLE dryrun19_reasons (
    entity_family text,
    reason_kind text,
    reason text,
    n bigint
);

DO $dryrun19_reasons$
DECLARE
    ctx dryrun19_context%ROWTYPE;
    r record;
    v_sql text;
BEGIN
    SELECT * INTO STRICT ctx FROM dryrun19_context;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('buildings', 'staging_building_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_lines', 'staging_water_line_candidates'),
                ('water_polygons', 'staging_water_polygon_candidates')
        ) AS t(entity_family, staging_table)
    LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table)) IS NULL THEN
            CONTINUE;
        END IF;

        v_sql := format(
            $q$
            INSERT INTO dryrun19_reasons
            SELECT %L, 'core', core_selection_reason, count(*)
            FROM %I.%I
            WHERE source_snapshot_id = $1
              AND eligible_for_core IS TRUE
              AND core_selection_reason IS NOT NULL
            GROUP BY 3
            UNION ALL
            SELECT %L, 'pmtiles', pmtiles_only_reason, count(*)
            FROM %I.%I
            WHERE source_snapshot_id = $1
              AND eligible_for_core IS FALSE
              AND pmtiles_only_reason IS NOT NULL
            GROUP BY 3
            $q$,
            r.entity_family, ctx.staging_schema, r.staging_table,
            r.entity_family, ctx.staging_schema, r.staging_table
        );
        EXECUTE v_sql USING ctx.source_snapshot_id;
    END LOOP;
END
$dryrun19_reasons$;

SELECT
    'selection_reasons' AS section,
    entity_family,
    reason_kind,
    reason,
    n
FROM dryrun19_reasons
ORDER BY entity_family, reason_kind, n DESC, reason;

-- Gate check: no PMTiles-only row may carry direct-core or IR conflict classes.
DO $gate$
DECLARE
    ctx dryrun19_context%ROWTYPE;
    r record;
    v_bad bigint;
BEGIN
    SELECT * INTO STRICT ctx FROM dryrun19_context;
    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('buildings', 'staging_building_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_lines', 'staging_water_line_candidates'),
                ('water_polygons', 'staging_water_polygon_candidates')
        ) AS t(entity_family, staging_table)
    LOOP
        EXECUTE format(
            $q$
            SELECT count(*) FROM %I.%I
            WHERE source_snapshot_id = $1
              AND eligible_for_core IS FALSE
              AND import_class IN (
                  'safe_new', 'safe_update', 'duplicate', 'conflict',
                  'manual_protected', 'verified_conflict'
              )
            $q$,
            ctx.staging_schema, r.staging_table
        )
        INTO v_bad
        USING ctx.source_snapshot_id;

        IF v_bad > 0 THEN
            RAISE EXCEPTION
                'gate failed: % has % PMTiles-only rows with direct-core/IR import_class',
                r.entity_family, v_bad;
        END IF;
    END LOOP;
END
$gate$;

SELECT 'gate_check' AS section, 'PASS' AS status,
       'PMTiles-only rows are not in direct-core or IR conflict classes' AS note;