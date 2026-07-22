-- Prompt 5 — Road class prepare (READ-ONLY proposal summary)
-- Safe mechanical fixes:
--   1) Add ref code unclassified
--   2) Fix road_class_id FK when road_class text is track|unclassified but FK points at unknown
-- Manual override and verified skipped by default on apply.

SELECT 'need_ref_unclassified' AS item,
       CASE WHEN EXISTS (SELECT 1 FROM ref.ref_road_classes WHERE code='unclassified')
            THEN 0 ELSE 1 END AS n
UNION ALL
SELECT 'track_fk_to_unknown',
       count(*)::int
FROM core.core_streets s
JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class='track' AND rc.code='unknown'
  AND NOT COALESCE(s.manual_override,false)
UNION ALL
SELECT 'unclassified_fk_to_unknown',
       count(*)::int
FROM core.core_streets s
JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class='unclassified' AND rc.code='unknown'
  AND NOT COALESCE(s.manual_override,false)
UNION ALL
SELECT 'manual_override_mismatches',
       count(*)::int
FROM core.core_streets s
JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class IS DISTINCT FROM rc.code
  AND COALESCE(s.manual_override,false);
