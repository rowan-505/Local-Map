-- =============================================================================
-- Supabase migration 195: settlements tiles view + unified search source
-- =============================================================================
--
-- Wires core.core_settlements into:
--   tiles.tiles_settlements_v              (POINT labels only; no JSON metadata)
--   search.v_search_settlements_source     (entity_type = settlement)
--
-- Transition: legacy settlement POI rows stay in core.core_places, but they are
-- excluded from search.v_search_places_source so canonical settlements win.
--
-- Does NOT:
--   delete core.core_places settlement rows
--   change core.core_admin_areas
--   rebuild search.search_documents (run after apply)
--   rebuild PMTiles
--
-- After apply:
--   SELECT search.rebuild_search_documents(ARRAY['places', 'settlements']);
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- 1) Tile-facing view (POINT labels only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tiles.tiles_settlements_v AS
SELECT
  s.id,
  s.public_id,
  st.code AS settlement_type,
  COALESCE(
    NULLIF(btrim(s.name_mm), ''),
    NULLIF(btrim(s.name_en), ''),
    NULLIF(btrim(s.canonical_name), '')
  ) AS name,
  s.name_mm,
  s.name_en,
  s.importance_score,
  CASE st.code
    WHEN 'city' THEN 6
    WHEN 'town' THEN 8
    WHEN 'village' THEN 11
    WHEN 'local_area' THEN 13
    ELSE 12
  END::numeric AS min_zoom,
  s.point_geom AS geom
FROM core.core_settlements AS s
INNER JOIN ref.ref_settlement_types AS st
  ON st.id = s.settlement_type_id
WHERE s.is_public = true
  AND s.deleted_at IS NULL
  AND s.point_geom IS NOT NULL
  AND NOT ST_IsEmpty(s.point_geom)
  AND ST_IsValid(s.point_geom);

COMMENT ON VIEW tiles.tiles_settlements_v IS
  'Canonical settlement POINT labels for Martin/MapLibre. Source: core.core_settlements. '
  'V1 is point labels only — no footprint, source_refs, or large JSON.';

-- ---------------------------------------------------------------------------
-- 2) Unified search source (same contract as other v_search_*_source views)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW search.v_search_settlements_source AS
SELECT
  'settlement'::text AS entity_type,
  s.id AS entity_id,
  s.public_id::text AS public_id,
  COALESCE(
    NULLIF(btrim(s.name_en), ''),
    NULLIF(btrim(s.name_mm), ''),
    NULLIF(btrim(s.canonical_name), '')
  ) AS display_name,
  COALESCE(st.name, st.code) AS subtitle,
  COALESCE(NULLIF(btrim(s.name_mm), ''), s.canonical_name) AS primary_name_my,
  COALESCE(NULLIF(btrim(s.name_en), ''), s.canonical_name) AS primary_name_en,
  s.canonical_name AS primary_name_und,
  st.code AS code,
  s.external_id,
  st.code AS category_code,
  NULL::text AS category_name_my,
  st.name AS category_name_en,
  s.township_id AS admin_area_id,
  NULL::text AS admin_area_name_my,
  tw.canonical_name AS admin_area_name_en,
  CASE
    WHEN tw.canonical_name IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('township', tw.canonical_name)
  END AS admin_hierarchy,
  NULL::text AS address_text,
  NULL::jsonb AS address_parts,
  'POINT'::text AS geometry_type,
  s.point_geom AS centroid,
  ST_Envelope(ST_Expand(s.point_geom, 0.0009)) AS bbox,
  true AS has_geometry,
  true AS supports_plus_code,
  concat_ws(
    ' ',
    s.canonical_name, s.name_mm, s.name_en, st.code, st.name,
    tw.canonical_name, s.external_id
  ) AS searchable_text,
  COALESCE(s.importance_score, 0) AS importance_score,
  0::numeric AS popularity_score,
  0::numeric AS confidence_score,
  0::numeric AS boundary_confidence_score,
  COALESCE(s.is_verified, false) AS is_verified,
  COALESCE(s.is_public, false) AS is_public,
  (s.deleted_at IS NULL) AS is_active,
  s.updated_at AS source_updated_at,
  '[]'::jsonb AS names
FROM core.core_settlements AS s
INNER JOIN ref.ref_settlement_types AS st
  ON st.id = s.settlement_type_id
LEFT JOIN core.core_admin_areas AS tw
  ON tw.id = s.township_id
 AND tw.deleted_at IS NULL
WHERE s.deleted_at IS NULL
  AND s.is_public = true
  AND s.point_geom IS NOT NULL
  AND NOT ST_IsEmpty(s.point_geom);

COMMENT ON VIEW search.v_search_settlements_source IS
  'Unified search indexer source for canonical settlements (city/town/village/local_area). '
  'Rebuild key: settlements. Runtime entity_type: settlement.';

-- ---------------------------------------------------------------------------
-- 3) Exclude legacy settlement POI categories from the places search source
--    (rows remain in core.core_places)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('search.v_search_places_source_unfiltered') IS NULL
     AND to_regclass('search.v_search_places_source') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW search.v_search_places_source RENAME TO v_search_places_source_unfiltered';
  END IF;
END $$;

CREATE OR REPLACE VIEW search.v_search_places_source AS
SELECT src.*
FROM search.v_search_places_source_unfiltered AS src
WHERE lower(btrim(COALESCE(src.category_code, ''))) NOT IN (
  'settlement',
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'quarter',
  'neighbourhood',
  'neighborhood',
  'locality'
);

COMMENT ON VIEW search.v_search_places_source IS
  'Places search source for POIs only. Legacy settlement categories are excluded during '
  'the core_settlements transition; core.core_places rows are not deleted.';

-- ---------------------------------------------------------------------------
-- 4) Register settlements in rebuild / sync / alias-text helpers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  def text;
BEGIN
  IF to_regprocedure('search.rebuild_search_documents(text[])') IS NULL THEN
    RAISE NOTICE '195: search.rebuild_search_documents(text[]) missing — skip body rewrite';
  ELSE
    def := pg_get_functiondef('search.rebuild_search_documents(text[])'::regprocedure);
    IF def NOT ILIKE '%''settlements''%' THEN
      IF def LIKE '%''water_polygons'', ''land_area''%' THEN
        def := replace(def, '''water_polygons'', ''land_area''', '''water_polygons'', ''land_area'', ''settlements''');
      ELSIF def LIKE '%''water_polygons'', ''landuse''%' THEN
        def := replace(def, '''water_polygons'', ''landuse''', '''water_polygons'', ''landuse'', ''settlements''');
      ELSE
        RAISE EXCEPTION '195: could not insert settlements into rebuild_search_documents view list';
      END IF;
      EXECUTE def;
    END IF;
  END IF;

  IF to_regprocedure('search.sync_search_documents(text, bigint[])') IS NOT NULL THEN
    def := pg_get_functiondef('search.sync_search_documents(text, bigint[])'::regprocedure);
    IF def NOT ILIKE '%v_search_settlements_source%' THEN
      IF def ILIKE '%when ''street_group'' then ''v_search_street_groups_source''%' THEN
        def := replace(
          def,
          'when ''street_group'' then ''v_search_street_groups_source''',
          'when ''street_group'' then ''v_search_street_groups_source'''
            || E'\n        when ''settlement'' then ''v_search_settlements_source'''
        );
      ELSE
        RAISE EXCEPTION '195: could not insert settlement into sync_search_documents';
      END IF;
      IF def ILIKE '%street_group (legacy bus_* aliases accepted)%' THEN
        def := replace(
          def,
          'street_group (legacy bus_* aliases accepted)',
          'street_group, settlement (legacy bus_* aliases accepted)'
        );
      END IF;
      EXECUTE def;
    END IF;
  END IF;

  IF to_regprocedure('search.fetch_source_searchable_text(text, bigint)') IS NOT NULL THEN
    def := pg_get_functiondef('search.fetch_source_searchable_text(text, bigint)'::regprocedure);
    IF def NOT ILIKE '%v_search_settlements_source%' THEN
      IF def ILIKE '%when ''landuse'' then ''v_search_landuse_source''%' THEN
        def := replace(
          def,
          'when ''landuse'' then ''v_search_landuse_source''',
          'when ''landuse'' then ''v_search_landuse_source'''
            || E'\n        when ''land_area'' then ''v_search_land_area_source'''
            || E'\n        when ''settlement'' then ''v_search_settlements_source'''
        );
      ELSIF def ILIKE '%when ''land_area'' then ''v_search_land_area_source''%' THEN
        def := replace(
          def,
          'when ''land_area'' then ''v_search_land_area_source''',
          'when ''land_area'' then ''v_search_land_area_source'''
            || E'\n        when ''settlement'' then ''v_search_settlements_source'''
        );
      ELSE
        RAISE EXCEPTION '195: could not insert settlement into fetch_source_searchable_text';
      END IF;
      EXECUTE def;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Guardrails
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('tiles.tiles_settlements_v') IS NULL
     OR to_regclass('search.v_search_settlements_source') IS NULL
     OR to_regclass('search.v_search_places_source') IS NULL THEN
    RAISE EXCEPTION '195: required settlement tile/search views were not created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM search.v_search_places_source
    WHERE lower(btrim(COALESCE(category_code, ''))) IN (
      'settlement', 'city', 'town', 'village', 'hamlet',
      'suburb', 'quarter', 'neighbourhood', 'neighborhood', 'locality'
    )
    LIMIT 1
  ) THEN
    RAISE EXCEPTION '195: places search source still exposes legacy settlement categories';
  END IF;
END $$;

COMMIT;
