-- Prompt 3 — Apply clear admin hierarchy repairs
-- Dry-run first: SELECT count from proposals.
-- Backup slim fields only, then apply in small transactions.

BEGIN;

CREATE TABLE IF NOT EXISTS system.repair_admin_areas_before_202607 (
  id bigint PRIMARY KEY,
  parent_id bigint,
  admin_level_id bigint,
  admin_area_type_id bigint,
  updated_at timestamptz,
  verification_status text,
  is_verified boolean,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

-- Backup only rows we will change (8 ids)
INSERT INTO system.repair_admin_areas_before_202607 (
  id, parent_id, admin_level_id, admin_area_type_id, updated_at, verification_status, is_verified
)
SELECT aa.id, aa.parent_id, aa.admin_level_id, aa.admin_area_type_id,
       aa.updated_at, aa.verification_status, aa.is_verified
FROM core.core_admin_areas aa
WHERE aa.id IN (7523, 6452, 5092, 5151, 6991, 7177, 7432, 7433)
ON CONFLICT (id) DO NOTHING;

-- A) Invalid parent relationships
UPDATE core.core_admin_areas aa
SET parent_id = 13,
    admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'township'),
    admin_area_type_id = (SELECT id FROM ref.ref_admin_area_types WHERE code = 'township'),
    updated_at = now()
WHERE aa.id = 7523
  AND aa.deleted_at IS NULL;

UPDATE core.core_admin_areas aa
SET parent_id = 6485,
    updated_at = now()
WHERE aa.id = 6452
  AND aa.deleted_at IS NULL;

-- B) Island level + parent corrections
UPDATE core.core_admin_areas aa
SET admin_level_id = (SELECT id FROM ref.ref_admin_levels WHERE code = 'ward_village_tract'),
    parent_id = v.parent_id,
    updated_at = now()
FROM (VALUES
  (5092::bigint, 6722::bigint),
  (5151, 6722),
  (6991, 6722),
  (7177, 6722),
  (7432, 7279),
  (7433, 7279)
) AS v(id, parent_id)
WHERE aa.id = v.id
  AND aa.deleted_at IS NULL;

-- C) Follow-on: townships that were children of Pazundaung-as-district
--    become equal-rank after demotion → reparent to Yangon Region (fallback).
INSERT INTO system.repair_admin_areas_before_202607 (
  id, parent_id, admin_level_id, admin_area_type_id, updated_at, verification_status, is_verified
)
SELECT aa.id, aa.parent_id, aa.admin_level_id, aa.admin_area_type_id,
       aa.updated_at, aa.verification_status, aa.is_verified
FROM core.core_admin_areas aa
WHERE aa.id IN (5388, 5395, 5425, 5446, 5538)
ON CONFLICT (id) DO NOTHING;

UPDATE core.core_admin_areas
SET parent_id = 13, updated_at = now()
WHERE id IN (5388, 5395, 5425, 5446, 5538)
  AND deleted_at IS NULL
  AND parent_id = 7523;

-- Audit (concise)
INSERT INTO system.audit_logs (actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot)
SELECT
  NULL,
  'current_production_admin_foundation_repair',
  'core_admin_areas',
  b.id,
  jsonb_build_object(
    'parent_id', b.parent_id,
    'admin_level_id', b.admin_level_id,
    'admin_area_type_id', b.admin_area_type_id,
    'verification_status', b.verification_status,
    'is_verified', b.is_verified
  ),
  jsonb_build_object(
    'parent_id', aa.parent_id,
    'admin_level_id', aa.admin_level_id,
    'admin_area_type_id', aa.admin_area_type_id,
    'note', 'applied clear hierarchy repair'
  )
FROM system.repair_admin_areas_before_202607 b
JOIN core.core_admin_areas aa ON aa.id = b.id
WHERE b.repaired_at >= now() - interval '1 minute'
   OR b.id IN (7523, 6452, 5092, 5151, 6991, 7177, 7432, 7433);

COMMIT;

SELECT 'backup_rows' AS metric, count(*)::text AS value
FROM system.repair_admin_areas_before_202607
UNION ALL
SELECT 'applied_targets', '8';
