-- AUTO-GENERATED apply body from apply-place-building-landuse.sh (2026-07-24T08:05:26Z)
-- Driven by plan CSVs under tmp/admin-assignment-repair/
-- Does NOT modify core.core_streets
-- One transaction per table; validation failures ROLLBACK that table only if exception before COMMIT

\set ON_ERROR_STOP on
\timing on

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

CREATE TEMP TABLE plan_places (
  entity_id bigint PRIMARY KEY,
  plan_old_admin_area_id bigint,
  plan_new_admin_area_id bigint NOT NULL
);
CREATE TEMP TABLE plan_buildings (
  entity_id bigint PRIMARY KEY,
  plan_old_admin_area_id bigint,
  plan_new_admin_area_id bigint NOT NULL
);
CREATE TEMP TABLE plan_landuse (
  entity_id bigint PRIMARY KEY,
  plan_old_admin_area_id bigint,
  plan_new_admin_area_id bigint NOT NULL
);

\copy plan_places FROM '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/sql/plan_places_reassign.csv' WITH (FORMAT csv, HEADER true, NULL '')
\copy plan_buildings FROM '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/sql/plan_buildings_reassign.csv' WITH (FORMAT csv, HEADER true, NULL '')
\copy plan_landuse FROM '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/sql/plan_landuse_reassign.csv' WITH (FORMAT csv, HEADER true, NULL '')

SELECT 'plan_counts' AS k,
  (SELECT count(*) FROM plan_places) AS places,
  (SELECT count(*) FROM plan_buildings) AS buildings,
  (SELECT count(*) FROM plan_landuse) AS landuse;

DO $$
BEGIN
  IF (SELECT count(*) FROM plan_places) <> 1713 THEN
    RAISE EXCEPTION 'places plan count % != 1713', (SELECT count(*) FROM plan_places);
  END IF;
  IF (SELECT count(*) FROM plan_buildings) <> 1121 THEN
    RAISE EXCEPTION 'buildings plan count % != 1121', (SELECT count(*) FROM plan_buildings);
  END IF;
  IF (SELECT count(*) FROM plan_landuse) <> 19 THEN
    RAISE EXCEPTION 'landuse plan count % != 19', (SELECT count(*) FROM plan_landuse);
  END IF;
END $$;

-- =========================================================================
-- LIVE RE-READ + RECALCULATE
-- =========================================================================
\echo '=== 1) Places live verify + recalculate ==='

CREATE TEMP TABLE places_apply AS
WITH live AS (
  SELECT
    pl.entity_id,
    pl.plan_old_admin_area_id,
    pl.plan_new_admin_area_id,
    p.admin_area_id AS live_admin_area_id,
    p.updated_at AS live_updated_at,
    p.point_geom,
    false AS manual_override
  FROM plan_places pl
  JOIN core.core_places p ON p.id = pl.entity_id
  WHERE p.deleted_at IS NULL
),
recalc AS (
  SELECT
    l.*,
    (
      SELECT count(*)::int
      FROM ops_township o
      WHERE o.geom && l.point_geom
        AND st_covers(o.geom, l.point_geom)
    ) AS match_count,
    (
      SELECT o.id
      FROM ops_township o
      WHERE o.geom && l.point_geom
        AND st_covers(o.geom, l.point_geom)
      ORDER BY o.id
      LIMIT 1
    ) AS recalc_proposed
  FROM live l
  WHERE l.point_geom IS NOT NULL
    AND NOT st_isempty(l.point_geom)
    AND st_isvalid(l.point_geom)
)
SELECT
  entity_id,
  'core.core_places'::text AS table_name,
  live_admin_area_id AS old_admin_area_id,
  recalc_proposed AS proposed_admin_area_id,
  live_updated_at,
  manual_override,
  plan_old_admin_area_id,
  plan_new_admin_area_id,
  match_count
FROM recalc;

DO $$
DECLARE
  n_missing int;
  n_drift int;
  n_recalc_mismatch int;
  n_bad_prop int;
  n_bad_cover int;
  n_rows int;
BEGIN
  SELECT count(*) INTO n_rows FROM places_apply;
  IF n_rows <> 1713 THEN
    RAISE EXCEPTION 'places_apply rows % != 1713 (missing live joins?)', n_rows;
  END IF;

  SELECT count(*) INTO n_drift
  FROM places_apply
  WHERE old_admin_area_id IS DISTINCT FROM plan_old_admin_area_id;
  IF n_drift > 0 THEN
    RAISE EXCEPTION 'places: % rows drifted from plan old admin_area_id', n_drift;
  END IF;

  SELECT count(*) INTO n_recalc_mismatch
  FROM places_apply
  WHERE proposed_admin_area_id IS DISTINCT FROM plan_new_admin_area_id
     OR match_count <> 1
     OR proposed_admin_area_id IS NULL;
  IF n_recalc_mismatch > 0 THEN
    RAISE EXCEPTION 'places: % rows failed recalc vs plan / unique cover', n_recalc_mismatch;
  END IF;

  SELECT count(*) INTO n_bad_prop
  FROM places_apply a
  WHERE NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = a.proposed_admin_area_id);
  IF n_bad_prop > 0 THEN
    RAISE EXCEPTION 'places: % proposed ids not operational', n_bad_prop;
  END IF;

  SELECT count(*) INTO n_bad_cover
  FROM places_apply a
  JOIN core.core_places p ON p.id = a.entity_id
  JOIN ops_township o ON o.id = a.proposed_admin_area_id
  WHERE NOT st_covers(o.geom, p.point_geom);
  IF n_bad_cover > 0 THEN
    RAISE EXCEPTION 'places: % proposed townships do not cover point_geom', n_bad_cover;
  END IF;
END $$;

\echo '=== 2) Buildings live verify + recalculate ==='

CREATE TEMP TABLE buildings_apply AS
WITH live AS (
  SELECT
    pl.entity_id,
    pl.plan_old_admin_area_id,
    pl.plan_new_admin_area_id,
    b.admin_area_id AS live_admin_area_id,
    b.updated_at AS live_updated_at,
    CASE
      WHEN b.geom IS NULL OR st_isempty(b.geom) OR NOT st_isvalid(b.geom) THEN NULL
      ELSE st_pointonsurface(b.geom)::geometry(Point, 4326)
    END AS lookup_pt,
    false AS manual_override
  FROM plan_buildings pl
  JOIN core.core_buildings b ON b.id = pl.entity_id
  WHERE b.deleted_at IS NULL
    AND coalesce(b.is_active, true)
),
recalc AS (
  SELECT
    l.*,
    (
      SELECT count(*)::int
      FROM ops_township o
      WHERE o.geom && l.lookup_pt
        AND st_covers(o.geom, l.lookup_pt)
    ) AS match_count,
    (
      SELECT o.id
      FROM ops_township o
      WHERE o.geom && l.lookup_pt
        AND st_covers(o.geom, l.lookup_pt)
      ORDER BY o.id
      LIMIT 1
    ) AS recalc_proposed
  FROM live l
  WHERE l.lookup_pt IS NOT NULL
)
SELECT
  entity_id,
  'core.core_buildings'::text AS table_name,
  live_admin_area_id AS old_admin_area_id,
  recalc_proposed AS proposed_admin_area_id,
  live_updated_at,
  manual_override,
  plan_old_admin_area_id,
  plan_new_admin_area_id,
  match_count
FROM recalc;

DO $$
DECLARE
  n_rows int;
  n_drift int;
  n_recalc_mismatch int;
  n_bad_prop int;
  n_bad_cover int;
BEGIN
  SELECT count(*) INTO n_rows FROM buildings_apply;
  IF n_rows <> 1121 THEN
    RAISE EXCEPTION 'buildings_apply rows % != 1121', n_rows;
  END IF;

  SELECT count(*) INTO n_drift
  FROM buildings_apply
  WHERE old_admin_area_id IS DISTINCT FROM plan_old_admin_area_id;
  IF n_drift > 0 THEN
    RAISE EXCEPTION 'buildings: % rows drifted from plan old admin_area_id', n_drift;
  END IF;

  SELECT count(*) INTO n_recalc_mismatch
  FROM buildings_apply
  WHERE proposed_admin_area_id IS DISTINCT FROM plan_new_admin_area_id
     OR match_count <> 1
     OR proposed_admin_area_id IS NULL;
  IF n_recalc_mismatch > 0 THEN
    RAISE EXCEPTION 'buildings: % rows failed recalc vs plan / unique cover', n_recalc_mismatch;
  END IF;

  SELECT count(*) INTO n_bad_prop
  FROM buildings_apply a
  WHERE NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = a.proposed_admin_area_id);
  IF n_bad_prop > 0 THEN
    RAISE EXCEPTION 'buildings: % proposed ids not operational', n_bad_prop;
  END IF;

  SELECT count(*) INTO n_bad_cover
  FROM buildings_apply a
  JOIN core.core_buildings b ON b.id = a.entity_id
  JOIN ops_township o ON o.id = a.proposed_admin_area_id
  WHERE NOT st_covers(o.geom, st_pointonsurface(b.geom));
  IF n_bad_cover > 0 THEN
    RAISE EXCEPTION 'buildings: % proposed townships do not cover pointonsurface', n_bad_cover;
  END IF;
END $$;

\echo '=== 3) Landuse live verify + recalculate ==='

CREATE TEMP TABLE landuse_apply AS
WITH live AS (
  SELECT
    pl.entity_id,
    pl.plan_old_admin_area_id,
    pl.plan_new_admin_area_id,
    l.admin_area_id AS live_admin_area_id,
    l.updated_at AS live_updated_at,
    l.geom,
    coalesce(l.manual_override, false) AS manual_override
  FROM plan_landuse pl
  JOIN core.core_land_areas l ON l.id = pl.entity_id
  WHERE l.deleted_at IS NULL
    AND coalesce(l.is_active, true)
),
ranked AS (
  SELECT
    v.entity_id,
    v.plan_old_admin_area_id,
    v.plan_new_admin_area_id,
    v.live_admin_area_id,
    v.live_updated_at,
    v.manual_override,
    o.id AS township_id,
    st_area(st_intersection(o.geom, v.geom)::geography) AS overlap_m2,
    row_number() OVER (
      PARTITION BY v.entity_id
      ORDER BY st_area(st_intersection(o.geom, v.geom)::geography) DESC NULLS LAST, o.id ASC
    ) AS rn,
    lead(st_area(st_intersection(o.geom, v.geom)::geography)) OVER (
      PARTITION BY v.entity_id
      ORDER BY st_area(st_intersection(o.geom, v.geom)::geography) DESC NULLS LAST, o.id ASC
    ) AS second_m2
  FROM live v
  JOIN ops_township o
    ON o.geom && v.geom
   AND st_intersects(o.geom, v.geom)
  WHERE v.geom IS NOT NULL
    AND NOT st_isempty(v.geom)
    AND st_isvalid(v.geom)
),
best AS (
  SELECT *
  FROM ranked
  WHERE rn = 1
    AND overlap_m2 > 0
    AND (second_m2 IS NULL OR abs(overlap_m2 - second_m2) > 1.0)
)
SELECT
  b.entity_id,
  'core.core_land_areas'::text AS table_name,
  b.live_admin_area_id AS old_admin_area_id,
  best.township_id AS proposed_admin_area_id,
  b.live_updated_at,
  b.manual_override,
  b.plan_old_admin_area_id,
  b.plan_new_admin_area_id,
  best.overlap_m2,
  best.second_m2
FROM live b
JOIN best ON best.entity_id = b.entity_id;

DO $$
DECLARE
  n_rows int;
  n_drift int;
  n_recalc_mismatch int;
  n_manual int;
  n_bad_prop int;
  n_not_greatest int;
BEGIN
  SELECT count(*) INTO n_rows FROM landuse_apply;
  IF n_rows <> 19 THEN
    RAISE EXCEPTION 'landuse_apply rows % != 19', n_rows;
  END IF;

  SELECT count(*) INTO n_drift
  FROM landuse_apply
  WHERE old_admin_area_id IS DISTINCT FROM plan_old_admin_area_id;
  IF n_drift > 0 THEN
    RAISE EXCEPTION 'landuse: % rows drifted from plan old admin_area_id', n_drift;
  END IF;

  SELECT count(*) INTO n_recalc_mismatch
  FROM landuse_apply
  WHERE proposed_admin_area_id IS DISTINCT FROM plan_new_admin_area_id
     OR proposed_admin_area_id IS NULL;
  IF n_recalc_mismatch > 0 THEN
    RAISE EXCEPTION 'landuse: % rows failed recalc vs plan', n_recalc_mismatch;
  END IF;

  SELECT count(*) INTO n_manual
  FROM landuse_apply
  WHERE manual_override
    AND old_admin_area_id IS NOT NULL
    AND proposed_admin_area_id IS DISTINCT FROM old_admin_area_id;
  IF n_manual > 0 THEN
    RAISE EXCEPTION 'landuse: % manual-protected conflicts in apply set', n_manual;
  END IF;

  SELECT count(*) INTO n_bad_prop
  FROM landuse_apply a
  WHERE NOT EXISTS (SELECT 1 FROM ops_township o WHERE o.id = a.proposed_admin_area_id);
  IF n_bad_prop > 0 THEN
    RAISE EXCEPTION 'landuse: % proposed ids not operational', n_bad_prop;
  END IF;

  -- greatest-area ownership check
  SELECT count(*) INTO n_not_greatest
  FROM landuse_apply a
  JOIN core.core_land_areas l ON l.id = a.entity_id
  WHERE EXISTS (
    SELECT 1
    FROM ops_township o
    WHERE o.id <> a.proposed_admin_area_id
      AND o.geom && l.geom
      AND st_intersects(o.geom, l.geom)
      AND st_area(st_intersection(o.geom, l.geom)::geography)
          > st_area(st_intersection(
              (SELECT g.geom FROM ops_township g WHERE g.id = a.proposed_admin_area_id),
              l.geom
            )::geography) + 1.0
  );
  IF n_not_greatest > 0 THEN
    RAISE EXCEPTION 'landuse: % rows do not have greatest-area ownership', n_not_greatest;
  END IF;
END $$;

\echo '=== 4) Export backup CSV ==='
CREATE TEMP TABLE backup_export AS
SELECT table_name, entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at AS updated_at, manual_override
FROM (
  SELECT table_name, entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at, manual_override FROM places_apply
  UNION ALL
  SELECT table_name, entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at, manual_override FROM buildings_apply
  UNION ALL
  SELECT table_name, entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at, manual_override FROM landuse_apply
) u
ORDER BY table_name, entity_id;

\copy backup_export TO '/Users/nyihtet/Documents/Projects/Core-Map/tmp/admin-assignment-repair/backups/place-building-landuse-admin-before.csv' WITH CSV HEADER

SELECT 'backup_rows' AS k, count(*)::int AS n FROM backup_export;

-- DB slim backup (durable across session)
CREATE TABLE IF NOT EXISTS system.repair_admin_assign_pbl_20260724 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  old_admin_area_id bigint,
  new_admin_area_id bigint NOT NULL,
  old_updated_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id)
);

TRUNCATE system.repair_admin_assign_pbl_20260724;

INSERT INTO system.repair_admin_assign_pbl_20260724 (
  entity_family, entity_id, old_admin_area_id, new_admin_area_id, old_updated_at
)
SELECT 'places', entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at FROM places_apply
UNION ALL
SELECT 'buildings', entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at FROM buildings_apply
UNION ALL
SELECT 'landuse', entity_id, old_admin_area_id, proposed_admin_area_id, live_updated_at FROM landuse_apply;

-- =========================================================================
-- APPLY: places (one transaction)
-- =========================================================================
\echo '=== 5) APPLY places ==='
BEGIN;
SET LOCAL lock_timeout = '30s';

UPDATE core.core_places p
SET admin_area_id = a.proposed_admin_area_id,
    updated_at = now()
FROM places_apply a
WHERE p.id = a.entity_id
  AND p.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id
  AND p.admin_area_id IS NOT DISTINCT FROM a.old_admin_area_id;

DO $$
DECLARE
  n_updated int;
  n_bad int;
BEGIN
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  -- ROW_COUNT from UPDATE is not available after DO; recount instead
  SELECT count(*) INTO n_updated
  FROM core.core_places p
  JOIN places_apply a ON a.entity_id = p.id
  WHERE p.admin_area_id = a.proposed_admin_area_id;

  IF n_updated <> 1713 THEN
    RAISE EXCEPTION 'places post-update matched % != 1713', n_updated;
  END IF;

  SELECT count(*) INTO n_bad
  FROM places_apply a
  JOIN core.core_places p ON p.id = a.entity_id
  WHERE p.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'places: % rows not updated to proposed', n_bad;
  END IF;

  -- no manual-protected concept; ensure no KEEP outside apply set unchanged is fine
END $$;

-- validate covers after update
DO $$
DECLARE n_bad int;
BEGIN
  SELECT count(*) INTO n_bad
  FROM places_apply a
  JOIN core.core_places p ON p.id = a.entity_id
  JOIN ops_township o ON o.id = p.admin_area_id
  WHERE NOT st_covers(o.geom, p.point_geom);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'places commit blocked: % cover failures', n_bad;
  END IF;
END $$;

COMMIT;
\echo 'places COMMITTED'

-- =========================================================================
-- APPLY: buildings
-- =========================================================================
\echo '=== 6) APPLY buildings ==='
BEGIN;
SET LOCAL lock_timeout = '30s';

UPDATE core.core_buildings b
SET admin_area_id = a.proposed_admin_area_id,
    updated_at = now()
FROM buildings_apply a
WHERE b.id = a.entity_id
  AND b.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id
  AND b.admin_area_id IS NOT DISTINCT FROM a.old_admin_area_id;

DO $$
DECLARE n_updated int; n_bad int;
BEGIN
  SELECT count(*) INTO n_updated
  FROM core.core_buildings b
  JOIN buildings_apply a ON a.entity_id = b.id
  WHERE b.admin_area_id = a.proposed_admin_area_id;
  IF n_updated <> 1121 THEN
    RAISE EXCEPTION 'buildings post-update matched % != 1121', n_updated;
  END IF;
  SELECT count(*) INTO n_bad
  FROM buildings_apply a
  JOIN core.core_buildings b ON b.id = a.entity_id
  WHERE b.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'buildings: % rows not updated', n_bad;
  END IF;
END $$;

DO $$
DECLARE n_bad int;
BEGIN
  SELECT count(*) INTO n_bad
  FROM buildings_apply a
  JOIN core.core_buildings b ON b.id = a.entity_id
  JOIN ops_township o ON o.id = b.admin_area_id
  WHERE NOT st_covers(o.geom, st_pointonsurface(b.geom));
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'buildings commit blocked: % cover failures', n_bad;
  END IF;
END $$;

COMMIT;
\echo 'buildings COMMITTED'

-- =========================================================================
-- APPLY: landuse
-- =========================================================================
\echo '=== 7) APPLY landuse ==='
BEGIN;
SET LOCAL lock_timeout = '30s';

UPDATE core.core_land_areas l
SET admin_area_id = a.proposed_admin_area_id,
    updated_at = now()
FROM landuse_apply a
WHERE l.id = a.entity_id
  AND l.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id
  AND l.admin_area_id IS NOT DISTINCT FROM a.old_admin_area_id
  AND coalesce(l.manual_override, false) IS NOT TRUE;

DO $$
DECLARE n_updated int; n_bad int;
BEGIN
  SELECT count(*) INTO n_updated
  FROM core.core_land_areas l
  JOIN landuse_apply a ON a.entity_id = l.id
  WHERE l.admin_area_id = a.proposed_admin_area_id;
  IF n_updated <> 19 THEN
    RAISE EXCEPTION 'landuse post-update matched % != 19', n_updated;
  END IF;
  SELECT count(*) INTO n_bad
  FROM landuse_apply a
  JOIN core.core_land_areas l ON l.id = a.entity_id
  WHERE l.admin_area_id IS DISTINCT FROM a.proposed_admin_area_id;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'landuse: % rows not updated', n_bad;
  END IF;
END $$;

COMMIT;
\echo 'landuse COMMITTED'

-- =========================================================================
-- POST VERIFY
-- =========================================================================
\echo '=== 8) Post-apply full-table verification ==='

CREATE TEMP TABLE post_places AS
WITH base AS (
  SELECT p.id, p.admin_area_id, p.point_geom
  FROM core.core_places p
  WHERE p.deleted_at IS NULL
),
m AS (
  SELECT
    b.*,
    EXISTS (SELECT 1 FROM ops_township o WHERE o.id = b.admin_area_id) AS is_op,
    CASE
      WHEN b.point_geom IS NULL OR st_isempty(b.point_geom) OR NOT st_isvalid(b.point_geom) THEN 0
      ELSE (
        SELECT count(*)::int FROM ops_township o
        WHERE o.geom && b.point_geom AND st_covers(o.geom, b.point_geom)
      )
    END AS match_count,
    CASE
      WHEN b.admin_area_id IS NULL THEN false
      WHEN b.point_geom IS NULL THEN false
      ELSE EXISTS (
        SELECT 1 FROM ops_township o
        WHERE o.id = b.admin_area_id AND st_covers(o.geom, b.point_geom)
      )
    END AS covered_by_current
  FROM base b
)
SELECT * FROM m;

CREATE TEMP TABLE post_buildings AS
WITH base AS (
  SELECT b.id, b.admin_area_id,
    CASE WHEN b.geom IS NULL OR st_isempty(b.geom) OR NOT st_isvalid(b.geom) THEN NULL
         ELSE st_pointonsurface(b.geom)::geometry(Point, 4326) END AS pt
  FROM core.core_buildings b
  WHERE b.deleted_at IS NULL AND coalesce(b.is_active, true)
)
SELECT
  b.*,
  EXISTS (SELECT 1 FROM ops_township o WHERE o.id = b.admin_area_id) AS is_op,
  CASE WHEN b.pt IS NULL THEN 0 ELSE (
    SELECT count(*)::int FROM ops_township o WHERE o.geom && b.pt AND st_covers(o.geom, b.pt)
  ) END AS match_count,
  CASE WHEN b.admin_area_id IS NULL OR b.pt IS NULL THEN false
       ELSE EXISTS (SELECT 1 FROM ops_township o WHERE o.id = b.admin_area_id AND st_covers(o.geom, b.pt))
  END AS covered_by_current
FROM base b;

CREATE TEMP TABLE post_landuse AS
WITH base AS (
  SELECT l.id, l.admin_area_id, l.geom, coalesce(l.manual_override, false) AS manual_override
  FROM core.core_land_areas l
  WHERE l.deleted_at IS NULL AND coalesce(l.is_active, true)
),
best AS (
  SELECT
    b.id,
    (
      SELECT x.township_id FROM (
        SELECT o.id AS township_id,
               st_area(st_intersection(o.geom, b.geom)::geography) AS overlap_m2,
               lead(st_area(st_intersection(o.geom, b.geom)::geography)) OVER (
                 ORDER BY st_area(st_intersection(o.geom, b.geom)::geography) DESC NULLS LAST, o.id
               ) AS second_m2,
               row_number() OVER (
                 ORDER BY st_area(st_intersection(o.geom, b.geom)::geography) DESC NULLS LAST, o.id
               ) AS rn
        FROM ops_township o
        WHERE o.geom && b.geom AND st_intersects(o.geom, b.geom)
      ) x
      WHERE x.rn = 1 AND x.overlap_m2 > 0
        AND (x.second_m2 IS NULL OR abs(x.overlap_m2 - x.second_m2) > 1.0)
    ) AS best_id
  FROM base b
  WHERE b.geom IS NOT NULL AND st_isvalid(b.geom) AND NOT st_isempty(b.geom)
)
SELECT
  b.*,
  EXISTS (SELECT 1 FROM ops_township o WHERE o.id = b.admin_area_id) AS is_op,
  best.best_id,
  (b.admin_area_id IS NOT NULL AND best.best_id IS NOT DISTINCT FROM b.admin_area_id) AS is_greatest
FROM base b
LEFT JOIN best ON best.id = b.id;

SELECT 'places' AS entity,
  count(*)::int AS active,
  count(*) FILTER (WHERE admin_area_id IS NULL)::int AS null_admin,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op)::int AS non_operational,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT covered_by_current)::int AS geom_mismatch,
  count(*) FILTER (WHERE match_count = 0 AND admin_area_id IS NULL)::int AS no_match_null,
  count(*) FILTER (WHERE match_count > 1)::int AS ambiguous_points,
  1713 AS expected_updated
FROM post_places
UNION ALL
SELECT 'buildings',
  count(*)::int,
  count(*) FILTER (WHERE admin_area_id IS NULL)::int,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op)::int,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT covered_by_current)::int,
  count(*) FILTER (WHERE match_count = 0 AND admin_area_id IS NULL)::int,
  count(*) FILTER (WHERE match_count > 1)::int,
  1121
FROM post_buildings
UNION ALL
SELECT 'landuse',
  count(*)::int,
  count(*) FILTER (WHERE admin_area_id IS NULL)::int,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op)::int,
  count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_greatest)::int,
  count(*) FILTER (WHERE best_id IS NULL AND admin_area_id IS NULL)::int,
  0,
  19
FROM post_landuse;

-- hard target checks
DO $$
DECLARE
  p_nonop int; p_mis int;
  b_nonop int; b_mis int;
  l_nonop int; l_mis int;
BEGIN
  SELECT count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op),
         count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT covered_by_current)
  INTO p_nonop, p_mis FROM post_places;
  SELECT count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op),
         count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT covered_by_current)
  INTO b_nonop, b_mis FROM post_buildings;
  SELECT count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_op),
         count(*) FILTER (WHERE admin_area_id IS NOT NULL AND NOT is_greatest)
  INTO l_nonop, l_mis FROM post_landuse;

  IF p_nonop <> 0 OR p_mis <> 0 THEN
    RAISE EXCEPTION 'places target failed: nonop=% mismatch=%', p_nonop, p_mis;
  END IF;
  IF b_nonop <> 0 OR b_mis <> 0 THEN
    RAISE EXCEPTION 'buildings target failed: nonop=% mismatch=%', b_nonop, b_mis;
  END IF;
  IF l_nonop <> 0 OR l_mis <> 0 THEN
    RAISE EXCEPTION 'landuse target failed: nonop=% mismatch=%', l_nonop, l_mis;
  END IF;
END $$;

SELECT 'row_counts_unchanged' AS k,
  (SELECT count(*) FROM core.core_places) AS places_total,
  (SELECT count(*) FROM core.core_buildings) AS buildings_total,
  (SELECT count(*) FROM core.core_land_areas) AS landuse_total;

\echo '=== APPLY COMPLETE ==='
