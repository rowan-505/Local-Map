-- =============================================================================
-- Stage 07: verify_core_roads (read-only)
-- Reports on active OSM rows in core.core_streets.
--
-- Hard fail: invalid geometry, duplicate external_id, null road_class_id.
--
-- psql variables: snapshot_version (optional context label), staging_schema unused
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?snapshot_version}
\else
\set snapshot_version ''
\endif

BEGIN;

CREATE TEMP TABLE stage07_osm_scope AS
SELECT
    cs.id,
    cs.external_id,
    cs.canonical_name,
    cs.geom,
    cs.road_class_id,
    cs.road_class,
    cs.is_verified,
    CASE
        WHEN coalesce(cs.is_verified, false) THEN 'verified'
        ELSE 'unverified'
    END AS verification_status,
    cs.manual_override,
    ST_Length(cs.geom::geography) AS length_m
FROM core.core_streets AS cs
JOIN ref.ref_source_types AS st
    ON st.id = cs.source_type_id
   AND st.code = 'osm'
WHERE coalesce(cs.is_active, true)
  AND cs.deleted_at IS NULL;

CREATE TEMP TABLE stage07_summary (
    check_name text NOT NULL,
    metric_value numeric,
    metric_text text
);

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'total_active_osm_roads', count(*)::numeric, NULL
FROM stage07_osm_scope;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'null_geometry_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE geom IS NULL;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'invalid_geometry_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND (NOT ST_IsValid(geom) OR ST_IsEmpty(geom));

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'srid_not_4326_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE geom IS NOT NULL
  AND ST_SRID(geom) IS DISTINCT FROM 4326;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'duplicate_external_id_count', coalesce(sum(dup.cnt - 1), 0)::numeric, NULL
FROM (
    SELECT count(*)::bigint AS cnt
    FROM stage07_osm_scope
    WHERE external_id IS NOT NULL
      AND btrim(external_id) <> ''
    GROUP BY external_id
    HAVING count(*) > 1
) AS dup;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'null_road_class_id_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE road_class_id IS NULL;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'unverified_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE coalesce(is_verified, false) = false;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'verified_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE is_verified = true;

INSERT INTO stage07_summary (check_name, metric_value, metric_text)
SELECT 'manual_override_count', count(*)::numeric, NULL
FROM stage07_osm_scope
WHERE coalesce(manual_override, false) = true;

SELECT '=== stage07_summary ===' AS section;
SELECT check_name, metric_value, metric_text
FROM stage07_summary
ORDER BY check_name;

SELECT '=== count_by_road_class ===' AS section;
SELECT
    coalesce(road_class, '<null>') AS road_class,
    count(*)::bigint AS road_count
FROM stage07_osm_scope
GROUP BY road_class
ORDER BY road_count DESC, road_class;

SELECT '=== total_length_km_by_road_class ===' AS section;
SELECT
    coalesce(road_class, '<null>') AS road_class,
    round((sum(length_m) / 1000.0)::numeric, 3) AS total_length_km
FROM stage07_osm_scope
WHERE geom IS NOT NULL
GROUP BY road_class
ORDER BY total_length_km DESC, road_class;

SELECT '=== top_20_longest_roads ===' AS section;
SELECT
    external_id,
    canonical_name,
    road_class,
    round((length_m / 1000.0)::numeric, 3) AS length_km,
    is_verified,
    verification_status
FROM stage07_osm_scope
WHERE geom IS NOT NULL
ORDER BY length_m DESC NULLS LAST
LIMIT 20;

SELECT '=== sample_50_rows ===' AS section;
SELECT
    external_id,
    canonical_name,
    road_class,
    round(length_m::numeric, 1) AS length_m,
    is_verified,
    verification_status
FROM stage07_osm_scope
ORDER BY external_id
LIMIT 50;

DO $stage07_fail$
DECLARE
    v_invalid bigint;
    v_dup bigint;
    v_null_class bigint;
    v_snapshot text;
BEGIN
    SELECT coalesce(metric_value, 0)::bigint
    INTO v_invalid
    FROM stage07_summary
    WHERE check_name = 'invalid_geometry_count';

    SELECT coalesce(metric_value, 0)::bigint
    INTO v_dup
    FROM stage07_summary
    WHERE check_name = 'duplicate_external_id_count';

    SELECT coalesce(metric_value, 0)::bigint
    INTO v_null_class
    FROM stage07_summary
    WHERE check_name = 'null_road_class_id_count';

    v_snapshot := nullif(btrim(:'snapshot_version'), '');

    IF v_invalid > 0 OR v_dup > 0 OR v_null_class > 0 THEN
        RAISE EXCEPTION
            'Stage 07 verify_core_roads failed (snapshot=%): invalid_geom=% duplicate_external_id=% null_road_class_id=%',
            coalesce(v_snapshot, '<all-osm>'),
            v_invalid,
            v_dup,
            v_null_class;
    END IF;
END
$stage07_fail$;

COMMIT;
