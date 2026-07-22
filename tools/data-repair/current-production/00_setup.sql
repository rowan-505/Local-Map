-- Remaining repair setup (idempotent)
-- Creates queue + slim backup tables and seeds pending/protected rows.
-- Safe to re-run: ON CONFLICT DO NOTHING; no DROP.

SET statement_timeout = '30min';

CREATE TABLE IF NOT EXISTS system.repair_remaining_admin_queue_20260722 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text, 'unresolved'::text, 'protected'::text])),
  old_admin_area_id bigint,
  new_admin_area_id bigint,
  reason text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id)
);

CREATE INDEX IF NOT EXISTS repair_remaining_admin_queue_20260722_pending_idx
  ON system.repair_remaining_admin_queue_20260722 (entity_family, status, entity_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS system.repair_remaining_admin_backup_20260722 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  admin_area_id bigint,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id)
);

CREATE TABLE IF NOT EXISTS system.repair_remaining_road_backup_20260722 (
  street_id bigint NOT NULL PRIMARY KEY,
  bridge boolean,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

-- Streets needing township admin (unprotected → pending)
INSERT INTO system.repair_remaining_admin_queue_20260722 (
  entity_family, entity_id, status, old_admin_area_id, reason
)
SELECT
  'street',
  s.id,
  'pending',
  s.admin_area_id,
  CASE
    WHEN s.admin_area_id IS NULL THEN 'missing_admin'
    ELSE 'non_township_admin'
  END
FROM core.core_streets s
LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id AND aa.deleted_at IS NULL
LEFT JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false)
  AND (
    s.admin_area_id IS NULL
    OR al.code IS DISTINCT FROM 'township'
  )
ON CONFLICT (entity_family, entity_id) DO NOTHING;

-- Protected streets needing township admin (never auto-assign)
INSERT INTO system.repair_remaining_admin_queue_20260722 (
  entity_family, entity_id, status, old_admin_area_id, reason
)
SELECT
  'street',
  s.id,
  'protected',
  s.admin_area_id,
  CASE
    WHEN s.admin_area_id IS NULL THEN 'protected_missing_admin'
    ELSE 'protected_non_township_admin'
  END
FROM core.core_streets s
LEFT JOIN core.core_admin_areas aa ON aa.id = s.admin_area_id AND aa.deleted_at IS NULL
LEFT JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND (COALESCE(s.manual_override, false) OR COALESCE(s.is_verified, false))
  AND (
    s.admin_area_id IS NULL
    OR al.code IS DISTINCT FROM 'township'
  )
ON CONFLICT (entity_family, entity_id) DO NOTHING;

-- Transport stops
INSERT INTO system.repair_remaining_admin_queue_20260722 (
  entity_family, entity_id, status, old_admin_area_id, reason
)
SELECT 'stop', s.id, 'pending', s.admin_area_id, 'missing_admin'
FROM transport.stops s
WHERE s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND s.admin_area_id IS NULL
ON CONFLICT (entity_family, entity_id) DO NOTHING;

-- Transport terminals
INSERT INTO system.repair_remaining_admin_queue_20260722 (
  entity_family, entity_id, status, old_admin_area_id, reason
)
SELECT 'terminal', t.id, 'pending', t.admin_area_id, 'missing_admin'
FROM transport.terminals t
WHERE t.deleted_at IS NULL
  AND t.geom IS NOT NULL
  AND t.admin_area_id IS NULL
ON CONFLICT (entity_family, entity_id) DO NOTHING;

-- Transport infrastructure lines
INSERT INTO system.repair_remaining_admin_queue_20260722 (
  entity_family, entity_id, status, old_admin_area_id, reason
)
SELECT 'infrastructure_line', i.id, 'pending', i.admin_area_id, 'missing_admin'
FROM transport.infrastructure_lines i
WHERE i.deleted_at IS NULL
  AND i.geom IS NOT NULL
  AND i.admin_area_id IS NULL
ON CONFLICT (entity_family, entity_id) DO NOTHING;

SELECT entity_family, status, count(*) AS n
FROM system.repair_remaining_admin_queue_20260722
GROUP BY 1, 2
ORDER BY 1, 2;
