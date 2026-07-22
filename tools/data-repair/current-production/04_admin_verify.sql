-- Prompt 3 — Verify admin hierarchy after clear repairs

SELECT 'self_parent' AS issue, count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL AND id = parent_id
UNION ALL
SELECT 'parent_rank_not_higher', count(*)
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN core.core_admin_areas p ON p.id = aa.parent_id
JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL AND al.rank <= pal.rank
UNION ALL
SELECT 'islands_still_state_region', count(*)
FROM core.core_admin_areas aa
JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL AND t.code = 'island' AND al.code = 'state_region'
UNION ALL
SELECT 'invalid_geom', count(*)
FROM core.core_admin_areas WHERE deleted_at IS NULL AND NOT ST_IsValid(geom);

\echo '=== Repaired row current state ==='
SELECT aa.id, aa.canonical_name, al.code AS level, t.code AS type_code,
       aa.parent_id, pal.code AS parent_level, aa.is_verified
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
LEFT JOIN core.core_admin_areas p ON p.id = aa.parent_id
LEFT JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.id IN (7523, 6452, 5092, 5151, 6991, 7177, 7432, 7433)
ORDER BY aa.id;

\echo '=== Backup vs live verified flags (must be unchanged) ==='
SELECT b.id, b.is_verified AS before_verified, aa.is_verified AS after_verified,
       b.verification_status AS before_status, aa.verification_status AS after_status
FROM system.repair_admin_areas_before_202607 b
JOIN core.core_admin_areas aa ON aa.id = b.id;
