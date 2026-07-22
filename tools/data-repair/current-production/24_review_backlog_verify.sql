-- Prompt 11 verify
SELECT 'import_review_candidates_total' AS metric, (
  (SELECT count(*) FROM import_review.road_candidates) +
  (SELECT count(*) FROM import_review.place_candidates) +
  (SELECT count(*) FROM import_review.building_candidates) +
  (SELECT count(*) FROM import_review.admin_area_candidates) +
  (SELECT count(*) FROM import_review.landuse_candidates)
)::text AS value
UNION ALL
SELECT 'publish_batches_archived', count(*)::text
FROM system.system_publish_batches WHERE status = 'archived'
UNION ALL
SELECT 'publish_batches_promoted', count(*)::text
FROM system.system_publish_batches WHERE status = 'promoted'
UNION ALL
SELECT 'publish_items_skipped', count(*)::text
FROM system.system_publish_items WHERE publish_status = 'skipped'
UNION ALL
SELECT 'publish_items_pending_remain', count(*)::text
FROM system.system_publish_items WHERE publish_status = 'pending'
UNION ALL
SELECT 'publish_items_success', count(*)::text
FROM system.system_publish_items WHERE publish_status = 'success'
UNION ALL
SELECT 'publish_items_failed', count(*)::text
FROM system.system_publish_items WHERE publish_status = 'failed';

SELECT status, count(*) FROM system.system_publish_batches GROUP BY 1 ORDER BY 2 DESC;
SELECT entity_family, publish_status, count(*) FROM system.system_publish_items GROUP BY 1,2 ORDER BY 1,3 DESC;
