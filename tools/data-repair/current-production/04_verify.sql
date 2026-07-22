-- Remaining repair verification (read-mostly; no DML)
SET statement_timeout = '20min';

SELECT 'queue' AS section, entity_family, status, count(*)::text AS value
FROM system.repair_remaining_admin_queue_20260722
GROUP BY 1, 2, 3
ORDER BY 2, 3;

SELECT 'live' AS section, metric, value
FROM (
  SELECT 'streets_missing_admin' AS metric, count(*)::text AS value
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL AND s.admin_area_id IS NULL
  UNION ALL
  SELECT 'streets_non_township_admin', count(*)::text
  FROM core.core_streets s
  JOIN core.core_admin_areas a ON a.id = s.admin_area_id AND a.deleted_at IS NULL
  JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
  WHERE s.deleted_at IS NULL AND l.code IS DISTINCT FROM 'township'
  UNION ALL
  SELECT 'stops_missing_admin', count(*)::text
  FROM transport.stops WHERE deleted_at IS NULL AND admin_area_id IS NULL
  UNION ALL
  SELECT 'terminals_missing_admin', count(*)::text
  FROM transport.terminals WHERE deleted_at IS NULL AND admin_area_id IS NULL
  UNION ALL
  SELECT 'infra_missing_admin', count(*)::text
  FROM transport.infrastructure_lines WHERE deleted_at IS NULL AND admin_area_id IS NULL
  UNION ALL
  SELECT 'road_class_mismatch_unprotected', count(*)::text
  FROM core.core_streets s
  LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
  WHERE s.deleted_at IS NULL
    AND s.road_class IS DISTINCT FROM r.code
    AND NOT COALESCE(s.manual_override, false)
    AND NOT COALESCE(s.is_verified, false)
  UNION ALL
  SELECT 'road_class_mismatch_protected', count(*)::text
  FROM core.core_streets s
  LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
  WHERE s.deleted_at IS NULL
    AND s.road_class IS DISTINCT FROM r.code
    AND (COALESCE(s.manual_override, false) OR COALESCE(s.is_verified, false))
  UNION ALL
  SELECT 'boardwalk_safe_mismatch', count(*)::text
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL
    AND NOT COALESCE(s.manual_override, false)
    AND NOT COALESCE(s.is_verified, false)
    AND s.normalized_data -> 'tags' ->> 'bridge' = 'boardwalk'
    AND s.bridge IS DISTINCT FROM true
  UNION ALL
  SELECT 'assigned_admin_not_active_township', count(*)::text
  FROM system.repair_remaining_admin_queue_20260722 q
  LEFT JOIN core.core_admin_areas a ON a.id = q.new_admin_area_id
  LEFT JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
  WHERE q.status = 'resolved'
    AND (
      a.id IS NULL
      OR a.deleted_at IS NOT NULL
      OR a.is_active IS NOT TRUE
      OR l.code IS DISTINCT FROM 'township'
    )
) m
ORDER BY metric;

-- Machine-readable summary lines for the shell runner (prefix SUMMARY|)
SELECT format(
  'SUMMARY|street_resolved=%s|street_unresolved=%s|street_protected=%s|street_pending=%s|stop_resolved=%s|stop_unresolved=%s|stop_pending=%s|terminal_resolved=%s|terminal_unresolved=%s|terminal_pending=%s|infra_resolved=%s|infra_unresolved=%s|infra_pending=%s|boardwalk_safe_mismatch=%s|unprotected_class_mismatch=%s|protected_class_mismatch=%s|bad_resolved_township=%s',
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='street' AND status='resolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='street' AND status='unresolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='street' AND status='protected'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='street' AND status='pending'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='stop' AND status='resolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='stop' AND status='unresolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='stop' AND status='pending'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='terminal' AND status='resolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='terminal' AND status='unresolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='terminal' AND status='pending'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='infrastructure_line' AND status='resolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='infrastructure_line' AND status='unresolved'),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='infrastructure_line' AND status='pending'),
  (SELECT count(*) FROM core.core_streets s
   WHERE s.deleted_at IS NULL
     AND NOT COALESCE(s.manual_override, false)
     AND NOT COALESCE(s.is_verified, false)
     AND s.normalized_data -> 'tags' ->> 'bridge' = 'boardwalk'
     AND s.bridge IS DISTINCT FROM true),
  (SELECT count(*) FROM core.core_streets s
   LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
   WHERE s.deleted_at IS NULL
     AND s.road_class IS DISTINCT FROM r.code
     AND NOT COALESCE(s.manual_override, false)
     AND NOT COALESCE(s.is_verified, false)),
  (SELECT count(*) FROM core.core_streets s
   LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
   WHERE s.deleted_at IS NULL
     AND s.road_class IS DISTINCT FROM r.code
     AND (COALESCE(s.manual_override, false) OR COALESCE(s.is_verified, false))),
  (SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 q
   LEFT JOIN core.core_admin_areas a ON a.id = q.new_admin_area_id
   LEFT JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
   WHERE q.status = 'resolved'
     AND (
       a.id IS NULL
       OR a.deleted_at IS NOT NULL
       OR a.is_active IS NOT TRUE
       OR l.code IS DISTINCT FROM 'township'
     ))
) AS summary_line;
