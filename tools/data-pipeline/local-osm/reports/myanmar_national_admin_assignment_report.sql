-- National admin-assignment precision probes (read-only).
-- Uses prod_mirror only (local core schema removed — Mode B).
-- Does not CREATE OR REPLACE functions (avoids lock wait on long Stage 05 tx).
\pset pager off
\timing on
\set ON_ERROR_STOP on
SET statement_timeout = '180s';

\echo '=== 1) Mirror admin inventory ==='
SELECT al.code, count(*) AS n
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL
GROUP BY 1
ORDER BY 1;

\echo '=== 2) Country polygons ==='
SELECT aa.id, aa.canonical_name,
  round((ST_Area(aa.geom::geography) / 1e6)::numeric, 1) AS km2,
  ST_IsValid(aa.geom) AS valid
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'country' AND aa.deleted_at IS NULL;

\echo '=== 3) State/region area sum ==='
SELECT count(*) AS n,
  round((sum(ST_Area(aa.geom::geography)) / 1e6)::numeric, 1) AS sum_km2
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'state_region' AND aa.deleted_at IS NULL;

\echo '=== 4) Township / ward / town counts ==='
SELECT
  count(*) FILTER (WHERE al.code = 'township') AS official_township,
  count(*) FILTER (
    WHERE al.code = 'ward_village_tract'
      AND coalesce(aa.canonical_name, '') !~ 'ရပ်ကွက်'
      AND coalesce(aa.canonical_name, '') !~ 'အမှတ်'
  ) AS ward_township_like,
  count(*) FILTER (WHERE al.code = 'ward_village_tract') AS all_wards,
  count(*) FILTER (WHERE al.code = 'town') AS towns
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.geom IS NOT NULL;

\echo '=== 5) Sample 500 raw points: pipeline_assign (prod_mirror IDs) ==='
DROP TABLE IF EXISTS _s;
CREATE TEMP TABLE _s AS
SELECT id, geom
FROM raw.raw_osm_points
WHERE source_snapshot_id = (
    SELECT max(id) FROM system.system_source_snapshots
)
  AND geom IS NOT NULL
ORDER BY id
LIMIT 500;

DROP TABLE IF EXISTS _a;
CREATE TEMP TABLE _a AS
SELECT id, system.pipeline_assign_admin_area_for_point(geom) AS fine_id
FROM _s;

SELECT count(*) AS n,
  count(fine_id) AS assigned,
  count(*) FILTER (WHERE fine_id IS NULL) AS nulls,
  round(100.0 * count(fine_id) / greatest(count(*), 1), 1) AS pct
FROM _a;

SELECT coalesce(al.code, 'NULL') AS level, count(*) AS n
FROM _a a
LEFT JOIN prod_mirror.core_admin_areas aa ON aa.id = a.fine_id
LEFT JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
GROUP BY 1
ORDER BY n DESC;

\echo '=== 6) Set-based unique township-like cover ==='
DROP TABLE IF EXISTS _tw;
CREATE TEMP TABLE _tw AS
SELECT aa.id, al.code, aa.geom,
  CASE WHEN al.code IN ('township', 'town') THEN 1 ELSE 2 END AS pri
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.geom IS NOT NULL
  AND (
    al.code IN ('township', 'town')
    OR (
      al.code = 'ward_village_tract'
      AND coalesce(aa.canonical_name, '') !~ 'ရပ်ကွက်'
      AND coalesce(aa.canonical_name, '') !~ 'အမှတ်'
    )
  );
CREATE INDEX ON _tw USING gist (geom);

DROP TABLE IF EXISTS _dist;
CREATE TEMP TABLE _dist AS
SELECT aa.id, aa.geom
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'district' AND aa.deleted_at IS NULL AND aa.geom IS NOT NULL;
CREATE INDEX ON _dist USING gist (geom);

WITH covers AS (
  SELECT s.id, t.id AS tw_id, t.pri
  FROM _s s
  JOIN _tw t ON ST_Covers(t.geom, s.geom)
),
best AS (
  SELECT id, min(pri) AS bp FROM covers GROUP BY id
),
ranked AS (
  SELECT c.id, count(*)::int AS n, min(c.tw_id) AS any_id
  FROM covers c
  JOIN best b ON b.id = c.id AND b.bp = c.pri
  GROUP BY c.id
)
SELECT
  count(*) AS sample_n,
  count(*) FILTER (WHERE r.n = 1) AS unique_township_like,
  count(*) FILTER (WHERE r.n > 1) AS ambiguous,
  count(*) FILTER (WHERE r.n IS NULL OR r.n = 0) AS no_township_like,
  count(*) FILTER (
    WHERE (r.n IS NULL OR r.n = 0)
      AND EXISTS (SELECT 1 FROM _dist d WHERE ST_Covers(d.geom, s.geom))
  ) AS district_but_no_township,
  round(100.0 * count(*) FILTER (WHERE r.n = 1) / greatest(count(*), 1), 1) AS pct_unique
FROM _s s
LEFT JOIN ranked r ON r.id = s.id;
