-- Remaining repair: one street batch (max 250 pending rows)
-- Township assignment via midpoint + ST_Covers (same policy as find_admin_area_for_*).
-- Own transaction; runner invokes repeatedly until pending = 0.

SET statement_timeout = '15min';
SET work_mem = '256MB';

BEGIN;

CREATE TEMP TABLE _street_batch (
  entity_id bigint PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _street_batch (entity_id)
SELECT q.entity_id
FROM system.repair_remaining_admin_queue_20260722 q
WHERE q.entity_family = 'street'
  AND q.status = 'pending'
ORDER BY q.entity_id
LIMIT 250
FOR UPDATE OF q SKIP LOCKED;

CREATE TEMP TABLE _townships ON COMMIT DROP AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL
  AND aa.is_active IS TRUE
  AND al.code = 'township'
  AND aa.geom IS NOT NULL;
CREATE INDEX ON _townships USING gist (geom);

CREATE TEMP TABLE _street_targets ON COMMIT DROP AS
SELECT
  b.entity_id AS id,
  s.admin_area_id AS old_admin_area_id,
  s.updated_at AS old_updated_at,
  ST_SetSRID(
    ST_LineInterpolatePoint(
      CASE
        WHEN GeometryType(s.geom) IN ('MULTILINESTRING', 'GEOMETRYCOLLECTION')
          THEN ST_GeometryN(ST_CollectionExtract(s.geom, 2), 1)
        ELSE s.geom
      END,
      0.5
    ),
    4326
  ) AS mid_pt
FROM _street_batch b
JOIN core.core_streets s ON s.id = b.entity_id
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false);
CREATE INDEX ON _street_targets USING gist (mid_pt);

CREATE TEMP TABLE _street_pick ON COMMIT DROP AS
SELECT DISTINCT ON (t.id)
  t.id,
  t.old_admin_area_id,
  t.old_updated_at,
  tw.id AS township_id
FROM _street_targets t
JOIN _townships tw ON tw.geom && t.mid_pt AND ST_Covers(tw.geom, t.mid_pt)
WHERE t.mid_pt IS NOT NULL
ORDER BY t.id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_remaining_admin_backup_20260722 (
  entity_family, entity_id, admin_area_id, updated_at
)
SELECT 'street', p.id, p.old_admin_area_id, p.old_updated_at
FROM _street_pick p
WHERE p.township_id IS DISTINCT FROM p.old_admin_area_id
ON CONFLICT (entity_family, entity_id) DO NOTHING;

UPDATE core.core_streets s
SET admin_area_id = p.township_id,
    updated_at = now()
FROM _street_pick p
WHERE s.id = p.id
  AND p.township_id IS DISTINCT FROM s.admin_area_id
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false);

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'resolved',
    new_admin_area_id = p.township_id,
    reason = 'township_covers_midpoint',
    processed_at = now()
FROM _street_pick p
WHERE q.entity_family = 'street'
  AND q.entity_id = p.id
  AND q.status = 'pending';

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'unresolved',
    reason = 'no_township_covers_midpoint',
    processed_at = now()
WHERE q.entity_family = 'street'
  AND q.status = 'pending'
  AND q.entity_id IN (SELECT entity_id FROM _street_batch)
  AND NOT EXISTS (
    SELECT 1 FROM _street_pick p WHERE p.id = q.entity_id
  );

SELECT
  (SELECT count(*) FROM _street_batch) AS batch_size,
  (SELECT count(*) FROM _street_pick) AS resolved_in_batch,
  (SELECT count(*) FROM _street_batch b
   WHERE NOT EXISTS (SELECT 1 FROM _street_pick p WHERE p.id = b.entity_id)) AS unresolved_in_batch;

COMMIT;
