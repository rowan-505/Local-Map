-- =============================================================================
-- Stage 02: validate_tmp_admin (read-only on tmp import table)
--
-- Hard fail: missing table, zero rows, null/invalid geom, SRID != 4326,
--   boundary != administrative, null admin_level, duplicate (osm_id, osm_feature_type).
-- Warnings only: missing names, unsupported admin_level, very small polygon (< 100 m²).
--
-- psql var: tmp_admin_schema (default tmp_admin_import)
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?tmp_admin_schema}
\else
\set tmp_admin_schema 'tmp_admin_import'
\endif

CREATE TEMP TABLE _stage02_cfg (
    schema_name text NOT NULL PRIMARY KEY
);

INSERT INTO _stage02_cfg (schema_name)
VALUES (coalesce(nullif(trim(:'tmp_admin_schema'), ''), 'tmp_admin_import'));

CREATE TEMP TABLE _stage02_summary (
    metric text NOT NULL PRIMARY KEY,
    value_n bigint NOT NULL
);

CREATE TEMP TABLE _stage02_admin_level_counts (
    admin_level text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL
);

CREATE TEMP TABLE _stage02_errors (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'FAIL'
);

CREATE TEMP TABLE _stage02_warnings (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'WARN'
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
    not_administrative bigint := 0;
    null_admin_level bigint := 0;
    duplicate_keys bigint := 0;
    missing_name bigint := 0;
    missing_name_my bigint := 0;
    missing_name_en bigint := 0;
    unsupported_admin_level bigint := 0;
    very_small_polygon bigint := 0;
    v_allowed_levels text[] := ARRAY['2', '4', '5', '6', '7', '8', '9', '10'];
BEGIN
    SELECT cfg.schema_name INTO STRICT s FROM _stage02_cfg AS cfg;

    SELECT exists (
        SELECT 1
        FROM information_schema.tables AS t
        WHERE t.table_schema = s
          AND t.table_name = 'osm_admin_polygons'
          AND t.table_type = 'BASE TABLE'
    )
    INTO has_table;

    IF NOT has_table THEN
        INSERT INTO _stage02_errors (check_name, row_count)
        VALUES ('table_osm_admin_polygons_missing', 1);

        INSERT INTO _stage02_summary (metric, value_n)
        VALUES ('total_rows', 0);

        RETURN;
    END IF;

    q := format(
        $q$
        WITH src AS (
            SELECT *
            FROM %I.osm_admin_polygons
        ),
        dup AS (
            SELECT coalesce(sum(g.cnt - 1), 0)::bigint AS duplicate_row_count
            FROM (
                SELECT count(*)::bigint AS cnt
                FROM src
                GROUP BY osm_id, osm_feature_type
                HAVING count(*) > 1
            ) AS g
        ),
        unsupported AS (
            SELECT count(*)::bigint AS unsupported_count
            FROM src
            WHERE nullif(btrim(tags->>'admin_level'), '') IS NOT NULL
              AND NOT (
                  btrim(tags->>'admin_level') = ANY ($1)
                  OR EXISTS (
                      SELECT 1
                      FROM unnest(string_to_array(tags->>'admin_level', ';')) AS part(raw_part)
                      WHERE btrim(part.raw_part) = ANY ($1)
                  )
              )
        )
        SELECT
            (SELECT count(*)::bigint FROM src),
            (SELECT count(*)::bigint FROM src WHERE geom IS NULL),
            (SELECT count(*)::bigint FROM src WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)),
            (SELECT count(*)::bigint FROM src WHERE geom IS NOT NULL AND ST_SRID(geom) IS DISTINCT FROM 4326),
            (SELECT count(*)::bigint FROM src WHERE coalesce(tags->>'boundary', '') IS DISTINCT FROM 'administrative'),
            (SELECT count(*)::bigint FROM src WHERE nullif(btrim(tags->>'admin_level'), '') IS NULL),
            (SELECT duplicate_row_count FROM dup),
            (SELECT count(*)::bigint FROM src WHERE nullif(btrim(tags->>'name'), '') IS NULL),
            (SELECT count(*)::bigint FROM src WHERE nullif(btrim(tags->>'name:my'), '') IS NULL),
            (SELECT count(*)::bigint FROM src WHERE nullif(btrim(tags->>'name:en'), '') IS NULL),
            (SELECT unsupported_count FROM unsupported),
            (
                SELECT count(*)::bigint
                FROM src
                WHERE geom IS NOT NULL
                  AND ST_Area(geom::geography) < 100
            )
        $q$,
        s
    );

    EXECUTE q USING v_allowed_levels INTO
        total_rows,
        null_geom,
        invalid_geom,
        srid_issue,
        not_administrative,
        null_admin_level,
        duplicate_keys,
        missing_name,
        missing_name_my,
        missing_name_en,
        unsupported_admin_level,
        very_small_polygon;

    INSERT INTO _stage02_summary (metric, value_n)
    VALUES ('total_rows', total_rows);

    INSERT INTO _stage02_errors (check_name, row_count)
    VALUES
        ('zero_rows', CASE WHEN total_rows = 0 THEN 1 ELSE 0 END),
        ('null_geometry', null_geom),
        ('invalid_geometry', invalid_geom),
        ('srid_not_4326', srid_issue),
        ('boundary_not_administrative', not_administrative),
        ('admin_level_null', null_admin_level),
        ('duplicate_osm_id_osm_feature_type', duplicate_keys);

    INSERT INTO _stage02_warnings (check_name, row_count)
    VALUES
        ('missing_name', missing_name),
        ('missing_name_my', missing_name_my),
        ('missing_name_en', missing_name_en),
        ('unsupported_admin_level', unsupported_admin_level),
        ('very_small_polygon_lt_100m2', very_small_polygon);

    q := format(
        $q$
        INSERT INTO _stage02_admin_level_counts (admin_level, row_count)
        SELECT coalesce(nullif(btrim(tags->>'admin_level'), ''), '<missing>'), count(*)::bigint
        FROM %I.osm_admin_polygons
        GROUP BY 1
        ORDER BY count(*) DESC, 1
        $q$,
        s
    );
    EXECUTE q;
END
$_$;

SELECT '=== stage02_summary ===' AS section;
SELECT metric, value_n
FROM _stage02_summary
ORDER BY metric;

SELECT '=== stage02_admin_level_counts ===' AS section;
SELECT admin_level, row_count
FROM _stage02_admin_level_counts
ORDER BY row_count DESC, admin_level;

SELECT '=== stage02_error_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage02_errors
ORDER BY check_name;

SELECT '=== stage02_warning_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage02_warnings
ORDER BY check_name;

DO $_$
DECLARE
    v_fail_lines text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM _stage02_errors AS e
        WHERE e.check_name = 'table_osm_admin_polygons_missing'
    ) THEN
        RAISE EXCEPTION 'Stage 02 validate_tmp_admin failed: tmp_admin_import.osm_admin_polygons does not exist';
    END IF;

    SELECT string_agg(format('%s=%s', e.check_name, e.row_count), ', ' ORDER BY e.check_name)
    INTO v_fail_lines
    FROM _stage02_errors AS e
    WHERE e.row_count > 0;

    IF v_fail_lines IS NOT NULL THEN
        RAISE EXCEPTION 'Stage 02 validate_tmp_admin failed (hard checks): %', v_fail_lines;
    END IF;
END
$_$;
