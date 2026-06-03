-- =============================================================================
-- Stage 05: validate_staging_admin
-- Validates staging.staging_admin_area_candidates for one admin-fast-core snapshot.
--
-- Scope: source_snapshot_id + source_refs.pipeline = admin-fast-core
-- Hard fail: zero rows, geom/SRID/id/name/level/confidence issues, duplicate external_id,
--   >10 rows mapped to country while OSM admin_level is not 2
-- Warnings only: centroid, names, parent, duplicate canonical_name, tiny area
--
-- psql variables: snapshot_version, staging_schema, raw_schema
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif

CREATE TEMP TABLE stage05_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL
);

INSERT INTO stage05_params (snapshot_version, staging_schema, raw_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(nullif(trim(:'staging_schema'), ''), 'staging'),
    coalesce(nullif(trim(:'raw_schema'), ''), 'raw')
);

CREATE TEMP TABLE stage05_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    raw_schema text NOT NULL
);

CREATE TEMP TABLE _stage05_summary (
    metric text NOT NULL PRIMARY KEY,
    value_n bigint NOT NULL
);

CREATE TEMP TABLE _stage05_admin_level_counts (
    admin_level_id bigint NOT NULL,
    admin_level_code text NOT NULL,
    admin_level_name text NOT NULL,
    row_count bigint NOT NULL
);

CREATE TEMP TABLE _stage05_errors (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'FAIL'
);

CREATE TEMP TABLE _stage05_warnings (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'WARN'
);

DO $_$
DECLARE
    p stage05_params%ROWTYPE;
    ctx stage05_context%ROWTYPE;
    q text;
    total_rows bigint := 0;
    null_geom bigint := 0;
    invalid_geom bigint := 0;
    srid_issue bigint := 0;
    external_id_null bigint := 0;
    duplicate_external_id bigint := 0;
    canonical_name_null bigint := 0;
    admin_level_id_null bigint := 0;
    confidence_out_of_range bigint := 0;
    centroid_null bigint := 0;
    missing_myanmar_name bigint := 0;
    missing_english_name bigint := 0;
    parent_candidate_null bigint := 0;
    duplicate_canonical_name bigint := 0;
    suspicious_tiny_area bigint := 0;
    country_misassigned bigint := 0;
    v_country_level_id bigint;
BEGIN
    SELECT * INTO p FROM stage05_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.staging_admin_area_candidates', p.staging_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.staging_admin_area_candidates', p.staging_schema;
    END IF;

    INSERT INTO stage05_context (source_snapshot_id, snapshot_version, staging_schema, raw_schema)
    SELECT s.id, s.snapshot_version, p.staging_schema, p.raw_schema
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', p.snapshot_version;
    END IF;

    SELECT * INTO ctx FROM stage05_context;

    SELECT levels.id
    INTO v_country_level_id
    FROM ref.ref_admin_levels AS levels
    WHERE levels.code = 'country'
    LIMIT 1;

    IF v_country_level_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_admin_levels row with code=country is required';
    END IF;

    q := format(
        $q$
        WITH candidates AS (
            SELECT
                staging.*,
                raw.tags AS raw_tags,
                (
                    SELECT max(btrim(part.part_value)::integer)
                    FROM unnest(
                        string_to_array(
                            coalesce(
                                nullif(btrim(raw.tags->>'admin_level'), ''),
                                nullif(btrim(staging.class_code), ''),
                                nullif(btrim(staging.normalized_data->>'admin_level'), '')
                            ),
                            ';'
                        )
                    ) AS part(part_value)
                    WHERE btrim(part.part_value) ~ '^[0-9]+$'
                ) AS osm_admin_level
            FROM %I.staging_admin_area_candidates AS staging
            LEFT JOIN %I.raw_osm_polygons AS raw
                ON raw.id = staging.raw_id
               AND raw.source_snapshot_id = staging.source_snapshot_id
            WHERE staging.source_snapshot_id = $1
              AND coalesce(staging.source_refs->>'pipeline', '') = 'admin-fast-core'
        ),
        dup_external AS (
            SELECT coalesce(sum(g.cnt - 1), 0)::bigint AS duplicate_row_count
            FROM (
                SELECT count(*)::bigint AS cnt
                FROM candidates
                GROUP BY external_id
                HAVING count(*) > 1
            ) AS g
        ),
        dup_canonical AS (
            SELECT coalesce(sum(g.cnt - 1), 0)::bigint AS duplicate_row_count
            FROM (
                SELECT count(*)::bigint AS cnt
                FROM candidates
                WHERE canonical_name IS NOT NULL
                  AND btrim(canonical_name) <> ''
                GROUP BY canonical_name
                HAVING count(*) > 1
            ) AS g
        )
        SELECT
            (SELECT count(*)::bigint FROM candidates),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NULL),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NOT NULL AND ST_SRID(geom) IS DISTINCT FROM 4326),
            (SELECT count(*)::bigint FROM candidates WHERE external_id IS NULL OR btrim(external_id) = ''),
            (SELECT duplicate_row_count FROM dup_external),
            (SELECT count(*)::bigint FROM candidates WHERE canonical_name IS NULL OR btrim(canonical_name) = ''),
            (SELECT count(*)::bigint FROM candidates WHERE admin_level_id IS NULL),
            (
                SELECT count(*)::bigint
                FROM candidates
                WHERE confidence_score IS NULL
                   OR confidence_score < 0
                   OR confidence_score > 100
            ),
            (SELECT count(*)::bigint FROM candidates WHERE centroid IS NULL),
            (
                SELECT count(*)::bigint
                FROM candidates
                WHERE coalesce(nullif(btrim(raw_tags->>'name:my'), ''), nullif(btrim(normalized_data->>'name:my'), '')) IS NULL
            ),
            (
                SELECT count(*)::bigint
                FROM candidates
                WHERE coalesce(nullif(btrim(raw_tags->>'name:en'), ''), nullif(btrim(normalized_data->>'name:en'), '')) IS NULL
            ),
            (SELECT count(*)::bigint FROM candidates WHERE parent_candidate_id IS NULL),
            (SELECT duplicate_row_count FROM dup_canonical),
            (
                SELECT count(*)::bigint
                FROM candidates
                WHERE geom IS NOT NULL
                  AND ST_Area(geom::geography) < 100
            ),
            (
                SELECT count(*)::bigint
                FROM candidates
                WHERE admin_level_id = $2
                  AND coalesce(osm_admin_level, -1) IS DISTINCT FROM 2
            )
        $q$,
        ctx.staging_schema,
        ctx.raw_schema
    );

    EXECUTE q INTO
        total_rows,
        null_geom,
        invalid_geom,
        srid_issue,
        external_id_null,
        duplicate_external_id,
        canonical_name_null,
        admin_level_id_null,
        confidence_out_of_range,
        centroid_null,
        missing_myanmar_name,
        missing_english_name,
        parent_candidate_null,
        duplicate_canonical_name,
        suspicious_tiny_area,
        country_misassigned
        USING ctx.source_snapshot_id, v_country_level_id;

    INSERT INTO _stage05_summary (metric, value_n)
    VALUES ('total_staging_rows', total_rows);

    INSERT INTO _stage05_errors (check_name, row_count)
    VALUES
        ('no_staging_rows_for_snapshot', CASE WHEN total_rows = 0 THEN 1 ELSE 0 END),
        ('geom_null', null_geom),
        ('invalid_geometry', invalid_geom),
        ('srid_not_4326', srid_issue),
        ('external_id_null', external_id_null),
        ('duplicate_external_id', duplicate_external_id),
        ('canonical_name_null', canonical_name_null),
        ('admin_level_id_null', admin_level_id_null),
        ('confidence_score_outside_0_100', confidence_out_of_range),
        ('country_mapped_from_non_osm_level_2', country_misassigned);

    INSERT INTO _stage05_warnings (check_name, row_count)
    VALUES
        ('centroid_null', centroid_null),
        ('missing_myanmar_name', missing_myanmar_name),
        ('missing_english_name', missing_english_name),
        ('parent_candidate_id_null', parent_candidate_null),
        ('duplicate_canonical_name', duplicate_canonical_name),
        ('suspicious_tiny_area_lt_100m2', suspicious_tiny_area);

    q := format(
        $q$
        INSERT INTO _stage05_admin_level_counts (
            admin_level_id,
            admin_level_code,
            admin_level_name,
            row_count
        )
        SELECT
            staging.admin_level_id,
            coalesce(levels.code, '<unknown>'),
            coalesce(levels.name, '<unknown>'),
            count(*)::bigint
        FROM %I.staging_admin_area_candidates AS staging
        LEFT JOIN ref.ref_admin_levels AS levels
            ON levels.id = staging.admin_level_id
        WHERE staging.source_snapshot_id = $1
          AND coalesce(staging.source_refs->>'pipeline', '') = 'admin-fast-core'
        GROUP BY staging.admin_level_id, levels.code, levels.name
        ORDER BY count(*) DESC, staging.admin_level_id
        $q$,
        ctx.staging_schema
    );
    EXECUTE q USING ctx.source_snapshot_id;
END
$_$;

SELECT '=== stage05_summary ===' AS section;
SELECT metric, value_n
FROM _stage05_summary
ORDER BY metric;

SELECT '=== stage05_admin_level_counts ===' AS section;
SELECT admin_level_id, admin_level_code, admin_level_name, row_count
FROM _stage05_admin_level_counts
ORDER BY row_count DESC, admin_level_id;

SELECT '=== stage05_error_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage05_errors
ORDER BY check_name;

SELECT '=== stage05_warning_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage05_warnings
ORDER BY check_name;

DO $_$
DECLARE
    v_fail_lines text;
BEGIN
    SELECT string_agg(format('%s=%s', e.check_name, e.row_count), ', ' ORDER BY e.check_name)
    INTO v_fail_lines
    FROM _stage05_errors AS e
    WHERE (
            e.check_name = 'country_mapped_from_non_osm_level_2'
            AND e.row_count > 10
        )
        OR (
            e.check_name IS DISTINCT FROM 'country_mapped_from_non_osm_level_2'
            AND e.row_count > 0
        );

    IF v_fail_lines IS NOT NULL THEN
        RAISE EXCEPTION 'Stage 05 validate_staging_admin failed (hard checks): %', v_fail_lines;
    END IF;
END
$_$;
