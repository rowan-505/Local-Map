-- =============================================================================
-- 37: Fix street admin_area_id (PREPARED — DO NOT RUN YET)
-- Date: 2026-07-24
-- Project: locghyuranqaqsnbxflc
-- Plan: tmp/admin-assignment-repair/assignment-plan-summary.md
-- CSV (affected only): tmp/admin-assignment-repair/streets-assignment-plan.csv
--
-- Scope:
--   core.core_streets — REASSIGN_SAFE only (plan count: 11282)
--
-- Rules:
--   Dominant positive line–township intersect length among 364 operational townships
--   Tie within 1 metre → skip (AMBIGUOUS)
--   No positive length → skip (NO_MATCH)
--   manual_override conflicts → skip (MANUAL_PROTECTED_REVIEW)
--   No centroid / start-point / nearest fallback
--
-- Updates ONLY: admin_area_id, updated_at
-- Does NOT change: geometry, names, verification, source fields
--
-- Performance:
--   Bounding-box filter (&&) then ST_Intersects then ST_Length(ST_Intersection)
--   Uses GiST on core.core_admin_areas.geom and core.core_streets.geom
--   Processes only non-KEEP_VALID candidates (null / non-op / multi-touch / inconsistent)
--
-- Suggested prior filenames 34/35 conflicted with township repair SQL;
-- this file is numbered 37 in sequence.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '0';
SET LOCAL lock_timeout = '60s';
SET LOCAL work_mem = '1GB';
SET LOCAL jit = off;

-- ---------------------------------------------------------------------------
-- 0) Backup table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system.repair_admin_assign_streets_20260724 (
    entity_id bigint PRIMARY KEY,
    old_admin_area_id bigint,
    new_admin_area_id bigint NOT NULL,
    overlap_m double precision,
    second_m double precision,
    old_updated_at timestamptz,
    backed_up_at timestamptz NOT NULL DEFAULT now()
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
-- 1) Candidate streets (exclude unique single-op KEEP_VALID)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE street_active AS
SELECT
  s.id,
  s.admin_area_id AS old_admin_area_id,
  s.updated_at AS old_updated_at,
  s.geom,
  coalesce(s.manual_override, false) AS is_manual_protected
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND coalesce(s.is_active, true)
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
  AND st_isvalid(s.geom);

CREATE INDEX ON street_active USING gist (geom);
CREATE UNIQUE INDEX ON street_active (id);
ANALYZE street_active;

CREATE TEMP TABLE street_op_touch AS
SELECT
  s.id,
  count(*)::int AS op_touch_count,
  min(o.id) AS only_op_id,
  bool_or(s.old_admin_area_id IS NOT NULL AND o.id = s.old_admin_area_id) AS touches_current_op
FROM street_active s
JOIN ops_township o
  ON o.geom && s.geom
 AND st_intersects(o.geom, s.geom)
GROUP BY s.id;

CREATE UNIQUE INDEX ON street_op_touch (id);
ANALYZE street_op_touch;

CREATE TEMP TABLE street_candidates AS
SELECT s.*
FROM street_active s
WHERE NOT EXISTS (
  SELECT 1
  FROM street_op_touch t
  WHERE t.id = s.id
    AND t.op_touch_count = 1
    AND t.touches_current_op
    AND s.old_admin_area_id = t.only_op_id
);

CREATE INDEX ON street_candidates USING gist (geom);
CREATE UNIQUE INDEX ON street_candidates (id);
ANALYZE street_candidates;

-- ---------------------------------------------------------------------------
-- 2) Dominant-length pick (1 m tie → exclude)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE street_reassign AS
WITH lengths AS (
  SELECT
    c.id,
    c.old_admin_area_id,
    c.old_updated_at,
    c.is_manual_protected,
    o.id AS township_id,
    st_length(st_intersection(o.geom, c.geom)::geography) AS overlap_m
  FROM street_candidates c
  JOIN ops_township o
    ON o.geom && c.geom
   AND st_intersects(o.geom, c.geom)
),
ranked AS (
  SELECT
    l.*,
    row_number() OVER (
      PARTITION BY l.id
      ORDER BY l.overlap_m DESC NULLS LAST, l.township_id ASC
    ) AS rn,
    lead(l.overlap_m) OVER (
      PARTITION BY l.id
      ORDER BY l.overlap_m DESC NULLS LAST, l.township_id ASC
    ) AS second_m
  FROM lengths l
  WHERE l.overlap_m > 0
),
best AS (
  SELECT *
  FROM ranked
  WHERE rn = 1
    AND (second_m IS NULL OR abs(overlap_m - second_m) > 1.0)
)
SELECT
  b.id,
  b.old_admin_area_id,
  b.old_updated_at,
  best.township_id AS new_admin_area_id,
  best.overlap_m,
  best.second_m
FROM street_candidates b
JOIN best ON best.id = b.id
WHERE best.township_id IS DISTINCT FROM b.old_admin_area_id
  AND NOT (
    b.is_manual_protected
    AND b.old_admin_area_id IS NOT NULL
    AND best.township_id IS DISTINCT FROM b.old_admin_area_id
  );

CREATE UNIQUE INDEX ON street_reassign (id);
ANALYZE street_reassign;

INSERT INTO system.repair_admin_assign_streets_20260724 (
  entity_id, old_admin_area_id, new_admin_area_id, overlap_m, second_m, old_updated_at
)
SELECT id, old_admin_area_id, new_admin_area_id, overlap_m, second_m, old_updated_at
FROM street_reassign
ON CONFLICT DO NOTHING;

UPDATE core.core_streets s
SET admin_area_id = r.new_admin_area_id,
    updated_at = now()
FROM street_reassign r
WHERE s.id = r.id
  AND s.admin_area_id IS DISTINCT FROM r.new_admin_area_id
  AND coalesce(s.manual_override, false) IS NOT TRUE;

-- ---------------------------------------------------------------------------
-- 3) Verify vs plan count 11282
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM system.repair_admin_assign_streets_20260724;
    RAISE NOTICE 'street backup/reassign rows=%', n;
    IF n <> 11282 THEN
        RAISE EXCEPTION
          'Street reassign count % != plan 11282 — rolling back', n;
    END IF;
END $$;

-- Optional follow-up (NOT enabled): clear non-operational admin on NO_MATCH/AMBIGUOUS
-- unprotected streets. Review CSV before enabling.
--
-- UPDATE core.core_streets s
-- SET admin_area_id = NULL, updated_at = now()
-- WHERE ... ;

-- Safety default: ROLLBACK. After operator review, change to COMMIT.
ROLLBACK;
-- COMMIT;
