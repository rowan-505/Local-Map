-- =============================================================================
-- Stage 02: validate_tmp_roads (light validation; read-only on user tables)
--
-- Hard fail: missing table, zero rows, null geom, invalid geom, non-4326 SRID.
-- Warnings only: missing tags, construction/proposed, footway/path/steps counts.
--
-- psql var: tmp_road_import_schema (default tmp_road_import)
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?tmp_road_import_schema}
\else
\set tmp_road_import_schema 'tmp_road_import'
\endif

CREATE TEMP TABLE _stage02_cfg (
    schema_name text NOT NULL PRIMARY KEY
);

INSERT INTO _stage02_cfg (schema_name)
VALUES (coalesce(nullif(trim(:'tmp_road_import_schema'), ''), 'tmp_road_import'));

CREATE TEMP TABLE _stage02_report (
    section text NOT NULL,
    metric text NOT NULL,
    value_n bigint,
    status text NOT NULL
);

CREATE TEMP TABLE _stage02_highway_counts (
    highway text NOT NULL,
    row_count bigint NOT NULL
);

DO $_$
DECLARE
    s text;
    q text;
    has_table boolean;
    total_rows bigint := 0;
    null_geom bigint := 0;
    invalid_geom bigint := 0;
    srid_issue bigint := 0;
    missing_name bigint := 0;
    missing_highway_tag bigint := 0;
    missing_surface bigint := 0;
    missing_maxspeed bigint := 0;
    missing_oneway bigint := 0;
    construction_proposed bigint := 0;
    footway_path_steps bigint := 0;
BEGIN
    SELECT cfg.schema_name INTO STRICT s FROM _stage02_cfg AS cfg;

    SELECT exists (
        SELECT 1
        FROM information_schema.tables AS t
        WHERE t.table_schema = s
          AND t.table_name = 'osm_road_lines'
          AND t.table_type = 'BASE TABLE'
    )
    INTO has_table;

    IF NOT has_table THEN
        INSERT INTO _stage02_report VALUES ('fail', 'table_exists', 0, 'FAIL');
        RETURN;
    END IF;

    INSERT INTO _stage02_report VALUES ('pass', 'table_exists', 1, 'PASS');

    q := format(
        $q$
        SELECT
            count(*)::bigint,
            count(*) FILTER (WHERE geom IS NULL)::bigint,
            count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint,
            count(*) FILTER (
                WHERE geom IS NOT NULL AND ST_SRID(geom) IS DISTINCT FROM 4326
            )::bigint,
            count(*) FILTER (
                WHERE coalesce(
                    nullif(btrim(tags->>'name'), ''),
                    nullif(btrim(tags->>'name:en'), ''),
                    nullif(btrim(tags->>'name:my'), ''),
                    nullif(btrim(tags->>'name:mm'), ''),
                    nullif(btrim(tags->>'ref'), '')
                ) IS NULL
            )::bigint,
            count(*) FILTER (
                WHERE tags IS NULL OR NOT (tags ? 'highway') OR nullif(btrim(tags->>'highway'), '') IS NULL
            )::bigint,
            count(*) FILTER (
                WHERE nullif(btrim(tags->>'surface'), '') IS NULL
            )::bigint,
            count(*) FILTER (
                WHERE nullif(btrim(tags->>'maxspeed'), '') IS NULL
            )::bigint,
            count(*) FILTER (
                WHERE nullif(btrim(tags->>'oneway'), '') IS NULL
            )::bigint,
            count(*) FILTER (
                WHERE lower(btrim(tags->>'highway')) IN ('construction', 'proposed')
            )::bigint,
            count(*) FILTER (
                WHERE lower(btrim(tags->>'highway')) IN ('footway', 'path', 'steps')
            )::bigint
        FROM %I.osm_road_lines
        $q$,
        s
    );

    EXECUTE q INTO
        total_rows,
        null_geom,
        invalid_geom,
        srid_issue,
        missing_name,
        missing_highway_tag,
        missing_surface,
        missing_maxspeed,
        missing_oneway,
        construction_proposed,
        footway_path_steps;

    INSERT INTO _stage02_report VALUES
        ('summary', 'total_rows', total_rows, CASE WHEN total_rows > 0 THEN 'PASS' ELSE 'FAIL' END),
        ('fail', 'null_geometry_count', null_geom, CASE WHEN null_geom = 0 THEN 'PASS' ELSE 'FAIL' END),
        ('fail', 'invalid_geometry_count', invalid_geom, CASE WHEN invalid_geom = 0 THEN 'PASS' ELSE 'FAIL' END),
        ('fail', 'srid_not_4326_count', srid_issue, CASE WHEN srid_issue = 0 THEN 'PASS' ELSE 'FAIL' END),
        ('warn', 'missing_name_count', missing_name, 'WARN'),
        ('warn', 'missing_highway_tag_count', missing_highway_tag, 'WARN'),
        ('warn', 'missing_surface_count', missing_surface, 'WARN'),
        ('warn', 'missing_maxspeed_count', missing_maxspeed, 'WARN'),
        ('warn', 'missing_oneway_count', missing_oneway, 'WARN'),
        ('warn', 'construction_or_proposed_count', construction_proposed, 'WARN'),
        ('warn', 'footway_path_steps_count', footway_path_steps, 'WARN');

    q := format(
        $q$
        INSERT INTO _stage02_highway_counts (highway, row_count)
        SELECT coalesce(nullif(btrim(tags->>'highway'), ''), '<missing>'), count(*)::bigint
        FROM %I.osm_road_lines
        GROUP BY 1
        ORDER BY count(*) DESC, 1
        $q$,
        s
    );
    EXECUTE q;
END
$_$;

SELECT '=== stage02_fail_checks ===' AS section;
SELECT metric, value_n, status
FROM _stage02_report
WHERE section = 'fail'
ORDER BY metric;

SELECT '=== stage02_summary ===' AS section;
SELECT metric, value_n, status
FROM _stage02_report
WHERE section IN ('summary', 'pass')
   OR metric IN (
       'missing_name_count',
       'invalid_geometry_count',
       'srid_not_4326_count'
   )
ORDER BY
    CASE metric
        WHEN 'total_rows' THEN 1
        WHEN 'missing_name_count' THEN 2
        WHEN 'invalid_geometry_count' THEN 3
        WHEN 'srid_not_4326_count' THEN 4
        ELSE 9
    END;

SELECT '=== stage02_warning_counts ===' AS section;
SELECT metric, value_n, status
FROM _stage02_report
WHERE section = 'warn'
ORDER BY metric;

SELECT '=== stage02_highway_tag_counts ===' AS section;
SELECT highway, row_count
FROM _stage02_highway_counts
ORDER BY row_count DESC, highway
LIMIT 50;

DO $_$
BEGIN
    IF EXISTS (
        SELECT 1 FROM _stage02_report AS r WHERE r.status = 'FAIL'
    ) THEN
        RAISE EXCEPTION 'Stage 02 validate_tmp_roads failed (hard checks) — see report above';
    END IF;
END
$_$;
