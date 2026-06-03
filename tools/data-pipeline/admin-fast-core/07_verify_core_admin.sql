-- =============================================================================
-- Stage 07: verify_core_admin (read-only)
-- Reports on active OSM rows in core.core_admin_areas (+ names).
--
-- Hard fail: duplicate external_id, null/invalid geom, SRID != 4326,
--   null admin_level_id, null canonical_name, boundary_confidence outside 0–100,
--   more than 1 active country-level OSM admin area.
-- Warnings: parent_id null, missing names, hierarchy coverage gaps, tiny area, overlaps.
--
-- psql variables: snapshot_version (optional context label)
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?snapshot_version}
\else
\set snapshot_version ''
\endif

BEGIN;

CREATE TEMP TABLE stage07_params (
    snapshot_version text
);

INSERT INTO stage07_params (snapshot_version)
VALUES (NULLIF(btrim(:'snapshot_version'), ''));

CREATE TEMP TABLE stage07_osm_scope AS
SELECT
    ca.id,
    ca.public_id,
    ca.external_id,
    ca.parent_id,
    ca.canonical_name,
    ca.slug,
    ca.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    al.rank AS admin_level_rank,
    ca.geom,
    ca.centroid,
    false AS is_verified,
    'unverified'::text AS verification_status,
    ST_Area(ca.geom::geography) AS area_m2,
    lower(trim(coalesce(al.code, ''))) = 'country' AS is_country_level,
    lower(trim(coalesce(al.code, ''))) = 'state_region' AS is_state_region_level,
    lower(trim(coalesce(al.code, ''))) IN ('district', 'township', 'town') AS is_district_township_level
FROM core.core_admin_areas AS ca
JOIN ref.ref_source_types AS st
    ON st.id = ca.source_type_id
   AND st.code = 'osm'
LEFT JOIN ref.ref_admin_levels AS al
    ON al.id = ca.admin_level_id
WHERE coalesce(ca.is_active, true);

CREATE TEMP TABLE _stage07_summary (
    check_name text NOT NULL PRIMARY KEY,
    metric_value bigint NOT NULL
);

CREATE TEMP TABLE _stage07_errors (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'FAIL'
);

CREATE TEMP TABLE _stage07_warnings (
    check_name text NOT NULL PRIMARY KEY,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'WARN'
);

INSERT INTO _stage07_summary (check_name, metric_value)
SELECT 'total_active_osm_admin_areas', count(*)::bigint
FROM stage07_osm_scope;

INSERT INTO _stage07_summary (check_name, metric_value)
SELECT 'verified_count', count(*)::bigint
FROM stage07_osm_scope
WHERE is_verified = true;

INSERT INTO _stage07_summary (check_name, metric_value)
SELECT 'unverified_count', count(*)::bigint
FROM stage07_osm_scope
WHERE is_verified = false;

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'duplicate_external_id', coalesce(sum(g.cnt - 1), 0)::bigint
FROM (
    SELECT count(*)::bigint AS cnt
    FROM stage07_osm_scope
    WHERE external_id IS NOT NULL
      AND btrim(external_id) <> ''
    GROUP BY external_id
    HAVING count(*) > 1
) AS g;

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'null_geometry', count(*)::bigint
FROM stage07_osm_scope
WHERE geom IS NULL;

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'invalid_geometry', count(*)::bigint
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND (NOT ST_IsValid(geom) OR ST_IsEmpty(geom));

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'srid_not_4326', count(*)::bigint
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND ST_SRID(geom) IS DISTINCT FROM 4326;

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'null_admin_level_id', count(*)::bigint
FROM stage07_osm_scope
WHERE admin_level_id IS NULL;

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'null_canonical_name', count(*)::bigint
FROM stage07_osm_scope
WHERE canonical_name IS NULL
   OR btrim(canonical_name) = '';

INSERT INTO _stage07_errors (check_name, row_count)
SELECT 'country_level_rows_exceed_limit', count(*)::bigint
FROM stage07_osm_scope
WHERE is_country_level;

INSERT INTO _stage07_summary (check_name, metric_value)
SELECT 'invalid_geometry_count', count(*)::bigint
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND (NOT ST_IsValid(geom) OR ST_IsEmpty(geom));

INSERT INTO _stage07_summary (check_name, metric_value)
SELECT 'duplicate_external_id_count', coalesce((
    SELECT row_count FROM _stage07_errors WHERE check_name = 'duplicate_external_id'
), 0);

DO $_$
DECLARE
    v_has_confidence boolean;
    v_conf_out_of_range bigint := 0;
BEGIN
    SELECT exists (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_admin_areas'
          AND c.column_name = 'boundary_confidence_score'
    )
    INTO v_has_confidence;

    IF v_has_confidence THEN
        SELECT count(*)::bigint
        INTO v_conf_out_of_range
        FROM stage07_osm_scope
        WHERE boundary_confidence_score IS NULL
           OR boundary_confidence_score < 0
           OR boundary_confidence_score > 100;

        INSERT INTO _stage07_errors (check_name, row_count)
        VALUES ('confidence_score_outside_0_100', v_conf_out_of_range);
    ELSE
        INSERT INTO _stage07_errors (check_name, row_count)
        VALUES ('confidence_score_outside_0_100', 0);
    END IF;
END
$_$;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'parent_id_null', count(*)::bigint
FROM stage07_osm_scope
WHERE parent_id IS NULL;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'missing_core_admin_area_names', count(*)::bigint
FROM stage07_osm_scope AS s
WHERE NOT EXISTS (
    SELECT 1
    FROM core.core_admin_area_names AS n
    WHERE n.admin_area_id = s.id
);

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'no_country_level_row', CASE WHEN count(*) FILTER (WHERE is_country_level) = 0 THEN 1 ELSE 0 END
FROM stage07_osm_scope;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'no_state_region_rows', CASE WHEN count(*) FILTER (WHERE is_state_region_level) = 0 THEN 1 ELSE 0 END
FROM stage07_osm_scope;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'no_district_township_rows', CASE WHEN count(*) FILTER (WHERE is_district_township_level) = 0 THEN 1 ELSE 0 END
FROM stage07_osm_scope;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'tiny_area_lt_100m2', count(*)::bigint
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND ST_IsValid(geom)
  AND ST_Area(geom::geography) < 100;

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'name_kyayine_but_not_district', count(*)::bigint
FROM stage07_osm_scope
WHERE canonical_name ~ 'ခရိုင်'
  AND admin_level_code IS DISTINCT FROM 'district';

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'name_myotha_but_not_township', count(*)::bigint
FROM stage07_osm_scope
WHERE canonical_name ~ 'မြို့နယ်'
  AND admin_level_code IS DISTINCT FROM 'township';

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'name_yatkwet_but_not_ward_village_tract', count(*)::bigint
FROM stage07_osm_scope
WHERE canonical_name ~ 'ရပ်ကွက်'
  AND admin_level_code IS DISTINCT FROM 'ward_village_tract';

INSERT INTO _stage07_warnings (check_name, row_count)
SELECT 'same_level_overlap_pairs', count(*)::bigint
FROM (
    SELECT 1
    FROM stage07_osm_scope AS a1
    INNER JOIN stage07_osm_scope AS a2
        ON a2.admin_level_id = a1.admin_level_id
       AND a2.id > a1.id
    WHERE a1.geom IS NOT NULL
      AND a2.geom IS NOT NULL
      AND ST_IsValid(a1.geom)
      AND ST_IsValid(a2.geom)
      AND NOT ST_IsEmpty(a1.geom)
      AND NOT ST_IsEmpty(a2.geom)
      AND ST_Intersects(a1.geom, a2.geom)
      AND NOT ST_Touches(a1.geom, a2.geom)
) AS overlap_pairs;

SELECT '=== stage07_summary ===' AS section;
SELECT check_name, metric_value
FROM _stage07_summary
ORDER BY check_name;

SELECT '=== count_by_admin_level ===' AS section;
SELECT
    coalesce(s.admin_level_code, '<null>') AS admin_level_code,
    coalesce(s.admin_level_name, '<null>') AS admin_level_name,
    s.admin_level_rank,
    count(*)::bigint AS area_count
FROM stage07_osm_scope AS s
GROUP BY s.admin_level_code, s.admin_level_name, s.admin_level_rank
ORDER BY s.admin_level_rank NULLS LAST, area_count DESC, admin_level_code;

SELECT '=== stage07_error_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage07_errors
ORDER BY check_name;

SELECT '=== stage07_warning_table ===' AS section;
SELECT check_name, row_count, status
FROM _stage07_warnings
ORDER BY check_name;

SELECT '=== sample_50_rows ===' AS section;
SELECT
    s.external_id,
    s.canonical_name,
    s.admin_level_code,
    s.admin_level_rank,
    round(s.area_m2::numeric, 1) AS area_m2,
    s.is_verified,
    s.verification_status,
    s.parent_id IS NULL AS parent_id_null
FROM stage07_osm_scope AS s
ORDER BY s.external_id
LIMIT 50;

SELECT '=== top_20_largest_admin_areas ===' AS section;
SELECT
    s.external_id,
    s.canonical_name,
    s.admin_level_code,
    round(s.area_m2::numeric, 1) AS area_m2,
    s.is_verified,
    s.verification_status
FROM stage07_osm_scope AS s
WHERE s.geom IS NOT NULL
ORDER BY s.area_m2 DESC NULLS LAST
LIMIT 20;

SELECT '=== same_level_overlap_sample ===' AS section;
SELECT
    a1.external_id AS area_a_external_id,
    a1.canonical_name AS area_a_name,
    a2.external_id AS area_b_external_id,
    a2.canonical_name AS area_b_name,
    a1.admin_level_code,
    round(ST_Area(ST_Intersection(a1.geom, a2.geom)::geography)::numeric, 1) AS overlap_area_m2
FROM stage07_osm_scope AS a1
INNER JOIN stage07_osm_scope AS a2
    ON a2.admin_level_id = a1.admin_level_id
   AND a2.id > a1.id
WHERE a1.geom IS NOT NULL
  AND a2.geom IS NOT NULL
  AND ST_IsValid(a1.geom)
  AND ST_IsValid(a2.geom)
  AND ST_Intersects(a1.geom, a2.geom)
  AND NOT ST_Touches(a1.geom, a2.geom)
ORDER BY overlap_area_m2 DESC NULLS LAST
LIMIT 10;

DO $stage07_fail$
DECLARE
    v_fail_lines text;
    v_snapshot text;
BEGIN
    SELECT string_agg(format('%s=%s', e.check_name, e.row_count), ', ' ORDER BY e.check_name)
    INTO v_fail_lines
    FROM _stage07_errors AS e
    WHERE (
            e.check_name = 'country_level_rows_exceed_limit'
            AND e.row_count > 1
        )
        OR (
            e.check_name IS DISTINCT FROM 'country_level_rows_exceed_limit'
            AND e.row_count > 0
        );

    SELECT p.snapshot_version
    INTO v_snapshot
    FROM stage07_params AS p
    LIMIT 1;

    IF v_fail_lines IS NOT NULL THEN
        RAISE EXCEPTION
            'Stage 07 verify_core_admin failed (snapshot=%): %',
            coalesce(v_snapshot, '<all-osm>'),
            v_fail_lines;
    END IF;
END
$stage07_fail$;

COMMIT;
