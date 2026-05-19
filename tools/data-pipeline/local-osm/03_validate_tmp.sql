-- =============================================================================
-- Stage 03: validate_tmp (read-only validation; session temp scaffolding only)
-- Sanity checks before tmp_import -> raw.
--
-- psql vars: :tmp_import_schema (runner sets TMP_IMPORT_SCHEMA; defaults to tmp_import)
--
-- NULL geometry rows are WARN because Stage D skips them before raw insert.
--
-- Hard fail (second DO block raises; psql ON_ERROR_STOP stops the client):
--   - any of osm_points / osm_lines / osm_polygons missing
--   - all three tables empty (row count sum = 0)
--   - zero rows with non-null geometry across all three tables (nothing usable for Stage D)
--   - any non-null geometry with ST_SRID <> 4326
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
    has_points boolean;
    has_lines boolean;
    has_polygons boolean;

    cnt_points bigint := 0;
    cnt_lines bigint := 0;
    cnt_polygons bigint := 0;

    total_rows bigint;

    null_geom_points bigint;
    null_geom_lines bigint;
    null_geom_polygons bigint;

    bad_geom_points bigint;
    bad_geom_lines bigint;
    bad_geom_polygons bigint;

    null_osm_points bigint;
    null_osm_lines bigint;
    null_osm_polygons bigint;

    bad_tags_points bigint;
    bad_tags_lines bigint;
    bad_tags_polygons bigint;

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

BEGIN
    SELECT cfg.schema_name
    INTO STRICT s
    FROM _stage03_cfg AS cfg;

    SELECT exists (
        SELECT 1
        FROM information_schema.tables AS t
        WHERE t.table_schema = s
          AND t.table_name = 'osm_points'
          AND t.table_type = 'BASE TABLE'
    )
    INTO has_points;

    SELECT exists (
        SELECT 1
        FROM information_schema.tables AS t
        WHERE t.table_schema = s
          AND t.table_name = 'osm_lines'
          AND t.table_type = 'BASE TABLE'
    )
    INTO has_lines;

    SELECT exists (
        SELECT 1
        FROM information_schema.tables AS t
        WHERE t.table_schema = s
          AND t.table_name = 'osm_polygons'
          AND t.table_type = 'BASE TABLE'
    )
    INTO has_polygons;

    INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
    VALUES
        ('existence', 'global', 'table_exists', 'osm_points', NULL, NULL,
            CASE WHEN has_points THEN 'PASS' ELSE 'FAIL' END),
        ('existence', 'global', 'table_exists', 'osm_lines', NULL, NULL,
            CASE WHEN has_lines THEN 'PASS' ELSE 'FAIL' END),
        ('existence', 'global', 'table_exists', 'osm_polygons', NULL, NULL,
            CASE WHEN has_polygons THEN 'PASS' ELSE 'FAIL' END);

    IF NOT has_points OR NOT has_lines OR NOT has_polygons THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'missing-required-tables', NULL, 'FAIL');
        RETURN;
    END IF;

    qr := format('select count(*)::bigint from %I.osm_points', s);
    EXECUTE qr INTO cnt_points;

    qr := format('select count(*)::bigint from %I.osm_lines', s);
    EXECUTE qr INTO cnt_lines;

    qr := format('select count(*)::bigint from %I.osm_polygons', s);
    EXECUTE qr INTO cnt_polygons;

    total_rows := coalesce(cnt_points, 0) + coalesce(cnt_lines, 0) + coalesce(cnt_polygons, 0);

    INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
    VALUES
        ('row_count', 'osm_points', 'row_count', 'osm_points', NULL, cnt_points, 'PASS'),
        ('row_count', 'osm_lines', 'row_count', 'osm_lines', NULL, cnt_lines, 'PASS'),
        ('row_count', 'osm_polygons', 'row_count', 'osm_polygons', NULL, cnt_polygons, 'PASS');

    IF total_rows = 0 THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'all-tables-empty', 0, 'FAIL');
        RETURN;
    END IF;

    qr := format(
        $q$
            select st_srid(geom)::integer as srid, count(*)::bigint as c
            from %I.osm_points
            where geom is not null
            group by 1
            order by 1
        $q$,
        s
    );

    FOR rec IN EXECUTE qr
    LOOP
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES (
            'srid',
            'osm_points',
            'srid_count',
            'osm_points',
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
            select st_srid(geom)::integer as srid, count(*)::bigint as c
            from %I.osm_lines
            where geom is not null
            group by 1
            order by 1
        $q$,
        s
    );

    FOR rec IN EXECUTE qr
    LOOP
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES (
            'srid',
            'osm_lines',
            'srid_count',
            'osm_lines',
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
            select st_srid(geom)::integer as srid, count(*)::bigint as c
            from %I.osm_polygons
            where geom is not null
            group by 1
            order by 1
        $q$,
        s
    );

    FOR rec IN EXECUTE qr
    LOOP
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES (
            'srid',
            'osm_polygons',
            'srid_count',
            'osm_polygons',
            rec.srid::text,
            rec.c,
            CASE WHEN rec.srid = 4326 THEN 'PASS' ELSE 'FAIL' END
        );

        IF rec.srid IS DISTINCT FROM 4326 THEN
            invalid_srid := true;
        END IF;
    END LOOP;

    IF invalid_srid THEN
        INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
        VALUES ('summary', 'global', 'FINAL_SUMMARY', NULL, 'non-4326-srid', NULL, 'FAIL');
        RETURN;
    END IF;

    qr := format(
        $q$
            select
                count(*) filter (where geom is null)::bigint,
                count(*) filter (where geom is not null and not st_isvalid(geom))::bigint,
                count(*) filter (where osm_id is null)::bigint,
                count(*) filter (
                    where tags is null or tags = '{}'::jsonb or jsonb_typeof(tags) = 'null'
                )::bigint
            from %I.osm_points
        $q$,
        s
    );
    EXECUTE qr INTO null_geom_points, bad_geom_points, null_osm_points, bad_tags_points;

    qr := format(
        $q$
            select
                count(*) filter (where geom is null)::bigint,
                count(*) filter (where geom is not null and not st_isvalid(geom))::bigint,
                count(*) filter (where osm_id is null)::bigint,
                count(*) filter (
                    where tags is null or tags = '{}'::jsonb or jsonb_typeof(tags) = 'null'
                )::bigint
            from %I.osm_lines
        $q$,
        s
    );
    EXECUTE qr INTO null_geom_lines, bad_geom_lines, null_osm_lines, bad_tags_lines;

    qr := format(
        $q$
            select
                count(*) filter (where geom is null)::bigint,
                count(*) filter (where geom is not null and not st_isvalid(geom))::bigint,
                count(*) filter (where osm_id is null)::bigint,
                count(*) filter (
                    where tags is null or tags = '{}'::jsonb or jsonb_typeof(tags) = 'null'
                )::bigint
            from %I.osm_polygons
        $q$,
        s
    );
    EXECUTE qr INTO null_geom_polygons, bad_geom_polygons, null_osm_polygons, bad_tags_polygons;

    null_geom_total := coalesce(null_geom_points, 0) + coalesce(null_geom_lines, 0)
        + coalesce(null_geom_polygons, 0);

    usable_geom_total :=
        (coalesce(cnt_points, 0) - coalesce(null_geom_points, 0))
        + (coalesce(cnt_lines, 0) - coalesce(null_geom_lines, 0))
        + (coalesce(cnt_polygons, 0) - coalesce(null_geom_polygons, 0));

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

    INSERT INTO _stage03_report (section, scope, metric, tbl, bucket, n, status)
    VALUES
        ('geom_null', 'osm_points', 'null_geometry_count', 'osm_points', NULL, null_geom_points,
            CASE WHEN null_geom_points = 0 THEN 'PASS' ELSE 'WARN' END),
        ('geom_null', 'osm_lines', 'null_geometry_count', 'osm_lines', NULL, null_geom_lines,
            CASE WHEN null_geom_lines = 0 THEN 'PASS' ELSE 'WARN' END),
        ('geom_null', 'osm_polygons', 'null_geometry_count', 'osm_polygons', NULL, null_geom_polygons,
            CASE WHEN null_geom_polygons = 0 THEN 'PASS' ELSE 'WARN' END),

        ('geom_valid', 'osm_points', 'invalid_geometry_count', 'osm_points', NULL, bad_geom_points,
            CASE WHEN bad_geom_points = 0 THEN 'PASS' ELSE 'WARN' END),
        ('geom_valid', 'osm_lines', 'invalid_geometry_count', 'osm_lines', NULL, bad_geom_lines,
            CASE WHEN bad_geom_lines = 0 THEN 'PASS' ELSE 'WARN' END),
        ('geom_valid', 'osm_polygons', 'invalid_geometry_count', 'osm_polygons', NULL, bad_geom_polygons,
            CASE WHEN bad_geom_polygons = 0 THEN 'PASS' ELSE 'WARN' END),

        ('osm_id', 'osm_points', 'null_osm_id_count', 'osm_points', NULL, null_osm_points,
            CASE WHEN null_osm_points = 0 THEN 'PASS' ELSE 'WARN' END),
        ('osm_id', 'osm_lines', 'null_osm_id_count', 'osm_lines', NULL, null_osm_lines,
            CASE WHEN null_osm_lines = 0 THEN 'PASS' ELSE 'WARN' END),
        ('osm_id', 'osm_polygons', 'null_osm_id_count', 'osm_polygons', NULL, null_osm_polygons,
            CASE WHEN null_osm_polygons = 0 THEN 'PASS' ELSE 'WARN' END),

        ('tags', 'osm_points', 'null_or_empty_tags_count', 'osm_points', NULL, bad_tags_points,
            CASE WHEN bad_tags_points = 0 THEN 'PASS' ELSE 'WARN' END),
        ('tags', 'osm_lines', 'null_or_empty_tags_count', 'osm_lines', NULL, bad_tags_lines,
            CASE WHEN bad_tags_lines = 0 THEN 'PASS' ELSE 'WARN' END),
        ('tags', 'osm_polygons', 'null_or_empty_tags_count', 'osm_polygons', NULL, bad_tags_polygons,
            CASE WHEN bad_tags_polygons = 0 THEN 'PASS' ELSE 'WARN' END);

    invalid_geom_total := coalesce(bad_geom_points, 0) + coalesce(bad_geom_lines, 0)
        + coalesce(bad_geom_polygons, 0);
    null_osm_total := coalesce(null_osm_points, 0) + coalesce(null_osm_lines, 0)
        + coalesce(null_osm_polygons, 0);
    empty_tags_total := coalesce(bad_tags_points, 0) + coalesce(bad_tags_lines, 0)
        + coalesce(bad_tags_polygons, 0);

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
