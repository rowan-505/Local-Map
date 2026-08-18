-- Read-only verification for migration 155
SELECT to_regclass('ref.ref_landuse_classes') IS NULL AS old_ref_gone,
       to_regclass('ref.ref_land_area_classes') IS NOT NULL AS new_ref_exists,
       to_regclass('import_review.landuse_candidates') IS NULL AS old_cand_gone,
       to_regclass('import_review.land_area_candidates') IS NOT NULL AS new_cand_exists;

SELECT count(*) AS land_areas FROM core.core_land_areas;
SELECT count(*) AS with_valid_class_fk
FROM core.core_land_areas a
JOIN ref.ref_land_area_classes c ON c.id = a.land_area_class_id;

SELECT c.code, p.code AS parent_code
FROM ref.ref_land_area_classes c
LEFT JOIN ref.ref_land_area_classes p ON p.id = c.parent_id
ORDER BY COALESCE(p.code, c.code), c.sort_order, c.code;
