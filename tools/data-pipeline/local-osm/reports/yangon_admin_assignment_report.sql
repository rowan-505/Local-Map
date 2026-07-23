-- Yangon township assignment diagnostic (read-only, set-based).
-- Prerequisite: pipeline_township_assignment.sql
\pset pager off
\timing on
\set ON_ERROR_STOP on

\echo '=== Yangon clip + township inventory ==='
SELECT aa.id, aa.canonical_name, al.code,
       round(ST_Area(aa.geom::geography)::numeric / 1e6, 2) AS area_km2
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.id = 2043;

DROP TABLE IF EXISTS _tw_polys;
CREATE TEMP TABLE _tw_polys AS
SELECT aa.id, aa.canonical_name, al.code, aa.geom,
       core.admin_area_township_match_priority(al.code) AS pri
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active AND aa.geom IS NOT NULL
  AND st_isvalid(aa.geom)
  AND core.admin_area_qualifies_as_township_target(al.code, aa.canonical_name);
CREATE INDEX ON _tw_polys USING gist (geom);

DROP TABLE IF EXISTS _district_polys;
CREATE TEMP TABLE _district_polys AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND aa.is_active AND al.code = 'district'
  AND aa.geom IS NOT NULL AND st_isvalid(aa.geom);
CREATE INDEX ON _district_polys USING gist (geom);

SELECT
  count(*) FILTER (WHERE t.code = 'township') AS official_township_in_clip,
  count(*) AS township_like_in_clip
FROM _tw_polys t
JOIN core.core_admin_areas clip ON clip.id = 2043
WHERE ST_Intersects(t.geom, clip.geom);

\echo '=== Family stats ==='
DROP TABLE IF EXISTS _yangon_admin_family_stats;
CREATE TEMP TABLE _yangon_admin_family_stats (
  family text PRIMARY KEY,
  snapshot_id bigint,
  total bigint,
  valid_township bigint,
  district_only bigint,
  ambiguous_township bigint,
  outside_township bigint,
  assignment_failure bigint
);

-- Places
DROP TABLE IF EXISTS _pts;
CREATE TEMP TABLE _pts AS
SELECT id, point_geom AS geom
FROM staging.staging_place_candidates
WHERE source_snapshot_id = 9 AND point_geom IS NOT NULL;
CREATE INDEX ON _pts USING gist (geom);

DROP TABLE IF EXISTS _pt_tw;
CREATE TEMP TABLE _pt_tw AS
WITH covers AS (
  SELECT p.id, t.id AS tw_id, t.pri
  FROM _pts p
  JOIN _tw_polys t ON ST_Covers(t.geom, p.geom)
),
best AS (
  SELECT id, min(pri) AS best_pri FROM covers GROUP BY id
),
ranked AS (
  SELECT c.id, count(*)::int AS n, min(c.tw_id) AS any_id
  FROM covers c
  JOIN best b ON b.id = c.id AND b.best_pri = c.pri
  GROUP BY c.id
)
SELECT p.id,
       CASE WHEN r.n = 1 THEN r.any_id END AS tw_id,
       coalesce(r.n, 0) AS tw_n,
       EXISTS (
         SELECT 1 FROM _district_polys d WHERE ST_Covers(d.geom, p.geom)
       ) AS in_district
FROM _pts p
LEFT JOIN ranked r ON r.id = p.id;

INSERT INTO _yangon_admin_family_stats
SELECT 'places', 9, count(*),
  count(*) FILTER (WHERE tw_id IS NOT NULL),
  count(*) FILTER (WHERE tw_id IS NULL AND in_district AND tw_n <= 1),
  count(*) FILTER (WHERE tw_id IS NULL AND tw_n > 1),
  count(*) FILTER (WHERE tw_id IS NULL AND NOT in_district AND tw_n = 0),
  0
FROM _pt_tw;

-- Buildings / landuse via function (small)
INSERT INTO _yangon_admin_family_stats
SELECT 'buildings', 10, count(*),
  count(*) FILTER (WHERE core.find_admin_area_for_polygon(geom,'township') IS NOT NULL),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND EXISTS (
        SELECT 1 FROM _district_polys d
        WHERE ST_Covers(d.geom, ST_PointOnSurface(s.geom))
      )
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) <= 1
  ),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) > 1
  ),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM _district_polys d
        WHERE ST_Covers(d.geom, ST_PointOnSurface(s.geom))
      )
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) = 0
  ),
  count(*) FILTER (WHERE geom IS NULL OR ST_IsEmpty(geom))
FROM staging.staging_building_candidates s
WHERE source_snapshot_id = 10;

INSERT INTO _yangon_admin_family_stats
SELECT 'landuse', 10, count(*),
  count(*) FILTER (WHERE core.find_admin_area_for_polygon(geom,'township') IS NOT NULL),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND EXISTS (
        SELECT 1 FROM _district_polys d
        WHERE ST_Covers(d.geom, ST_PointOnSurface(s.geom))
      )
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) <= 1
  ),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) > 1
  ),
  count(*) FILTER (
    WHERE core.find_admin_area_for_polygon(geom,'township') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM _district_polys d
        WHERE ST_Covers(d.geom, ST_PointOnSurface(s.geom))
      )
      AND (
        SELECT count(*) FROM _tw_polys t
        WHERE ST_Covers(t.geom, ST_PointOnSurface(s.geom))
      ) = 0
  ),
  0
FROM staging.staging_landuse_candidates s
WHERE source_snapshot_id = 10 AND geom IS NOT NULL;

INSERT INTO _yangon_admin_family_stats
SELECT 'water_lines', 10, count(*),
  count(*) FILTER (WHERE core.find_admin_area_for_line(geom,'township') IS NOT NULL),
  count(*) FILTER (
    WHERE core.find_admin_area_for_line(geom,'township') IS NULL
      AND EXISTS (SELECT 1 FROM _district_polys d WHERE ST_Intersects(d.geom, s.geom))
  ),
  0,
  count(*) FILTER (
    WHERE core.find_admin_area_for_line(geom,'township') IS NULL
      AND NOT EXISTS (SELECT 1 FROM _district_polys d WHERE ST_Intersects(d.geom, s.geom))
  ),
  0
FROM staging.staging_water_line_candidates s
WHERE source_snapshot_id = 10 AND geom IS NOT NULL;

-- Roads: sample function in set
DROP TABLE IF EXISTS _roads;
CREATE TEMP TABLE _roads AS
SELECT id, geom FROM staging.staging_road_candidates
WHERE source_snapshot_id = 12 AND geom IS NOT NULL;

DROP TABLE IF EXISTS _road_tw;
CREATE TEMP TABLE _road_tw AS
SELECT id, core.find_admin_area_for_line(geom, 'township') AS tw_id
FROM _roads;

INSERT INTO _yangon_admin_family_stats
SELECT 'roads', 12, count(*),
  count(*) FILTER (WHERE t.tw_id IS NOT NULL),
  count(*) FILTER (
    WHERE t.tw_id IS NULL
      AND EXISTS (SELECT 1 FROM _district_polys d WHERE ST_Intersects(d.geom, r.geom))
  ),
  0, -- close-overlap counted inside function as NULL; optional detail omitted for speed
  count(*) FILTER (
    WHERE t.tw_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM _district_polys d WHERE ST_Intersects(d.geom, r.geom))
  ),
  0
FROM _roads r
JOIN _road_tw t ON t.id = r.id;

\echo '=== Family summary ==='
SELECT family, snapshot_id, total, valid_township, district_only,
       ambiguous_township, outside_township, assignment_failure,
       round(100.0 * valid_township / NULLIF(total,0), 1) AS pct_valid_tw
FROM _yangon_admin_family_stats
ORDER BY family;

\echo '=== Smoke buildings ==='
SELECT id, core.find_admin_area_for_polygon(geom, 'township') AS tw_id
FROM staging.staging_building_candidates
WHERE source_snapshot_id = 10
LIMIT 8;
