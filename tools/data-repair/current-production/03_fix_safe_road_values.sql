-- Remaining repair: safe road values (once)
-- Only unprotected/unverified boardwalk tags → bridge=true.
-- Never auto-change low_water_crossing or protected rows.

SET statement_timeout = '15min';

BEGIN;

CREATE TEMP TABLE _boardwalk_fix ON COMMIT DROP AS
SELECT s.id, s.bridge AS old_bridge, s.updated_at AS old_updated_at
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false)
  AND s.normalized_data -> 'tags' ->> 'bridge' = 'boardwalk'
  AND s.bridge IS DISTINCT FROM true;

INSERT INTO system.repair_remaining_road_backup_20260722 (street_id, bridge, updated_at)
SELECT id, old_bridge, old_updated_at
FROM _boardwalk_fix
ON CONFLICT (street_id) DO NOTHING;

UPDATE core.core_streets s
SET bridge = true,
    updated_at = now()
FROM _boardwalk_fix f
WHERE s.id = f.id
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false)
  AND s.normalized_data -> 'tags' ->> 'bridge' = 'boardwalk'
  AND s.bridge IS DISTINCT FROM true;

SELECT 'boardwalk_repaired' AS metric, count(*)::text AS value FROM _boardwalk_fix
UNION ALL
SELECT 'boardwalk_mismatch_remaining', count(*)::text
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false)
  AND s.normalized_data -> 'tags' ->> 'bridge' = 'boardwalk'
  AND s.bridge IS DISTINCT FROM true
UNION ALL
SELECT 'low_water_crossing_untouched', count(*)::text
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND s.normalized_data -> 'tags' ->> 'bridge' = 'low_water_crossing'
UNION ALL
SELECT 'protected_road_class_mismatch', count(*)::text
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
WHERE s.deleted_at IS NULL
  AND s.road_class IS DISTINCT FROM r.code
  AND (COALESCE(s.manual_override, false) OR COALESCE(s.is_verified, false))
UNION ALL
SELECT 'unprotected_road_class_mismatch', count(*)::text
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
WHERE s.deleted_at IS NULL
  AND s.road_class IS DISTINCT FROM r.code
  AND NOT COALESCE(s.manual_override, false)
  AND NOT COALESCE(s.is_verified, false);

COMMIT;
