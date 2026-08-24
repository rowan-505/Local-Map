-- =============================================================================
-- verify_195_settlements_tiles_and_search.sql
-- -----------------------------------------------------------------------------
-- Checks tiles.tiles_settlements_v + search.v_search_settlements_source wiring.
-- Does NOT rebuild the index. Safe to run after migration 195.
--
-- Run:
--   PAGER=cat psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/verification/verify_195_settlements_tiles_and_search.sql
-- =============================================================================

\pset pager off

SELECT
  to_regclass('tiles.tiles_settlements_v') IS NOT NULL AS tiles_view_exists,
  to_regclass('search.v_search_settlements_source') IS NOT NULL AS search_view_exists,
  to_regclass('search.v_search_places_source_unfiltered') IS NOT NULL AS places_unfiltered_exists;

SELECT
  COUNT(*) FILTER (WHERE attname IN ('id', 'public_id', 'settlement_type', 'name', 'name_mm', 'name_en', 'geom', 'importance_score', 'min_zoom')) AS required_tile_cols,
  COUNT(*) FILTER (WHERE attname IN ('source_refs', 'footprint_geom', 'normalized_data')) AS forbidden_tile_cols
FROM pg_attribute
WHERE attrelid = 'tiles.tiles_settlements_v'::regclass
  AND attnum > 0
  AND NOT attisdropped;

SELECT
  (SELECT COUNT(*) FROM tiles.tiles_settlements_v) AS tile_rows,
  (SELECT COUNT(*) FROM search.v_search_settlements_source) AS search_settlement_rows,
  (SELECT COUNT(*) FROM search.v_search_places_source
     WHERE lower(btrim(COALESCE(category_code, ''))) IN (
       'settlement', 'city', 'town', 'village', 'hamlet',
       'suburb', 'quarter', 'neighbourhood', 'neighborhood', 'locality'
     )) AS leftover_place_settlement_rows;

SELECT st.code, COUNT(*) AS n
FROM search.v_search_settlements_source s
JOIN core.core_settlements cs ON cs.id = s.entity_id
JOIN ref.ref_settlement_types st ON st.id = cs.settlement_type_id
GROUP BY st.code
ORDER BY st.code;

SELECT pg_get_functiondef('search.rebuild_search_documents(text[])'::regprocedure)
  LIKE '%settlements%' AS rebuild_accepts_settlements;
