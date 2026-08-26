-- Read-only verification after migration 196.

\pset pager off

SELECT
  count(*) FILTER (
    WHERE lower(btrim(code)) IN (
      'settlement', 'city', 'town', 'village', 'hamlet',
      'quarter', 'suburb', 'neighbourhood', 'locality'
    )
  ) AS leftover_settlement_poi_category_rows,
  count(*) FILTER (
    WHERE lower(btrim(code)) IN (
      'settlement', 'city', 'town', 'village', 'hamlet',
      'quarter', 'suburb', 'neighbourhood', 'locality'
    )
      AND is_public IS FALSE
      AND is_searchable IS FALSE
  ) AS leftover_settlement_poi_categories_deactivated
FROM ref.ref_poi_categories;

SELECT
  EXISTS (SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'village') AS admin_village_type_present,
  EXISTS (SELECT 1 FROM ref.ref_admin_levels WHERE code = 'village') AS admin_village_level_present,
  EXISTS (SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'township') AS township_type_present,
  EXISTS (SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'town') AS town_type_present,
  EXISTS (SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'ward') AS ward_type_present,
  EXISTS (SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'village_tract') AS village_tract_type_present,
  EXISTS (SELECT 1 FROM ref.ref_address_component_types WHERE code = 'village') AS address_component_village_present;

SELECT t.code, count(*)::int AS n
FROM ref.ref_admin_area_types t
INNER JOIN core.core_admin_areas a ON a.admin_area_type_id = t.id
WHERE t.code IN ('township', 'town', 'ward', 'village_tract', 'village')
GROUP BY t.code
ORDER BY t.code;
