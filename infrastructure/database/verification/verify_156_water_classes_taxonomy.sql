-- Read-only verification for migration 156
SELECT to_regclass('ref.ref_water_classes') IS NOT NULL AS ref_exists;

SELECT count(*) AS water_lines FROM core.core_water_lines;
SELECT count(*) AS water_polygons FROM core.core_water_polygons;
SELECT count(*) AS lines_with_class FROM core.core_water_lines WHERE water_class_id IS NOT NULL;
SELECT count(*) AS polys_with_class FROM core.core_water_polygons WHERE water_class_id IS NOT NULL;

SELECT count(*) AS orphan_lines
FROM core.core_water_lines w
LEFT JOIN ref.ref_water_classes c ON c.id = w.water_class_id
WHERE c.id IS NULL;

SELECT count(*) AS orphan_polys
FROM core.core_water_polygons w
LEFT JOIN ref.ref_water_classes c ON c.id = w.water_class_id
WHERE c.id IS NULL;

SELECT c.code, p.code AS parent_code, c.sort_order
FROM ref.ref_water_classes c
LEFT JOIN ref.ref_water_classes p ON p.id = c.parent_id
ORDER BY COALESCE(p.sort_order, c.sort_order), c.sort_order, c.code;

SELECT reason, resolved_code, count(*) AS n
FROM system.migration_156_water_class_anomalies
GROUP BY 1, 2
ORDER BY n DESC;

SELECT
  count(*) FILTER (WHERE source_registry_id IS NOT NULL) AS lines_registry,
  count(*) FILTER (WHERE source_feature_id IS NOT NULL) AS lines_feature_id
FROM core.core_water_lines;

SELECT
  count(*) FILTER (WHERE source_registry_id IS NOT NULL) AS polys_registry,
  count(*) FILTER (WHERE source_feature_id IS NOT NULL) AS polys_feature_id
FROM core.core_water_polygons;
