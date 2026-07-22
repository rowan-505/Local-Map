-- =============================================================================
-- Local SQL scenarios for validation + previous-snapshot hash compare.
-- Does not write Supabase. Uses temp tables only (ROLLBACK at end).
--
-- Scenarios:
--   1) same snapshot vs itself → zero source_changed
--   2) one changed hash → source_changed
--   3) removed OSM object → source_missing
--   4) invalid geometry → validation invalid
--   5) unsupported category → validation invalid
--   6) warning-only (optional name) → validation warning
-- Run from tools/data-pipeline/local-osm:
--   psql "$LOCAL_DATABASE_URL" -f scripts/test_validation_source_status.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

\ir ../pipeline_source_identity.sql
\ir ../pipeline_candidate_validation.sql

CREATE TEMP TABLE t_assert (
    scenario text PRIMARY KEY,
    ok boolean NOT NULL,
    detail text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Validation function cases
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v jsonb;
    v_geom geometry;
    v_bad geometry;
BEGIN
    v_geom := ST_SetSRID(ST_MakeLine(ST_MakePoint(96.2, 16.8), ST_MakePoint(96.21, 16.81)), 4326);
    v_bad := ST_SetSRID(
        ST_GeomFromText('POLYGON((96.2 16.8, 96.3 16.9, 96.3 16.8, 96.2 16.9, 96.2 16.8))'),
        4326
    );

    v := system.pipeline_validate_candidate(
        'roads', 'osm:way:1', '{"road_class":"residential"}'::jsonb,
        v_geom, 'residential', 1, 'Main', NULL
    );
    INSERT INTO t_assert VALUES (
        'valid_road',
        (v->>'status') = 'valid',
        v::text
    );

    v := system.pipeline_validate_candidate(
        'buildings', 'osm:way:3', '{}'::jsonb,
        v_bad, 'yes', NULL, 'Bldg', NULL
    );
    INSERT INTO t_assert VALUES (
        'invalid_geometry',
        (v->>'status') = 'invalid' AND (v->'notes') ?| ARRAY['geometry_invalid'],
        v::text
    );

    v := system.pipeline_validate_candidate(
        'roads', 'osm:way:4', '{}'::jsonb,
        v_geom, NULL, NULL, 'Main', NULL
    );
    INSERT INTO t_assert VALUES (
        'unsupported_category',
        (v->>'status') = 'invalid' AND (v->'notes') ?| ARRAY['category_or_class_mapping_missing'],
        v::text
    );

    v := system.pipeline_validate_candidate(
        'roads', 'osm:way:5', '{"road_class":"residential"}'::jsonb,
        v_geom, 'residential', 1, NULL, NULL
    );
    INSERT INTO t_assert VALUES (
        'warning_only_optional_name',
        (v->>'status') = 'warning' AND (v->'notes') ?| ARRAY['optional_name_missing'],
        v::text
    );
END $$;

-- ---------------------------------------------------------------------------
-- Hash compare scenarios (temp staging-like rows)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_cand (
    id bigint PRIMARY KEY,
    external_id text NOT NULL,
    normalized_hash text,
    side text NOT NULL
) ON COMMIT DROP;

INSERT INTO t_cand VALUES
    (1, 'osm:way:100', 'hashA', 'prev'),
    (2, 'osm:way:100', 'hashA', 'curr_same'),
    (3, 'osm:way:100', 'hashB', 'curr_changed'),
    (4, 'osm:way:200', 'hashC', 'prev_only'),
    (5, 'osm:way:300', 'hashD', 'curr_new');

CREATE TEMP TABLE t_pair AS
WITH prev AS (
    SELECT * FROM t_cand WHERE side = 'prev'
),
curr_same AS (
    SELECT * FROM t_cand WHERE side = 'curr_same'
),
same_cmp AS (
    SELECT
        'same_snapshot_self' AS scenario,
        CASE
            WHEN c.id IS NULL THEN 'deleted_candidate'
            WHEN p.id IS NULL THEN 'new'
            WHEN coalesce(c.normalized_hash,'') IS DISTINCT FROM coalesce(p.normalized_hash,'') THEN 'changed'
            ELSE 'unchanged'
        END AS diff_type
    FROM curr_same AS c
    FULL OUTER JOIN prev AS p
        ON system.pipeline_osm_identity_key(p.external_id)
         = system.pipeline_osm_identity_key(c.external_id)
),
prev_full AS (
    SELECT * FROM t_cand WHERE side IN ('prev', 'prev_only')
),
curr_mixed AS (
    SELECT * FROM t_cand WHERE side IN ('curr_changed', 'curr_new')
),
mixed_cmp AS (
    SELECT
        CASE
            WHEN c.external_id = 'osm:way:100' THEN 'one_changed'
            WHEN c.external_id = 'osm:way:300' THEN 'one_new'
            WHEN p.external_id = 'osm:way:200' THEN 'one_missing'
            ELSE 'other'
        END AS scenario,
        CASE
            WHEN c.id IS NULL THEN 'deleted_candidate'
            WHEN p.id IS NULL THEN 'new'
            WHEN coalesce(c.normalized_hash,'') IS DISTINCT FROM coalesce(p.normalized_hash,'') THEN 'changed'
            ELSE 'unchanged'
        END AS diff_type
    FROM curr_mixed AS c
    FULL OUTER JOIN prev_full AS p
        ON system.pipeline_osm_identity_key(p.external_id)
         = system.pipeline_osm_identity_key(c.external_id)
)
SELECT * FROM same_cmp
UNION ALL
SELECT * FROM mixed_cmp;

INSERT INTO t_assert
SELECT
    'same_snapshot_zero_false_changes',
    count(*) FILTER (WHERE diff_type = 'changed') = 0
      AND count(*) FILTER (WHERE diff_type = 'unchanged') >= 1,
    format('changed=%s unchanged=%s', count(*) FILTER (WHERE diff_type = 'changed'), count(*) FILTER (WHERE diff_type = 'unchanged'))
FROM t_pair
WHERE scenario = 'same_snapshot_self';

INSERT INTO t_assert
SELECT
    'newer_one_changed',
    bool_or(diff_type = 'changed'),
    string_agg(diff_type, ',')
FROM t_pair
WHERE scenario = 'one_changed';

INSERT INTO t_assert
SELECT
    'removed_osm_object',
    bool_or(diff_type = 'deleted_candidate')
      AND bool_or(system.pipeline_map_diff_to_source_status(diff_type) = 'source_missing'),
    string_agg(diff_type || '→' || system.pipeline_map_diff_to_source_status(diff_type), ',')
FROM t_pair
WHERE scenario = 'one_missing';

SELECT
    'validation_source_sql_tests' AS section,
    scenario,
    ok,
    detail,
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status
FROM t_assert
ORDER BY scenario;

SELECT
    'validation_source_sql_summary' AS section,
    count(*) AS scenarios,
    count(*) FILTER (WHERE ok) AS passed,
    count(*) FILTER (WHERE NOT ok) AS failed,
    CASE WHEN count(*) FILTER (WHERE NOT ok) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM t_assert;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM t_assert WHERE NOT ok) THEN
        RAISE EXCEPTION 'validation/source SQL scenarios failed';
    END IF;
END $$;

ROLLBACK;
