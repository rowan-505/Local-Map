-- 35: street admin_area_id apply (batched). Generated 2026-07-24T08:20:33Z
-- Prep:

\set ON_ERROR_STOP on
\timing on
SET statement_timeout = 0;
SET lock_timeout = '60s';
SET work_mem = '1GB';
SET jit = off;

\echo '=== 0) Operational townships ==='
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
CREATE UNIQUE INDEX ON ops_township (id);
ANALYZE ops_township;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM ops_township;
  IF n <> 364 THEN
    RAISE EXCEPTION 'Expected 364 operational townships, found %', n;
  END IF;
END $$;

\echo '=== 1) EXPLAIN ANALYZE sample (500 streets) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*)
FROM (
  SELECT s.id,
         st_length(st_intersection(o.geom, s.geom)::geography) AS overlap_m
  FROM (
    SELECT id, geom
    FROM core.core_streets
    WHERE deleted_at IS NULL AND coalesce(is_active, true) AND geom IS NOT NULL
      AND admin_area_id IS NULL
    LIMIT 500
  ) s
  JOIN ops_township o
    ON o.geom && s.geom
   AND st_intersects(o.geom, s.geom)
) q;

\echo '=== 2) Active streets + candidate filter ==='
CREATE TEMP TABLE street_active AS
SELECT
  s.id,
  s.admin_area_id AS old_admin_area_id,
  s.updated_at AS old_updated_at,
  s.geom,
  coalesce(s.manual_override, false) AS manual_override
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

CREATE TEMP TABLE street_keep_fast AS
SELECT s.id
FROM street_active s
JOIN street_op_touch t ON t.id = s.id
WHERE t.op_touch_count = 1
  AND t.touches_current_op
  AND s.old_admin_area_id = t.only_op_id;
CREATE UNIQUE INDEX ON street_keep_fast (id);

CREATE TEMP TABLE street_candidates AS
SELECT s.*
FROM street_active s
WHERE NOT EXISTS (SELECT 1 FROM street_keep_fast k WHERE k.id = s.id);
CREATE INDEX ON street_candidates USING gist (geom);
CREATE UNIQUE INDEX ON street_candidates (id);
ANALYZE street_candidates;

SELECT
  (SELECT count(*) FROM street_active) AS streets_active,
  (SELECT count(*) FROM street_keep_fast) AS keep_fast,
  (SELECT count(*) FROM street_candidates) AS candidates;

\echo '=== 3) Length ranking ==='
CREATE TEMP TABLE street_lengths AS
SELECT
  c.id,
  c.old_admin_area_id,
  c.old_updated_at,
  c.manual_override,
  o.id AS township_id,
  st_length(st_intersection(o.geom, c.geom)::geography) AS overlap_m
FROM street_candidates c
JOIN ops_township o
  ON o.geom && c.geom
 AND st_intersects(o.geom, c.geom);
CREATE INDEX ON street_lengths (id);
ANALYZE street_lengths;

CREATE TEMP TABLE street_best AS
SELECT *
FROM (
  SELECT
    sl.id,
    sl.old_admin_area_id,
    sl.old_updated_at,
    sl.manual_override,
    sl.township_id,
    sl.overlap_m,
    lead(sl.overlap_m) OVER (
      PARTITION BY sl.id
      ORDER BY sl.overlap_m DESC NULLS LAST, sl.township_id ASC
    ) AS second_m,
    lead(sl.township_id) OVER (
      PARTITION BY sl.id
      ORDER BY sl.overlap_m DESC NULLS LAST, sl.township_id ASC
    ) AS second_id,
    row_number() OVER (
      PARTITION BY sl.id
      ORDER BY sl.overlap_m DESC NULLS LAST, sl.township_id ASC
    ) AS rn
  FROM street_lengths sl
  WHERE sl.overlap_m > 0
) x
WHERE rn = 1;
CREATE UNIQUE INDEX ON street_best (id);
ANALYZE street_best;

\echo '=== 4) Classify actions ==='
CREATE TEMP TABLE street_live_class AS
SELECT
  c.id,
  c.old_admin_area_id,
  c.old_updated_at,
  c.manual_override,
  b.township_id AS raw_best_id,
  b.overlap_m,
  b.second_m,
  b.second_id,
  CASE
    WHEN b.township_id IS NULL THEN NULL
    WHEN b.second_m IS NOT NULL AND abs(b.overlap_m - b.second_m) <= 1.0 THEN NULL
    ELSE b.township_id
  END AS clear_best_id,
  CASE
    WHEN b.township_id IS NOT NULL
     AND b.second_m IS NOT NULL
     AND abs(b.overlap_m - b.second_m) <= 1.0 THEN 'AMBIGUOUS'
    WHEN b.township_id IS NULL THEN 'NO_MATCH'
    WHEN b.township_id IS NOT DISTINCT FROM c.old_admin_area_id THEN 'KEEP_VALID'
    ELSE 'HAS_CLEAR_BEST'
  END AS spatial_status,
  EXISTS (SELECT 1 FROM ops_township o WHERE o.id = c.old_admin_area_id) AS old_is_operational
FROM street_candidates c
LEFT JOIN street_best b ON b.id = c.id;

CREATE TEMP TABLE street_actions AS
SELECT
  l.*,
  CASE
    WHEN l.clear_best_id IS NOT NULL
     AND l.clear_best_id IS DISTINCT FROM l.old_admin_area_id
     AND (NOT l.manual_override OR NOT l.old_is_operational OR l.old_admin_area_id IS NULL)
    THEN 'REASSIGN_SAFE'
    WHEN l.old_admin_area_id IS NOT NULL
     AND NOT l.old_is_operational
    THEN 'NULL_CLEAR_NON_OPERATIONAL'
    WHEN l.manual_override
     AND l.old_is_operational
     AND (l.clear_best_id IS DISTINCT FROM l.old_admin_area_id)
    THEN 'MANUAL_PROTECTED_REVIEW'
    WHEN l.spatial_status = 'KEEP_VALID' THEN 'KEEP_VALID'
    WHEN l.spatial_status = 'AMBIGUOUS' THEN 'AMBIGUOUS'
    WHEN l.spatial_status = 'NO_MATCH' THEN 'NO_MATCH'
    ELSE 'KEEP_VALID'
  END AS action,
  CASE
    WHEN l.clear_best_id IS NOT NULL
     AND l.clear_best_id IS DISTINCT FROM l.old_admin_area_id
     AND (NOT l.manual_override OR NOT l.old_is_operational OR l.old_admin_area_id IS NULL)
    THEN l.clear_best_id
    WHEN l.old_admin_area_id IS NOT NULL AND NOT l.old_is_operational
    THEN NULL
    ELSE l.old_admin_area_id
  END AS proposed_admin_area_id,
  CASE
    WHEN l.clear_best_id IS NOT NULL
     AND l.clear_best_id IS DISTINCT FROM l.old_admin_area_id
     AND NOT l.manual_override
      THEN 'reassign_greatest_length'
    WHEN l.clear_best_id IS NOT NULL
     AND l.clear_best_id IS DISTINCT FROM l.old_admin_area_id
     AND l.manual_override
     AND (NOT l.old_is_operational OR l.old_admin_area_id IS NULL)
      THEN 'manual_non_operational_reassign_greatest_length'
    WHEN l.old_admin_area_id IS NOT NULL AND NOT l.old_is_operational
      THEN 'clear_non_operational_admin'
    WHEN l.manual_override AND l.old_is_operational
     AND l.clear_best_id IS DISTINCT FROM l.old_admin_area_id
      THEN 'manual_override_conflicts_with_geometry_rule'
    WHEN l.spatial_status = 'AMBIGUOUS' THEN 'top_two_intersect_lengths_within_1_m'
    WHEN l.spatial_status = 'NO_MATCH' THEN 'no_positive_length_intersection'
    WHEN l.spatial_status = 'KEEP_VALID' THEN 'current_assignment_matches_max_intersect_length'
    ELSE 'other'
  END AS reason
FROM street_live_class l;

SELECT 'actions' AS k, action, count(*)::bigint AS n FROM street_actions GROUP BY 2
UNION ALL
SELECT 'keep_fast', 'KEEP_VALID_FAST', count(*) FROM street_keep_fast
ORDER BY 2;

CREATE TEMP TABLE street_update_queue AS
SELECT
  a.id,
  a.old_admin_area_id,
  a.proposed_admin_area_id,
  a.manual_override,
  a.old_updated_at,
  a.reason,
  a.action,
  a.overlap_m,
  a.second_m,
  row_number() OVER (ORDER BY a.id) AS rn
FROM street_actions a
WHERE a.action IN ('REASSIGN_SAFE', 'NULL_CLEAR_NON_OPERATIONAL')
  AND a.proposed_admin_area_id IS DISTINCT FROM a.old_admin_area_id;
CREATE UNIQUE INDEX ON street_update_queue (id);
ANALYZE street_update_queue;

SELECT action, count(*)::int AS n FROM street_update_queue GROUP BY 1 ORDER BY 1;
SELECT count(*)::int AS total_updates FROM street_update_queue;

\echo '=== 5) Backup ==='
CREATE TEMP TABLE street_backup_export AS
SELECT
  id AS street_id,
  old_admin_area_id,
  proposed_admin_area_id,
  manual_override,
  old_updated_at AS updated_at,
  reason
FROM street_update_queue
ORDER BY id;
\copy street_backup_export TO '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/backups/street-admin-before.csv' WITH CSV HEADER
\copy street_update_queue TO '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/sql/street_update_queue.csv' WITH CSV HEADER

CREATE TABLE IF NOT EXISTS system.repair_admin_assign_streets_20260724 (
  entity_id bigint PRIMARY KEY,
  old_admin_area_id bigint,
  new_admin_area_id bigint,
  overlap_m double precision,
  second_m double precision,
  action text NOT NULL,
  reason text,
  old_updated_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
TRUNCATE system.repair_admin_assign_streets_20260724;
INSERT INTO system.repair_admin_assign_streets_20260724 (
  entity_id, old_admin_area_id, new_admin_area_id, overlap_m, second_m, action, reason, old_updated_at
)
SELECT id, old_admin_area_id, proposed_admin_area_id, overlap_m, second_m, action, reason, old_updated_at
FROM street_update_queue;

DO $$
DECLARE n_bad int; n_tie int; n_manual_bad int;
BEGIN
  SELECT count(*) INTO n_bad FROM street_update_queue q
  WHERE q.proposed_admin_area_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = q.proposed_admin_area_id);
  IF n_bad > 0 THEN RAISE EXCEPTION '% non-operational proposed ids', n_bad; END IF;

  SELECT count(*) INTO n_tie FROM street_update_queue q
  WHERE q.action = 'REASSIGN_SAFE'
    AND (q.overlap_m IS NULL OR q.overlap_m <= 0
         OR (q.second_m IS NOT NULL AND abs(q.overlap_m - q.second_m) <= 1.0));
  IF n_tie > 0 THEN RAISE EXCEPTION '% tied/invalid REASSIGN rows', n_tie; END IF;

  SELECT count(*) INTO n_manual_bad FROM street_update_queue q
  WHERE q.manual_override AND q.action = 'REASSIGN_SAFE'
    AND EXISTS (SELECT 1 FROM ops_township o WHERE o.id = q.old_admin_area_id);
  IF n_manual_bad > 0 THEN RAISE EXCEPTION '% improper manual operational reassigns', n_manual_bad; END IF;
END $$;

\echo '=== PREP COMPLETE ==='

-- Batch template uses per-batch CSV under tmp/admin-assignment-repair/sql/street_batch_*.csv
-- Post:

\set ON_ERROR_STOP on
\timing on
SET statement_timeout = 0;
SET work_mem = '1GB';
SET jit = off;

CREATE TEMP TABLE ops_township AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.is_active IS TRUE AND aa.deleted_at IS NULL AND aa.geom IS NOT NULL
  AND st_isvalid(aa.geom)
  AND core.admin_area_is_operational_township(aa.id, al.code);
CREATE INDEX ON ops_township USING gist (geom);
CREATE UNIQUE INDEX ON ops_township (id);
ANALYZE ops_township;

\echo '=== Post: non-operational refs ==='
SELECT count(*)::bigint AS non_operational_refs
FROM core.core_streets s
WHERE s.deleted_at IS NULL AND coalesce(s.is_active, true)
  AND s.admin_area_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = s.admin_area_id);

\echo '=== Post: null / totals ==='
SELECT
  count(*)::bigint AS active,
  count(*) FILTER (WHERE admin_area_id IS NULL)::bigint AS null_admin,
  count(*) FILTER (WHERE coalesce(manual_override,false))::bigint AS manual_rows
FROM core.core_streets
WHERE deleted_at IS NULL AND coalesce(is_active, true);

\echo '=== Post: candidate mismatch scan (non keep-fast path) ==='
CREATE TEMP TABLE street_active AS
SELECT s.id, s.admin_area_id, s.geom, coalesce(s.manual_override,false) AS manual_override
FROM core.core_streets s
WHERE s.deleted_at IS NULL AND coalesce(s.is_active,true)
  AND s.geom IS NOT NULL AND st_isvalid(s.geom) AND NOT st_isempty(s.geom);
CREATE INDEX ON street_active USING gist (geom);
ANALYZE street_active;

CREATE TEMP TABLE street_op_touch AS
SELECT s.id, count(*)::int AS op_touch_count, min(o.id) AS only_op_id,
       bool_or(s.admin_area_id IS NOT NULL AND o.id = s.admin_area_id) AS touches_current_op
FROM street_active s
JOIN ops_township o ON o.geom && s.geom AND st_intersects(o.geom, s.geom)
GROUP BY s.id;

CREATE TEMP TABLE need_check AS
SELECT s.*
FROM street_active s
WHERE NOT EXISTS (
  SELECT 1 FROM street_op_touch t
  WHERE t.id = s.id AND t.op_touch_count = 1 AND t.touches_current_op AND s.admin_area_id = t.only_op_id
);
CREATE INDEX ON need_check USING gist (geom);
ANALYZE need_check;

CREATE TEMP TABLE check_best AS
SELECT * FROM (
  SELECT
    c.id,
    c.admin_area_id,
    c.manual_override,
    o.id AS township_id,
    st_length(st_intersection(o.geom, c.geom)::geography) AS overlap_m,
    lead(st_length(st_intersection(o.geom, c.geom)::geography)) OVER (
      PARTITION BY c.id ORDER BY st_length(st_intersection(o.geom, c.geom)::geography) DESC NULLS LAST, o.id
    ) AS second_m,
    row_number() OVER (
      PARTITION BY c.id ORDER BY st_length(st_intersection(o.geom, c.geom)::geography) DESC NULLS LAST, o.id
    ) AS rn
  FROM need_check c
  JOIN ops_township o ON o.geom && c.geom AND st_intersects(o.geom, c.geom)
) x WHERE rn = 1 AND overlap_m > 0;

CREATE TEMP TABLE post_status AS
SELECT
  c.id,
  c.admin_area_id,
  c.manual_override,
  b.township_id AS best_id,
  b.second_m,
  CASE
    WHEN c.admin_area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = c.admin_area_id)
      THEN 'NON_OPERATIONAL'
    WHEN b.township_id IS NULL AND c.admin_area_id IS NULL THEN 'NO_MATCH'
    WHEN b.township_id IS NOT NULL AND b.second_m IS NOT NULL AND abs(b.overlap_m - b.second_m) <= 1.0 AND c.admin_area_id IS NULL
      THEN 'AMBIGUOUS'
    WHEN b.township_id IS NOT NULL AND b.second_m IS NOT NULL AND abs(b.overlap_m - b.second_m) <= 1.0
         AND c.admin_area_id IS NOT NULL
      THEN CASE WHEN c.manual_override THEN 'MANUAL_PROTECTED_REVIEW' ELSE 'AMBIGUOUS_WITH_ASSIGNMENT' END
    WHEN b.township_id IS NOT NULL
         AND (b.second_m IS NULL OR abs(b.overlap_m - b.second_m) > 1.0)
         AND c.admin_area_id IS DISTINCT FROM b.township_id
         AND NOT c.manual_override
      THEN 'MISMATCH_NON_MANUAL'
    WHEN b.township_id IS NOT NULL
         AND (b.second_m IS NULL OR abs(b.overlap_m - b.second_m) > 1.0)
         AND c.admin_area_id IS DISTINCT FROM b.township_id
         AND c.manual_override
      THEN 'MANUAL_PROTECTED_REVIEW'
    WHEN b.township_id IS NULL AND c.admin_area_id IS NOT NULL AND c.manual_override
      THEN 'MANUAL_PROTECTED_REVIEW'
    ELSE 'OK_OR_KEEP'
  END AS status
FROM need_check c
LEFT JOIN check_best b ON b.id = c.id;

SELECT status, count(*)::bigint AS n FROM post_status GROUP BY 1 ORDER BY 1;

SELECT
  (SELECT count(*) FROM street_active) AS active,
  (SELECT count(*) FROM street_active WHERE admin_area_id IS NULL) AS null_admin,
  (SELECT count(*) FROM post_status WHERE status = 'NON_OPERATIONAL') AS non_operational,
  (SELECT count(*) FROM post_status WHERE status = 'MISMATCH_NON_MANUAL') AS mismatch_non_manual,
  (SELECT count(*) FROM post_status WHERE status = 'NO_MATCH') AS no_match,
  (SELECT count(*) FROM post_status WHERE status = 'AMBIGUOUS') AS ambiguous,
  (SELECT count(*) FROM post_status WHERE status = 'MANUAL_PROTECTED_REVIEW') AS manual_protected,
  (SELECT count(*) FROM street_op_touch t JOIN street_active s ON s.id=t.id
     WHERE t.op_touch_count=1 AND t.touches_current_op AND s.admin_area_id=t.only_op_id) AS keep_valid_fast;

DO $$
DECLARE n_nonop int; n_mis int;
BEGIN
  SELECT count(*) INTO n_nonop FROM post_status WHERE status = 'NON_OPERATIONAL';
  SELECT count(*) INTO n_mis FROM post_status WHERE status = 'MISMATCH_NON_MANUAL';
  -- also count any active non-op not in need_check (should be 0)
  SELECT n_nonop + (
    SELECT count(*) FROM core.core_streets s
    WHERE s.deleted_at IS NULL AND coalesce(s.is_active,true)
      AND s.admin_area_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM core.core_admin_areas aa
        JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
        WHERE aa.id = s.admin_area_id AND aa.is_active AND aa.deleted_at IS NULL
          AND core.admin_area_is_operational_township(aa.id, al.code)
      )
  ) INTO n_nonop;

  -- simpler hard check
  SELECT count(*) INTO n_nonop
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL AND coalesce(s.is_active,true)
    AND s.admin_area_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.core_admin_areas aa
      JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
      WHERE aa.id = s.admin_area_id AND aa.is_active AND aa.deleted_at IS NULL
        AND core.admin_area_is_operational_township(aa.id, al.code)
    );

  SELECT count(*) INTO n_mis FROM post_status WHERE status = 'MISMATCH_NON_MANUAL';

  IF n_nonop <> 0 THEN
    RAISE EXCEPTION 'TARGET FAIL: % non-operational refs', n_nonop;
  END IF;
  IF n_mis <> 0 THEN
    RAISE EXCEPTION 'TARGET FAIL: % non-manual mismatches', n_mis;
  END IF;
END $$;

SELECT 'other_tables_unchanged_counts' AS k,
  (SELECT count(*) FROM core.core_places) AS places,
  (SELECT count(*) FROM core.core_buildings) AS buildings,
  (SELECT count(*) FROM core.core_land_areas) AS landuse;

\echo '=== POST VERIFY COMPLETE ==='
