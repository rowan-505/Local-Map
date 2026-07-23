-- National admin-assignment precision probes (read-only).
-- Safe while Stage 05 holds staging locks: uses core / prod_mirror / raw only.
-- Does not CREATE OR REPLACE functions (avoids lock wait on long Stage 05 tx).
\pset pager off
\timing on
\set ON_ERROR_STOP on
SET statement_timeout = '180s';

\echo '=== 1) Local admin inventory ==='
SELECT al.code, al.rank, count(*) AS n
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active
GROUP BY 1, 2
ORDER BY al.rank;

\echo '=== 2) Mirror admin inventory ==='
SELECT al.code, count(*) AS n
FROM prod_mirror.core_admin_areas aa
JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
GROUP BY 1
ORDER BY 1;

\echo '=== 3) Country polygons ==='
SELECT aa.id, aa.canonical_name, aa.is_active,
  round((ST_Area(aa.geom::geography) / 1e6)::numeric, 1) AS km2,
  ST_IsValid(aa.geom) AS valid
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'country';

\echo '=== 4) State/region area sum ==='
SELECT count(*) AS n,
  round((sum(ST_Area(aa.geom::geography)) / 1e6)::numeric, 1) AS sum_km2
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'state_region' AND aa.deleted_at IS NULL AND aa.is_active;

\echo '=== 5) Township-like heuristic (name without ရပ်ကွက်/အမှတ်) ==='
SELECT
  count(*) FILTER (WHERE al.code = 'township') AS official_township,
  count(*) FILTER (
    WHERE al.code = 'ward_village_tract'
      AND coalesce(aa.canonical_name, '') !~ 'ရပ်ကွက်'
      AND coalesce(aa.canonical_name, '') !~ 'အမှတ်'
  ) AS ward_township_like,
  count(*) FILTER (WHERE al.code = 'ward_village_tract') AS all_wards,
  count(*) FILTER (WHERE al.code = 'town') AS towns
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active AND aa.geom IS NOT NULL;

\echo '=== 6) Name overlap local township-like wards vs mirror township ==='
WITH local_w AS (
  SELECT aa.canonical_name
  FROM core.core_admin_areas aa
  JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
  WHERE al.code = 'ward_village_tract' AND aa.deleted_at IS NULL AND aa.is_active
    AND coalesce(aa.canonical_name, '') !~ 'ရပ်ကွက်'
    AND coalesce(aa.canonical_name, '') !~ 'အမှတ်'
),
mirror_t AS (
  SELECT aa.canonical_name
  FROM prod_mirror.core_admin_areas aa
  JOIN prod_mirror.ref_admin_levels al ON al.id = aa.admin_level_id
  WHERE al.code = 'township'
)
SELECT
  (SELECT count(*) FROM local_w) AS local_township_like_wards,
  (SELECT count(*) FROM mirror_t) AS mirror_townships,
  (
    SELECT count(*)
    FROM local_w l
    JOIN mirror_t m ON m.canonical_name = l.canonical_name
  ) AS name_matched;

\echo '=== 7) Sample 500 raw national points: pipeline_assign ==='
DROP TABLE IF EXISTS _s;
CREATE TEMP TABLE _s AS
SELECT id, geom
FROM raw.raw_osm_points
WHERE source_snapshot_id = 13 AND geom IS NOT NULL
ORDER BY id
LIMIT 500;

DROP TABLE IF EXISTS _a;
CREATE TEMP TABLE _a AS
SELECT id, system.pipeline_assign_admin_area_for_point(geom) AS fine_id
FROM _s;

SELECT count(*) AS n,
  count(fine_id) AS assigned,
  count(*) FILTER (WHERE fine_id IS NULL) AS nulls,
  round(100.0 * count(fine_id) / count(*), 1) AS pct
FROM _a;

SELECT coalesce(al.code, 'NULL') AS level, count(*) AS n
FROM _a a
LEFT JOIN core.core_admin_areas aa ON aa.id = a.fine_id
LEFT JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
GROUP BY 1
ORDER BY n DESC;

\echo '=== 8) Set-based unique township-like cover (official tw/town + township-like wards) ==='
DROP TABLE IF EXISTS _tw;
CREATE TEMP TABLE _tw AS
SELECT aa.id, al.code, aa.geom,
  CASE WHEN al.code IN ('township', 'town') THEN 1 ELSE 2 END AS pri
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active AND aa.geom IS NOT NULL
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
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE al.code = 'district' AND aa.deleted_at IS NULL AND aa.is_active AND aa.geom IS NOT NULL;
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
  round(100.0 * count(*) FILTER (WHERE r.n = 1) / count(*), 1) AS pct_unique
FROM _s s
LEFT JOIN ranked r ON r.id = s.id;
