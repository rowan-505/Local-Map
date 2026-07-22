-- Prompt 2 — Admin hierarchy inspection (READ-ONLY)
-- Operational ladder: country → state_region → district → township → town → ward_village_tract

\echo '=== Invalid parent-rank rows ==='
SELECT aa.id, aa.canonical_name, al.code AS level, pal.code AS parent_level,
       aa.parent_id, t.code AS type_code, aa.is_verified
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
LEFT JOIN core.core_admin_areas p ON p.id = aa.parent_id
LEFT JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
LEFT JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
WHERE aa.deleted_at IS NULL
  AND aa.parent_id IS NOT NULL
  AND al.rank <= pal.rank;

\echo '=== Parent combination counts ==='
SELECT al.code AS child_level, pal.code AS parent_level, count(*) AS n
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN core.core_admin_areas p ON p.id = aa.parent_id
JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL
GROUP BY 1, 2
ORDER BY 1, 3 DESC;

\echo '=== Islands (type=island) ==='
SELECT aa.id, aa.canonical_name, al.code AS level, aa.parent_id, pal.code AS parent_level, aa.is_verified
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
LEFT JOIN core.core_admin_areas p ON p.id = aa.parent_id
LEFT JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL AND t.code = 'island'
ORDER BY aa.id;

\echo '=== Ward/VT under non-township parents (counts) ==='
SELECT pal.code AS parent_level, t.code AS type_code, count(*) AS n
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
JOIN core.core_admin_areas p ON p.id = aa.parent_id
JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL
  AND al.code = 'ward_village_tract'
  AND pal.code <> 'township'
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo '=== Name-based ward vs village_tract signals ==='
SELECT
  count(*) FILTER (WHERE canonical_name ~* 'village[[:space:]]*tract|ကျေးရွာအုပ်စု') AS name_suggests_vt,
  count(*) FILTER (WHERE canonical_name ~* 'ward|ရပ်ကွက်') AS name_suggests_ward,
  count(*) FILTER (WHERE t.code = 'village_tract') AS type_vt,
  count(*) FILTER (WHERE t.code = 'ward') AS type_ward
FROM core.core_admin_areas aa
JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND al.code = 'ward_village_tract';
