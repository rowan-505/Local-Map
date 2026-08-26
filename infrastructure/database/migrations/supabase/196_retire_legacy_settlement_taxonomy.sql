-- =============================================================================
-- Supabase migration 196: retire leftover settlement POI + admin village refs
-- =============================================================================
--
-- After the settlement runtime cutover, leftover settlement POI *rows* are gone.
-- This migration only touches reference taxonomy.
--
-- A) ref.ref_poi_categories settlement codes
--    Keep the rows (pipeline Stage 05 still joins them by code) but deactivate
--    is_public / is_searchable so they are not public, searchable, or selectable
--    for new POIs. Do not delete: history, search exclusion, and OSM mappings
--    still name these codes.
--
-- B) Admin village type + level
--    Production has zero core / import_review rows on admin village.
--    OSM admin extraction maps 7–10 to ward_village_tract, not village.
--    Remove the unused admin village type and level.
--
-- Does NOT:
--   rename township → city
--   remove township / ward / village_tract / town
--   remove address-component type village
--   delete canonical ref.ref_settlement_types
--
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1) Deactivate leftover settlement POI categories (do not delete)
-- ---------------------------------------------------------------------------
UPDATE ref.ref_poi_categories
SET
  is_public = false,
  is_searchable = false
WHERE lower(btrim(code)) IN (
  'settlement',
  'city',
  'town',
  'village',
  'hamlet',
  'quarter',
  'suburb',
  'neighbourhood',
  'locality'
);

-- ---------------------------------------------------------------------------
-- 2) Remove unused admin village type (zero core FKs required)
-- ---------------------------------------------------------------------------
DO $block$
DECLARE
  village_type_id bigint;
  type_fk_count bigint;
BEGIN
  SELECT id INTO village_type_id
  FROM ref.ref_admin_area_types
  WHERE code = 'village';

  IF village_type_id IS NOT NULL THEN
    SELECT count(*) INTO type_fk_count
    FROM core.core_admin_areas
    WHERE admin_area_type_id = village_type_id;

    IF type_fk_count > 0 THEN
      RAISE EXCEPTION
        '196 refused: % core.core_admin_areas row(s) still use admin area type village',
        type_fk_count;
    END IF;

    DELETE FROM ref.ref_admin_area_types
    WHERE id = village_type_id;
  END IF;
END
$block$;

-- ---------------------------------------------------------------------------
-- 3) Remove unused admin village level (zero core / import_review FKs required)
-- ---------------------------------------------------------------------------
DO $block$
DECLARE
  village_level_id bigint;
  core_fk_count bigint;
  candidate_fk_count bigint;
BEGIN
  SELECT id INTO village_level_id
  FROM ref.ref_admin_levels
  WHERE code = 'village';

  IF village_level_id IS NOT NULL THEN
    SELECT count(*) INTO core_fk_count
    FROM core.core_admin_areas
    WHERE admin_level_id = village_level_id;

    SELECT count(*) INTO candidate_fk_count
    FROM import_review.admin_area_candidates
    WHERE admin_level_id = village_level_id;

    IF core_fk_count > 0 OR candidate_fk_count > 0 THEN
      RAISE EXCEPTION
        '196 refused: village admin level still referenced (core=%, import_review=%)',
        core_fk_count,
        candidate_fk_count;
    END IF;

    DELETE FROM ref.ref_admin_levels
    WHERE id = village_level_id;
  END IF;
END
$block$;

-- ---------------------------------------------------------------------------
-- 4) Guardrails
-- ---------------------------------------------------------------------------
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ref.ref_poi_categories
    WHERE lower(btrim(code)) IN (
      'settlement', 'city', 'town', 'village', 'hamlet',
      'quarter', 'suburb', 'neighbourhood', 'locality'
    )
      AND (is_public IS TRUE OR is_searchable IS TRUE)
  ) THEN
    RAISE EXCEPTION '196: leftover settlement POI categories are still public or searchable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ref.ref_admin_area_types WHERE code = 'village'
  ) THEN
    RAISE EXCEPTION '196: admin area type village was not removed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ref.ref_admin_levels WHERE code = 'village'
  ) THEN
    RAISE EXCEPTION '196: admin level village was not removed';
  END IF;

  IF (
    SELECT count(*) FROM ref.ref_admin_area_types
    WHERE code IN ('township', 'town', 'ward', 'village_tract')
  ) <> 4 THEN
    RAISE EXCEPTION '196: required admin area types township/town/ward/village_tract are missing';
  END IF;

  IF (
    SELECT count(*) FROM ref.ref_admin_levels
    WHERE code IN ('township', 'town')
  ) <> 2 THEN
    RAISE EXCEPTION '196: required admin levels township/town are missing';
  END IF;
END
$block$;

COMMIT;
