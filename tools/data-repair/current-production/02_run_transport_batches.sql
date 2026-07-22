-- Remaining repair: one transport batch (up to 500 pending per family)
-- Families: stop, terminal, infrastructure_line
-- Township assignment via point/midpoint + ST_Covers.

SET statement_timeout = '15min';
SET work_mem = '256MB';

BEGIN;

CREATE TEMP TABLE _townships ON COMMIT DROP AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL
  AND aa.is_active IS TRUE
  AND al.code = 'township'
  AND aa.geom IS NOT NULL;
CREATE INDEX ON _townships USING gist (geom);

-- ----- stops -----
CREATE TEMP TABLE _stop_batch (
  entity_id bigint PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _stop_batch (entity_id)
SELECT q.entity_id
FROM system.repair_remaining_admin_queue_20260722 q
WHERE q.entity_family = 'stop'
  AND q.status = 'pending'
ORDER BY q.entity_id
LIMIT 500
FOR UPDATE OF q SKIP LOCKED;

CREATE TEMP TABLE _stop_pick ON COMMIT DROP AS
SELECT DISTINCT ON (b.entity_id)
  b.entity_id AS id,
  s.admin_area_id AS old_admin,
  s.updated_at AS old_upd,
  tw.id AS township_id
FROM _stop_batch b
JOIN transport.stops s ON s.id = b.entity_id
JOIN _townships tw ON tw.geom && s.geom AND ST_Covers(tw.geom, s.geom)
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
ORDER BY b.entity_id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_remaining_admin_backup_20260722 (
  entity_family, entity_id, admin_area_id, updated_at
)
SELECT 'stop', id, old_admin, old_upd FROM _stop_pick
ON CONFLICT (entity_family, entity_id) DO NOTHING;

UPDATE transport.stops s
SET admin_area_id = p.township_id,
    updated_at = now()
FROM _stop_pick p
WHERE s.id = p.id
  AND p.township_id IS DISTINCT FROM s.admin_area_id;

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'resolved',
    new_admin_area_id = p.township_id,
    reason = 'township_covers_point',
    processed_at = now()
FROM _stop_pick p
WHERE q.entity_family = 'stop'
  AND q.entity_id = p.id
  AND q.status = 'pending';

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'unresolved',
    reason = 'no_township_covers_point',
    processed_at = now()
WHERE q.entity_family = 'stop'
  AND q.status = 'pending'
  AND q.entity_id IN (SELECT entity_id FROM _stop_batch)
  AND NOT EXISTS (SELECT 1 FROM _stop_pick p WHERE p.id = q.entity_id);

-- ----- terminals -----
CREATE TEMP TABLE _term_batch (
  entity_id bigint PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _term_batch (entity_id)
SELECT q.entity_id
FROM system.repair_remaining_admin_queue_20260722 q
WHERE q.entity_family = 'terminal'
  AND q.status = 'pending'
ORDER BY q.entity_id
LIMIT 500
FOR UPDATE OF q SKIP LOCKED;

CREATE TEMP TABLE _term_pick ON COMMIT DROP AS
SELECT DISTINCT ON (b.entity_id)
  b.entity_id AS id,
  t.admin_area_id AS old_admin,
  t.updated_at AS old_upd,
  tw.id AS township_id
FROM _term_batch b
JOIN transport.terminals t ON t.id = b.entity_id
JOIN _townships tw ON tw.geom && t.geom AND ST_Covers(tw.geom, t.geom)
WHERE t.deleted_at IS NULL
  AND t.geom IS NOT NULL
ORDER BY b.entity_id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_remaining_admin_backup_20260722 (
  entity_family, entity_id, admin_area_id, updated_at
)
SELECT 'terminal', id, old_admin, old_upd FROM _term_pick
ON CONFLICT (entity_family, entity_id) DO NOTHING;

UPDATE transport.terminals t
SET admin_area_id = p.township_id,
    updated_at = now()
FROM _term_pick p
WHERE t.id = p.id
  AND p.township_id IS DISTINCT FROM t.admin_area_id;

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'resolved',
    new_admin_area_id = p.township_id,
    reason = 'township_covers_point',
    processed_at = now()
FROM _term_pick p
WHERE q.entity_family = 'terminal'
  AND q.entity_id = p.id
  AND q.status = 'pending';

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'unresolved',
    reason = 'no_township_covers_point',
    processed_at = now()
WHERE q.entity_family = 'terminal'
  AND q.status = 'pending'
  AND q.entity_id IN (SELECT entity_id FROM _term_batch)
  AND NOT EXISTS (SELECT 1 FROM _term_pick p WHERE p.id = q.entity_id);

-- ----- infrastructure lines -----
CREATE TEMP TABLE _infra_batch (
  entity_id bigint PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _infra_batch (entity_id)
SELECT q.entity_id
FROM system.repair_remaining_admin_queue_20260722 q
WHERE q.entity_family = 'infrastructure_line'
  AND q.status = 'pending'
ORDER BY q.entity_id
LIMIT 500
FOR UPDATE OF q SKIP LOCKED;

CREATE TEMP TABLE _infra_pick ON COMMIT DROP AS
SELECT DISTINCT ON (b.entity_id)
  b.entity_id AS id,
  i.admin_area_id AS old_admin,
  i.updated_at AS old_upd,
  tw.id AS township_id
FROM _infra_batch b
JOIN transport.infrastructure_lines i ON i.id = b.entity_id
CROSS JOIN LATERAL (
  SELECT ST_SetSRID(
    ST_LineInterpolatePoint(
      CASE
        WHEN GeometryType(i.geom) IN ('MULTILINESTRING', 'GEOMETRYCOLLECTION')
          THEN ST_GeometryN(ST_CollectionExtract(i.geom, 2), 1)
        ELSE i.geom
      END,
      0.5
    ),
    4326
  ) AS mid_pt
) m
JOIN _townships tw ON tw.geom && m.mid_pt AND ST_Covers(tw.geom, m.mid_pt)
WHERE i.deleted_at IS NULL
  AND i.geom IS NOT NULL
  AND m.mid_pt IS NOT NULL
ORDER BY b.entity_id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_remaining_admin_backup_20260722 (
  entity_family, entity_id, admin_area_id, updated_at
)
SELECT 'infrastructure_line', id, old_admin, old_upd FROM _infra_pick
ON CONFLICT (entity_family, entity_id) DO NOTHING;

UPDATE transport.infrastructure_lines i
SET admin_area_id = p.township_id,
    updated_at = now()
FROM _infra_pick p
WHERE i.id = p.id
  AND p.township_id IS DISTINCT FROM i.admin_area_id;

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'resolved',
    new_admin_area_id = p.township_id,
    reason = 'township_covers_midpoint',
    processed_at = now()
FROM _infra_pick p
WHERE q.entity_family = 'infrastructure_line'
  AND q.entity_id = p.id
  AND q.status = 'pending';

UPDATE system.repair_remaining_admin_queue_20260722 q
SET status = 'unresolved',
    reason = 'no_township_covers_midpoint',
    processed_at = now()
WHERE q.entity_family = 'infrastructure_line'
  AND q.status = 'pending'
  AND q.entity_id IN (SELECT entity_id FROM _infra_batch)
  AND NOT EXISTS (SELECT 1 FROM _infra_pick p WHERE p.id = q.entity_id);

SELECT 'stop_batch' AS metric, count(*)::text AS value FROM _stop_batch
UNION ALL SELECT 'stop_resolved', count(*)::text FROM _stop_pick
UNION ALL SELECT 'terminal_batch', count(*)::text FROM _term_batch
UNION ALL SELECT 'terminal_resolved', count(*)::text FROM _term_pick
UNION ALL SELECT 'infra_batch', count(*)::text FROM _infra_batch
UNION ALL SELECT 'infra_resolved', count(*)::text FROM _infra_pick;

COMMIT;
