-- Prompt 6 verify
SELECT s.road_class, rc.code AS ref_code, count(*)
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL
GROUP BY 1, 2
ORDER BY count(*) DESC;

SELECT count(*) AS remaining_mismatches
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class IS DISTINCT FROM rc.code;
