-- Prompt 11 — Import-review / publish backlog inspect (READ-ONLY)
SELECT 'import_review_batches' AS metric, count(*)::text FROM import_review.review_batches
UNION ALL SELECT 'road_candidates', count(*)::text FROM import_review.road_candidates
UNION ALL SELECT 'place_candidates', count(*)::text FROM import_review.place_candidates
UNION ALL SELECT 'building_candidates', count(*)::text FROM import_review.building_candidates
UNION ALL SELECT 'admin_area_candidates', count(*)::text FROM import_review.admin_area_candidates
UNION ALL SELECT 'landuse_candidates', count(*)::text FROM import_review.landuse_candidates
UNION ALL SELECT 'water_line_candidates', count(*)::text FROM import_review.water_line_candidates
UNION ALL SELECT 'water_polygon_candidates', count(*)::text FROM import_review.water_polygon_candidates
UNION ALL SELECT 'publish_batches', count(*)::text FROM system.system_publish_batches
UNION ALL SELECT 'publish_items', count(*)::text FROM system.system_publish_items;

SELECT status, count(*) FROM system.system_publish_batches GROUP BY 1 ORDER BY 2 DESC;
SELECT entity_family, publish_status, count(*) FROM system.system_publish_items GROUP BY 1,2 ORDER BY 1,3 DESC;
