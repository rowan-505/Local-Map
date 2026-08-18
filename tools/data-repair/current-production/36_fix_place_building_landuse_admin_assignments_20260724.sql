-- =============================================================================
-- 36: Fix place / building / landuse admin_area_id (PREPARED — DO NOT RUN YET)
-- Date: 2026-07-24
-- Project: locghyuranqaqsnbxflc
-- Plan: tmp/admin-assignment-repair/assignment-plan-summary.md
-- CSVs: tmp/admin-assignment-repair/*-assignment-plan.csv
--
-- Scope:
--   core.core_places          — REASSIGN_SAFE only (1713)
--   core.core_buildings   — REASSIGN_SAFE only (1121)
--   core.core_land_areas     — REASSIGN_SAFE only (19)
--
-- Rules:
--   Places:    unique ST_Covers(point_geom) among 364 operational townships
--   Buildings: unique ST_Covers(ST_PointOnSurface(geom))
--   Landuse:   max positive intersect area; tie within 1 m² → skip
--
-- Updates ONLY: admin_area_id, updated_at
-- Does NOT change: geometry, names, verification, source fields
-- Does NOT assign NO_MATCH / AMBIGUOUS / MANUAL_PROTECTED_REVIEW
-- Does NOT use nearest-township fallback
--
-- Suggested prior filenames 34/35 conflicted with township repair SQL;
-- this file is numbered 36 in sequence.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '30min';
SET LOCAL lock_timeout = '30s';
SET LOCAL work_mem = '512MB';

-- ---------------------------------------------------------------------------
-- 0) Slim backup of rows that will change
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system.repair_admin_assign_pbl_20260724 (
    entity_family text NOT NULL,
    entity_id bigint NOT NULL,
    old_admin_area_id bigint,
    new_admin_area_id bigint NOT NULL,
    old_updated_at timestamptz,
    backed_up_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_family, entity_id)
);

CREATE TEMP TABLE ops_township AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.is_active IS TRUE
  AND aa.deleted_at IS NULL
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND core.admin_area_is_operational_township(aa.id, al.code);

CREATE INDEX ON ops_township USING gist (geom);
ANALYZE ops_township;

DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM ops_township;
    IF n <> 364 THEN
        RAISE EXCEPTION 'Expected 364 operational townships, found %', n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Places — unique operational cover of point_geom
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE places_reassign AS
WITH match AS (
  SELECT
    p.id,
    p.admin_area_id AS old_admin_area_id,
    p.updated_at AS old_updated_at,
    (
      SELECT count(*)::int
      FROM ops_township o
      WHERE o.geom && p.point_geom
        AND st_covers(o.geom, p.point_geom)
    ) AS match_count,
    (
      SELECT o.id
      FROM ops_township o
      WHERE o.geom && p.point_geom
        AND st_covers(o.geom, p.point_geom)
      ORDER BY o.id
      LIMIT 1
    ) AS proposed_id
  FROM core.core_places p
  WHERE p.deleted_at IS NULL
    AND p.point_geom IS NOT NULL
    AND NOT st_isempty(p.point_geom)
    AND st_isvalid(p.point_geom)
)
SELECT
  id,
  old_admin_area_id,
  old_updated_at,
  proposed_id AS new_admin_area_id
FROM match
WHERE match_count = 1
  AND proposed_id IS DISTINCT FROM old_admin_area_id;

INSERT INTO system.repair_admin_assign_pbl_20260724 (
  entity_family, entity_id, old_admin_area_id, new_admin_area_id, old_updated_at
)
SELECT 'places', id, old_admin_area_id, new_admin_area_id, old_updated_at
FROM places_reassign
ON CONFLICT DO NOTHING;

UPDATE core.core_places p
SET admin_area_id = r.new_admin_area_id,
    updated_at = now()
FROM places_reassign r
WHERE p.id = r.id
  AND p.admin_area_id IS DISTINCT FROM r.new_admin_area_id;

-- ---------------------------------------------------------------------------
-- 2) Buildings — unique operational cover of ST_PointOnSurface(geom)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE buildings_reassign AS
WITH match AS (
  SELECT
    b.id,
    b.admin_area_id AS old_admin_area_id,
    b.updated_at AS old_updated_at,
    st_pointonsurface(b.geom)::geometry(Point, 4326) AS pt
  FROM core.core_buildings b
  WHERE b.deleted_at IS NULL
    AND coalesce(b.is_active, true)
    AND b.geom IS NOT NULL
    AND NOT st_isempty(b.geom)
    AND st_isvalid(b.geom)
),
counted AS (
  SELECT
    m.*,
    (
      SELECT count(*)::int
      FROM ops_township o
      WHERE o.geom && m.pt
        AND st_covers(o.geom, m.pt)
    ) AS match_count,
    (
      SELECT o.id
      FROM ops_township o
      WHERE o.geom && m.pt
        AND st_covers(o.geom, m.pt)
      ORDER BY o.id
      LIMIT 1
    ) AS proposed_id
  FROM match m
)
SELECT
  id,
  old_admin_area_id,
  old_updated_at,
  proposed_id AS new_admin_area_id
FROM counted
WHERE match_count = 1
  AND proposed_id IS DISTINCT FROM old_admin_area_id;

INSERT INTO system.repair_admin_assign_pbl_20260724 (
  entity_family, entity_id, old_admin_area_id, new_admin_area_id, old_updated_at
)
SELECT 'buildings', id, old_admin_area_id, new_admin_area_id, old_updated_at
FROM buildings_reassign
ON CONFLICT DO NOTHING;

UPDATE core.core_buildings b
SET admin_area_id = r.new_admin_area_id,
    updated_at = now()
FROM buildings_reassign r
WHERE b.id = r.id
  AND b.admin_area_id IS DISTINCT FROM r.new_admin_area_id;

-- ---------------------------------------------------------------------------
-- 3) Landuse — max intersect area; skip ties within 1 m²; skip manual conflicts
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE landuse_reassign AS
WITH base AS (
  SELECT
    l.id,
    l.admin_area_id AS old_admin_area_id,
    l.updated_at AS old_updated_at,
    l.geom,
    coalesce(l.manual_override, false) AS is_manual_protected
  FROM core.core_land_areas l
  WHERE l.deleted_at IS NULL
    AND coalesce(l.is_active, true)
    AND l.geom IS NOT NULL
    AND NOT st_isempty(l.geom)
    AND st_isvalid(l.geom)
),
ranked AS (
  SELECT
    b.id,
    b.old_admin_area_id,
    b.old_updated_at,
    b.is_manual_protected,
    o.id AS township_id,
    st_area(st_intersection(o.geom, b.geom)::geography) AS overlap_m2,
    row_number() OVER (
      PARTITION BY b.id
      ORDER BY st_area(st_intersection(o.geom, b.geom)::geography) DESC NULLS LAST, o.id ASC
    ) AS rn,
    lead(st_area(st_intersection(o.geom, b.geom)::geography)) OVER (
      PARTITION BY b.id
      ORDER BY st_area(st_intersection(o.geom, b.geom)::geography) DESC NULLS LAST, o.id ASC
    ) AS second_m2
  FROM base b
  JOIN ops_township o
    ON o.geom && b.geom
   AND st_intersects(o.geom, b.geom)
),
best AS (
  SELECT *
  FROM ranked
  WHERE rn = 1
    AND overlap_m2 > 0
    AND (second_m2 IS NULL OR abs(overlap_m2 - second_m2) > 1.0)
)
SELECT
  b.id,
  b.old_admin_area_id,
  b.old_updated_at,
  best.township_id AS new_admin_area_id
FROM base b
JOIN best ON best.id = b.id
WHERE best.township_id IS DISTINCT FROM b.old_admin_area_id
  AND NOT (
    b.is_manual_protected
    AND b.old_admin_area_id IS NOT NULL
    AND best.township_id IS DISTINCT FROM b.old_admin_area_id
  );

INSERT INTO system.repair_admin_assign_pbl_20260724 (
  entity_family, entity_id, old_admin_area_id, new_admin_area_id, old_updated_at
)
SELECT 'landuse', id, old_admin_area_id, new_admin_area_id, old_updated_at
FROM landuse_reassign
ON CONFLICT DO NOTHING;

UPDATE core.core_land_areas l
SET admin_area_id = r.new_admin_area_id,
    updated_at = now()
FROM landuse_reassign r
WHERE l.id = r.id
  AND l.admin_area_id IS DISTINCT FROM r.new_admin_area_id;

-- ---------------------------------------------------------------------------
-- 4) Verify counts vs plan (1713 / 1121 / 19)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    n_places int;
    n_buildings int;
    n_landuse int;
BEGIN
    SELECT count(*) INTO n_places FROM system.repair_admin_assign_pbl_20260724 WHERE entity_family = 'places';
    SELECT count(*) INTO n_buildings FROM system.repair_admin_assign_pbl_20260724 WHERE entity_family = 'buildings';
    SELECT count(*) INTO n_landuse FROM system.repair_admin_assign_pbl_20260724 WHERE entity_family = 'landuse';

    RAISE NOTICE 'backup places=% buildings=% landuse=%', n_places, n_buildings, n_landuse;

    IF n_places <> 1713 OR n_buildings <> 1121 OR n_landuse <> 19 THEN
        RAISE EXCEPTION
          'Count mismatch vs plan (expected places=1713 buildings=1121 landuse=19); got %/%/% — rolling back',
          n_places, n_buildings, n_landuse;
    END IF;
END $$;

-- Safety default: ROLLBACK. After operator review, change to COMMIT.
ROLLBACK;
-- COMMIT;
