-- =============================================================================
-- Stage 03: validate_tmp (read-only validation; session temp scaffolding only)
-- Sanity checks before tmp_import -> raw.
--
-- psql vars: :tmp_import_schema (runner sets TMP_IMPORT_SCHEMA; defaults to tmp_import)
--
-- NULL geometry rows are WARN because Stage D skips them before raw insert.
--
-- Hard fail (second DO block raises; psql ON_ERROR_STOP stops the client):
--   - required tmp_import table(s) for import mode missing
--   - all required tables empty (row count sum = 0)
--   - zero rows with non-null geometry across required tables
--   - any non-null geometry with ST_SRID <> 4326
--
-- Import mode (from ENTITY_FAMILIES):
--   admin_areas only → osm_admin_polygons
--   roads only       → osm_road_lines
--   all / multiple   → osm_points, osm_lines, osm_polygons
--
-- WARN (per-row metrics + FINAL_SUMMARY WARN when any apply): NULL geometry counts,
-- invalid geometry (ST_IsValid false), null osm_id, empty/null jsonb tags.
--
-- Does not INSERT/UPDATE/DELETE user data in raw, staging, core, system.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?tmp_import_schema}
\else
\set tmp_import_schema 'tmp_import'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

\ir pipeline_entity_families.sql
\ir pipeline_tmp_import_mode.sql

CREATE TEMP TABLE IF NOT EXISTS _stage03_tables (
    tbl text NOT NULL PRIMARY KEY
);

TRUNCATE _stage03_tables;

INSERT INTO _stage03_tables (tbl)
SELECT unnest(
    CASE mode.import_mode
        WHEN 'admin_areas_only' THEN ARRAY['osm_admin_polygons']::text[]
        WHEN 'roads_only' THEN ARRAY['osm_road_lines']::text[]
        ELSE ARRAY['osm_points', 'osm_lines', 'osm_polygons']::text[]
    END
)
FROM _pipeline_tmp_import_mode AS mode;

CREATE TEMP TABLE IF NOT EXISTS _stage03_cfg (
    schema_name text NOT NULL PRIMARY KEY
);

TRUNCATE _stage03_cfg;

INSERT INTO _stage03_cfg (schema_name)
VALUES (coalesce(nullif(trim(:'tmp_import_schema'), ''), 'tmp_import'));

CREATE TEMP TABLE IF NOT EXISTS _stage03_report (
    section text NOT NULL,
    scope text NOT NULL,
    metric text NOT NULL,
    tbl text,
    bucket text,
    n bigint,
    status text NOT NULL
);

TRUNCATE _stage03_report;

-- -----------------------------------------------------------------------------
-- Populate report (never raises — survives autocommit so output is visible)
-- -----------------------------------------------------------------------------
DO $_$
DECLARE
    s text;
    t text;
    tbl_rec record;

    v_has_table boolean;
    v_count bigint;
    v_null_geom bigint;
    v_bad_geom bigint;
    v_null_osm bigint;
    v_bad_tags bigint;

    total_rows bigint := 0;

    rec record;
    invalid_srid boolean := false;
    qr text;

    summary_status text := 'PASS';
    summary_notes text := '';

    null_geom_total bigint := 0;
    usable_geom_total bigint := 0;
    invalid_geom_total bigint := 0;
    null_osm_total bigint := 0;
    empty_tags_total bigint := 0;

    missing_required boolean := false;
BEGIN
    SELECT cfg.schema_name
    INTO STRICT s
    FROM _stage03_cfg AS cfg;

    FOR tbl_rec IN SELECT tbl FROM _stage03_tables ORDER BY tbl
    LOOP
        t := tbl_rec.tbl;

        SELECT exists (
            SELECT 1
            FROM information_schema.tables AS info
            WHERE info.table_schema = s
              AND info.table_name = t
              AND info.table_type = 'BASE TABLE'
        )
        INTO v_has_table;

        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES (
            'existence', 'global', 'table_exists', t, NULL, NULL,
            CASE WHEN v_has_table THEN 'PASS' ELSE 'FAIL' END
        );

        IF NOT v_has_table THEN
            missing_required := true;
            CONTINUE;
        END IF;

        qr := format('select count(*)::bigint from %I.%I', s, t);
        EXECUTE qr INTO v_count;
        total_rows := total_rows + coalesce(v_count, 0);

        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('row_count', t, 'row_count', t, NULL, v_count, 'PASS');

        qr := format(
            $q$
                select st_srid(geom)::integer as srid, count(*)::bigint as c
                from %I.%I
                where geom is not null
                group by 1
                order by 1
            $q$,
            s, t
        );

        FOR rec IN EXECUTE qr
        LOOP
            INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
            VALUES (
                'srid',
                t,
                'srid_count',
                t,
                rec.srid::text,
                rec.c,
                CASE WHEN rec.srid = 4326 THEN 'PASS' ELSE 'FAIL' END
            );

            IF rec.srid IS DISTINCT FROM 4326 THEN
                invalid_srid := true;
            END IF;
        END LOOP;

        qr := format(
            $q$
                select
                    count(*) filter (where geom is null)::bigint,
                    count(*) filter (where geom is not null and not st_isvalid(geom))::bigint,
                    count(*) filter (where osm_id is null)::bigint,
                    count(*) filter (
                        where tags is null or tags = '{}'::jsonb or jsonb_typeof(tags) = 'null'
                    )::bigint
                from %I.%I
            $q$,
            s, t
        );
        EXECUTE qr INTO v_null_geom, v_bad_geom, v_null_osm, v_bad_tags;

        null_geom_total := null_geom_total + coalesce(v_null_geom, 0);
        usable_geom_total := usable_geom_total + (coalesce(v_count, 0) - coalesce(v_null_geom, 0));
        invalid_geom_total := invalid_geom_total + coalesce(v_bad_geom, 0);
        null_osm_total := null_osm_total + coalesce(v_null_osm, 0);
        empty_tags_total := empty_tags_total + coalesce(v_bad_tags, 0);

        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES
            ('geom_null', t, 'null_geometry_count', t, NULL, v_null_geom,
                CASE WHEN v_null_geom = 0 THEN 'PASS' ELSE 'WARN' END),
            ('geom_valid', t, 'invalid_geometry_count', t, NULL, v_bad_geom,
                CASE WHEN v_bad_geom = 0 THEN 'PASS' ELSE 'WARN' END),
            ('osm_id', t, 'null_osm_id_count', t, NULL, v_null_osm,
                CASE WHEN v_null_osm = 0 THEN 'PASS' ELSE 'WARN' END),
            ('tags', t, 'null_or_empty_tags_count', t, NULL, v_bad_tags,
                CASE WHEN v_bad_tags = 0 THEN 'PASS' ELSE 'WARN' END);
    END LOOP;

    IF missing_required THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'missing-required-tables', NULL, 'FAIL');
        RETURN;
    END IF;

    IF total_rows = 0 THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'all-tables-empty', 0, 'FAIL');
        RETURN;
    END IF;

    IF invalid_srid THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'non-4326-srid', NULL, 'FAIL');
        RETURN;
    END IF;

    INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
    VALUES (
        'usable_geom',
        'global',
        'non_null_geometry_row_count',
        NULL,
        NULL,
        usable_geom_total,
        CASE WHEN usable_geom_total > 0 THEN 'PASS' ELSE 'FAIL' END
    );

    IF usable_geom_total = 0 THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'no-usable-non-null-geometries', total_rows, 'FAIL');
        RETURN;
    END IF;

    summary_notes := format(
        'rows=%s null_geom=%s usable_non_null_geom=%s invalid_geom=%s null_osm_id=%s empty_tags=%s',
        total_rows,
        null_geom_total,
        usable_geom_total,
        invalid_geom_total,
        null_osm_total,
        empty_tags_total
    );

    IF null_geom_total > 0
        OR invalid_geom_total > 0
        OR null_osm_total > 0
        OR empty_tags_total > 0
    THEN
        summary_status := 'WARN';
    END IF;

    INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
    VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, summary_notes, total_rows, summary_status);
END
$_$;

SELECT
    section,
    scope,
    metric,
    tbl AS table_name,
    bucket,
    n AS value_n,
    status
FROM _stage03_report
ORDER BY
    CASE section
        WHEN 'existence' THEN 1
        WHEN 'row_count' THEN 2
        WHEN 'usable_geom' THEN 3
        WHEN 'srid' THEN 4
        WHEN 'geom_null' THEN 5
        WHEN 'geom_valid' THEN 6
        WHEN 'osm_id' THEN 7
        WHEN 'tags' THEN 8
        WHEN 'summary' THEN 9
        ELSE 10
    END,
    COALESCE(tbl, ''),
    COALESCE(bucket, ''),
    metric;

DO $_$
DECLARE
    v_bucket text;
    v_n bigint;
BEGIN
    IF exists (
        SELECT 1
        FROM _stage03_report AS r
        WHERE r.section = 'summary'
          AND r.metric = 'FINAL_SUMMARY'
          AND r.status = 'FAIL'
    ) THEN
        SELECT r.bucket, r.n
        INTO v_bucket, v_n
        FROM _stage03_report AS r
        WHERE r.section = 'summary'
          AND r.metric = 'FINAL_SUMMARY'
          AND r.status = 'FAIL'
        ORDER BY r.bucket NULLS LAST
        LIMIT 1;

        RAISE EXCEPTION
            USING MESSAGE = format(
                'Stage C FINAL_SUMMARY=%s%s',
                COALESCE(v_bucket, 'FAIL'),
                CASE WHEN v_n IS NULL THEN '' ELSE format(' count=%s', v_n) END
            );
    END IF;
END
$_$;
