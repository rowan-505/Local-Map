-- Prompt 4 — Apply township admin_area_id where spatial match is clear
-- Uses core.find_admin_area_for_point / _for_line / _for_polygon

CREATE TABLE IF NOT EXISTS system.repair_admin_links_before_202607 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  admin_area_id bigint,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id)
);

-- ========== PLACES ==========
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'places', p.id, p.admin_area_id, p.updated_at
FROM core.core_places p
WHERE p.deleted_at IS NULL
  AND p.admin_area_id IS NULL
  AND p.point_geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE core.core_places p
SET admin_area_id = x.township_id,
    updated_at = now()
FROM (
  SELECT p2.id, core.find_admin_area_for_point(p2.point_geom, 'township') AS township_id
  FROM core.core_places p2
  WHERE p2.deleted_at IS NULL
    AND p2.admin_area_id IS NULL
    AND p2.point_geom IS NOT NULL
) x
WHERE p.id = x.id
  AND x.township_id IS NOT NULL;
COMMIT;

-- ========== BUILDINGS ==========
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'buildings', b.id, b.admin_area_id, b.updated_at
FROM core.core_buildings b
WHERE b.deleted_at IS NULL AND b.admin_area_id IS NULL AND b.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE core.core_buildings b
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT b2.id, core.find_admin_area_for_polygon(b2.geom, 'township') AS township_id
  FROM core.core_buildings b2
  WHERE b2.deleted_at IS NULL AND b2.admin_area_id IS NULL AND b2.geom IS NOT NULL
) x
WHERE b.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

-- ========== LANDUSE ==========
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'landuse', l.id, l.admin_area_id, l.updated_at
FROM core.core_land_areas l
WHERE l.deleted_at IS NULL AND l.admin_area_id IS NULL AND l.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE core.core_land_areas l
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT l2.id, core.find_admin_area_for_polygon(l2.geom, 'township') AS township_id
  FROM core.core_land_areas l2
  WHERE l2.deleted_at IS NULL AND l2.admin_area_id IS NULL AND l2.geom IS NOT NULL
) x
WHERE l.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

-- ========== STREETS: work queue, 5000/batch ==========
CREATE TEMP TABLE IF NOT EXISTS _street_admin_todo AS
SELECT s.id
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
    SELECT id FROM _street_admin_todo ORDER BY id LIMIT 5000;

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch = 0;

    INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
    SELECT 'streets', s.id, s.admin_area_id, s.updated_at
    FROM core.core_streets s
    JOIN _street_batch b ON b.id = s.id
    ON CONFLICT DO NOTHING;

    UPDATE core.core_streets s
    SET admin_area_id = core.find_admin_area_for_line(s.geom, 'township'),
        updated_at = now()
    FROM _street_batch b
    WHERE s.id = b.id
      AND core.find_admin_area_for_line(s.geom, 'township') IS NOT NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    DELETE FROM _street_admin_todo t USING _street_batch b WHERE t.id = b.id;
    DROP TABLE _street_batch;

    RAISE NOTICE 'streets round=% batch=% updated=% remaining=%',
      v_rounds, v_batch, v_updated, (SELECT count(*) FROM _street_admin_todo);

    -- safety cap
    EXIT WHEN v_rounds >= 50;
  END LOOP;
END $$;

-- ========== STOPS ==========
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

-- ========== TERMINALS ==========
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

-- ========== INFRASTRUCTURE LINES ==========
BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'infrastructure_lines', i.id, i.admin_area_id, i.updated_at
FROM transport.infrastructure_lines i
WHERE i.deleted_at IS NULL AND i.admin_area_id IS NULL AND i.geom IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE transport.infrastructure_lines i
SET admin_area_id = x.township_id, updated_at = now()
FROM (
  SELECT i2.id, core.find_admin_area_for_line(i2.geom, 'township') AS township_id
  FROM transport.infrastructure_lines i2
  WHERE i2.deleted_at IS NULL AND i2.admin_area_id IS NULL AND i2.geom IS NOT NULL
) x
WHERE i.id = x.id AND x.township_id IS NOT NULL;
COMMIT;

SELECT entity_family, count(*) AS backed_up_rows
FROM system.repair_admin_links_before_202607
GROUP BY 1
ORDER BY 1;
