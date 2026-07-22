-- Prompt 2 — Admin repair proposals (READ-ONLY report)
-- Categories: clear_parent_error | clear_level_error | clear_type_error
--             possible_parent_error | possible_type_error | manual_review
-- No permanent workflow table. Run as a query/report only.

WITH levels AS (
  SELECT id, code, rank FROM ref.ref_admin_levels
),
types AS (
  SELECT id, code FROM ref.ref_admin_area_types
),
proposals AS (
  -- 1) Pazundaung: named township, stored as district under a town
  SELECT
    7523::bigint AS admin_area_id,
    'ပုဇွန်တောင်မြို့နယ်'::text AS canonical_name,
    5271::bigint AS current_parent_id,
    13::bigint AS proposed_parent_id, -- Yangon Region (township→state_region fallback)
    'district'::text AS current_level_code,
    'township'::text AS proposed_level_code,
    'district'::text AS current_type_code,
    'township'::text AS proposed_type_code,
    'Name ends with township; parent is town (invalid rank). Reparent to Yangon Region; demote to township.'::text AS reason,
    95::int AS confidence,
    'clear_parent_error'::text AS repair_category

  UNION ALL
  -- 2) Maing Maw district under another district → Wa North state_region (smallest cover)
  SELECT
    6452, 'မိုင်းမော', 6474, 6485,
    'district', 'district',
    'district', 'district',
    'District parented under district; ST_Covers picks Wa North state_region (smaller than Shan).',
    90, 'clear_parent_error'

  UNION ALL
  -- 3–8) Islands wrongly at state_region under country
  SELECT i.island_id, aa.canonical_name, aa.parent_id, i.state_region_id,
         'state_region', 'ward_village_tract',
         'island', 'island',
         'Island typed correctly but hierarchy level is state_region under country; demote level and attach covering state_region.',
         92, 'clear_level_error'
  FROM (VALUES
    (5092::bigint, 6722::bigint),
    (5151, 6722),
    (6991, 6722),
    (7177, 6722),
    (7432, 7279),
    (7433, 7279)
  ) AS i(island_id, state_region_id)
  JOIN core.core_admin_areas aa ON aa.id = i.island_id
)
SELECT * FROM proposals
ORDER BY repair_category, admin_area_id;

\echo '=== Proposal category counts ==='
SELECT repair_category, count(*) FROM (
  SELECT 'clear_parent_error' AS repair_category UNION ALL SELECT 'clear_parent_error'
  UNION ALL SELECT 'clear_level_error' UNION ALL SELECT 'clear_level_error'
  UNION ALL SELECT 'clear_level_error' UNION ALL SELECT 'clear_level_error'
  UNION ALL SELECT 'clear_level_error' UNION ALL SELECT 'clear_level_error'
) s GROUP BY 1;

\echo '=== Remaining uncertain (counts only; not auto-fixed) ==='
SELECT 'ward_vt_under_non_township' AS bucket, count(*) AS n
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN core.core_admin_areas p ON p.id = aa.parent_id
JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL
  AND al.code = 'ward_village_tract'
  AND pal.code <> 'township'
UNION ALL
SELECT 'town_under_state_region', count(*)
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
JOIN core.core_admin_areas p ON p.id = aa.parent_id
JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
WHERE aa.deleted_at IS NULL AND al.code = 'town' AND pal.code = 'state_region';
