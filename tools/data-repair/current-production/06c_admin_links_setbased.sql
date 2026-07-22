-- Prompt 4c — Set-based township assignment (fast)
-- Midpoint + ST_Covers against township polygons (GIST).

SET statement_timeout = '45min';
SET work_mem = '512MB';

CREATE TABLE IF NOT EXISTS system.repair_admin_links_before_202607 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  admin_area_id bigint,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id)
);

-- Townships reference (small)
CREATE TEMP TABLE _townships AS
SELECT aa.id, aa.geom
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL
  AND aa.is_active IS TRUE
  AND al.code = 'township'
  AND aa.geom IS NOT NULL;
CREATE INDEX ON _townships USING gist (geom);
ANALYZE _townships;

-- ===== STREETS missing OR wrong-level =====
CREATE TEMP TABLE _street_targets AS
SELECT
  s.id,
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
FROM core.core_streets s
LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id
LEFT JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND NOT COALESCE(s.manual_override, false)
  AND (
    s.admin_area_id IS NULL
    OR al.code IS DISTINCT FROM 'township'
  );

CREATE INDEX ON _street_targets (id);
CREATE INDEX ON _street_targets USING gist (mid_pt);
ANALYZE _street_targets;

CREATE TEMP TABLE _street_pick AS
SELECT DISTINCT ON (t.id)
  t.id,
  t.old_admin_area_id,
  t.old_updated_at,
  tw.id AS township_id
FROM _street_targets t
JOIN _townships tw ON tw.geom && t.mid_pt AND ST_Covers(tw.geom, t.mid_pt)
WHERE t.mid_pt IS NOT NULL
ORDER BY t.id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

CREATE INDEX ON _street_pick (id);

BEGIN;
INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'streets', p.id, p.old_admin_area_id, p.old_updated_at
FROM _street_pick p
WHERE p.township_id IS DISTINCT FROM p.old_admin_area_id
ON CONFLICT DO NOTHING;

UPDATE core.core_streets s
SET admin_area_id = p.township_id,
    updated_at = now()
FROM _street_pick p
WHERE s.id = p.id
  AND p.township_id IS DISTINCT FROM s.admin_area_id;
COMMIT;

-- ===== STOPS =====
BEGIN;
CREATE TEMP TABLE _stop_pick AS
SELECT DISTINCT ON (s.id)
  s.id, s.admin_area_id AS old_admin, s.updated_at AS old_upd, tw.id AS township_id
FROM transport.stops s
JOIN _townships tw ON tw.geom && s.geom AND ST_Covers(tw.geom, s.geom)
WHERE s.deleted_at IS NULL AND s.admin_area_id IS NULL AND s.geom IS NOT NULL
ORDER BY s.id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'stops', id, old_admin, old_upd FROM _stop_pick ON CONFLICT DO NOTHING;

UPDATE transport.stops s
SET admin_area_id = p.township_id, updated_at = now()
FROM _stop_pick p WHERE s.id = p.id;
COMMIT;

-- ===== TERMINALS =====
BEGIN;
CREATE TEMP TABLE _term_pick AS
SELECT DISTINCT ON (t.id)
  t.id, t.admin_area_id AS old_admin, t.updated_at AS old_upd, tw.id AS township_id
FROM transport.terminals t
JOIN _townships tw ON tw.geom && t.geom AND ST_Covers(tw.geom, t.geom)
WHERE t.deleted_at IS NULL AND t.admin_area_id IS NULL AND t.geom IS NOT NULL
ORDER BY t.id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'terminals', id, old_admin, old_upd FROM _term_pick ON CONFLICT DO NOTHING;

UPDATE transport.terminals t
SET admin_area_id = p.township_id, updated_at = now()
FROM _term_pick p WHERE t.id = p.id;
COMMIT;

-- ===== INFRASTRUCTURE LINES (midpoint) =====
BEGIN;
CREATE TEMP TABLE _infra_pick AS
SELECT DISTINCT ON (i.id)
  i.id, i.admin_area_id AS old_admin, i.updated_at AS old_upd, tw.id AS township_id
FROM transport.infrastructure_lines i
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
WHERE i.deleted_at IS NULL AND i.admin_area_id IS NULL AND i.geom IS NOT NULL AND m.mid_pt IS NOT NULL
ORDER BY i.id, ST_Area(tw.geom::geography) ASC, tw.id ASC;

INSERT INTO system.repair_admin_links_before_202607 (entity_family, entity_id, admin_area_id, updated_at)
SELECT 'infrastructure_lines', id, old_admin, old_upd FROM _infra_pick ON CONFLICT DO NOTHING;

UPDATE transport.infrastructure_lines i
SET admin_area_id = p.township_id, updated_at = now()
FROM _infra_pick p WHERE i.id = p.id;
COMMIT;

SELECT 'street_targets' AS metric, count(*)::text FROM _street_targets
UNION ALL SELECT 'street_picked', count(*)::text FROM _street_pick
UNION ALL SELECT 'stop_picked', count(*)::text FROM _stop_pick
UNION ALL SELECT 'term_picked', count(*)::text FROM _term_pick
UNION ALL SELECT 'infra_picked', count(*)::text FROM _infra_pick;
