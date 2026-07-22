-- Prompt 4b — Fast street + transport admin links
-- Streets: use line midpoint + find_admin_area_for_point (avoids slow line-overlap)
-- Raise local timeout for this session only.

SET statement_timeout = '30min';
SET work_mem = '256MB';

-- STREETS via midpoint
CREATE TEMP TABLE _street_admin_todo AS
SELECT s.id,
       ST_LineInterpolatePoint(
         CASE
           WHEN GeometryType(s.geom) = 'MULTILINESTRING'
             THEN ST_GeometryN(s.geom, 1)
           ELSE s.geom
         END,
         0.5
       ) AS mid_pt
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND s.admin_area_id IS NULL
  AND s.geom IS NOT NULL
  AND NOT COALESCE(s.manual_override, false);

DO $$
DECLARE
  v_batch int;
  v_updated int;
  v_rounds int := 0;
BEGIN
  LOOP
    v_rounds := v_rounds + 1;
    CREATE TEMP TABLE _street_batch AS
    SELECT id, mid_pt FROM _street_admin_todo ORDER BY id LIMIT 5000;

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch = 0;

    INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
    SELECT 'streets', s.id, s.admin_area_id, s.updated_at
    FROM core.core_streets s
    JOIN _street_batch b ON b.id = s.id
    ON CONFLICT DO NOTHING;

    UPDATE core.core_streets s
    SET admin_area_id = core.find_admin_area_for_point(b.mid_pt, 'township'),
        updated_at = now()
    FROM _street_batch b
    WHERE s.id = b.id
      AND b.mid_pt IS NOT NULL
      AND core.find_admin_area_for_point(b.mid_pt, 'township') IS NOT NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    DELETE FROM _street_admin_todo t USING _street_batch b WHERE t.id = b.id;
    DROP TABLE _street_batch;
    RAISE NOTICE 'streets_midpoint round=% batch=% updated=% remaining=%',
      v_rounds, v_batch, v_updated, (SELECT count(*) FROM _street_admin_todo);
    EXIT WHEN v_rounds >= 50;
  END LOOP;
END $$;

-- Also reassign streets whose current admin is NOT township (wrong level),
-- only when midpoint clearly resolves to a township. Batched.
CREATE TEMP TABLE _street_wrong_level AS
SELECT s.id,
       ST_LineInterpolatePoint(
         CASE WHEN GeometryType(s.geom) = 'MULTILINESTRING' THEN ST_GeometryN(s.geom, 1) ELSE s.geom END,
         0.5
       ) AS mid_pt
FROM core.core_streets s
JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE s.deleted_at IS NULL
  AND s.admin_area_id IS NOT NULL
  AND al.code <> 'township'
  AND NOT COALESCE(s.manual_override, false)
  AND s.geom IS NOT NULL;

DO $$
DECLARE
  v_batch int;
  v_updated int;
  v_rounds int := 0;
BEGIN
  LOOP
    v_rounds := v_rounds + 1;
    CREATE TEMP TABLE _wl_batch AS
    SELECT id, mid_pt FROM _street_wrong_level ORDER BY id LIMIT 5000;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch = 0;

    INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
    SELECT 'streets', s.id, s.admin_area_id, s.updated_at
    FROM core.core_streets s
    JOIN _wl_batch b ON b.id = s.id
    ON CONFLICT DO NOTHING;

    UPDATE core.core_streets s
    SET admin_area_id = core.find_admin_area_for_point(b.mid_pt, 'township'),
        updated_at = now()
    FROM _wl_batch b
    WHERE s.id = b.id
      AND core.find_admin_area_for_point(b.mid_pt, 'township') IS NOT NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    DELETE FROM _street_wrong_level t USING _wl_batch b WHERE t.id = b.id;
    DROP TABLE _wl_batch;
    RAISE NOTICE 'streets_wrong_level round=% batch=% updated=% remaining=%',
      v_rounds, v_batch, v_updated, (SELECT count(*) FROM _street_wrong_level);
    EXIT WHEN v_rounds >= 50;
  END LOOP;
END $$;

-- STOPS
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'stops', s.id, s.admin_area_id, s.updated_at
FROM transport.stops s
WHERE s.deleted_at IS NULL AND s.admin_area_id IS NULL AND s.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE transport.stops s
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT s2.id, core.find_admin_area_for_point(s2.geom, 'township') AS township_id
  FROM transport.stops s2
  WHERE s2.deleted_at IS NULL AND s2.admin_area_id IS NULL AND s2.geom IS NOT NULL
) x
WHERE s.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

-- TERMINALS
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'terminals', t.id, t.admin_area_id, t.updated_at
FROM transport.terminals t
WHERE t.deleted_at IS NULL AND t.admin_area_id IS NULL AND t.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE transport.terminals t
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT t2.id, core.find_admin_area_for_point(t2.geom, 'township') AS township_id
  FROM transport.terminals t2
  WHERE t2.deleted_at IS NULL AND t2.admin_area_id IS NULL AND t2.geom IS NOT NULL
) x
WHERE t.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

-- INFRA via midpoint point (faster than line overlap)
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'infrastructure_lines', i.id, i.admin_area_id, i.updated_at
FROM transport.infrastructure_lines i
WHERE i.deleted_at IS NULL AND i.admin_area_id IS NULL AND i.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE transport.infrastructure_lines i
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT i2.id,
         core.find_admin_area_for_point(
           ST_LineInterpolatePoint(
             CASE WHEN GeometryType(i2.geom)='MULTILINESTRING' THEN ST_GeometryN(i2.geom,1) ELSE i2.geom END,
             0.5
           ),
           'township'
         ) AS township_id
  FROM transport.infrastructure_lines i2
  WHERE i2.deleted_at IS NULL AND i2.admin_area_id IS NULL AND i2.geom IS NOT NULL
) x
WHERE i.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

SELECT entity_family, count(*) FROM system.repair_admin_links_before_202607 GROUP BY 1 ORDER BY 1;
