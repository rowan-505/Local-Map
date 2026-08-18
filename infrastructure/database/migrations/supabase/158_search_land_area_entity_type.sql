-- =============================================================================
-- Supabase migration 158: search land_area entity_type + source view rename
-- =============================================================================
-- Renames search.v_search_landuse_source → search.v_search_land_area_source
-- and migrates indexed entity_type landuse → land_area atomically.
-- Does NOT change PMTiles source-layer names.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '30min';

CREATE OR REPLACE VIEW search.v_search_land_area_source AS
SELECT
    'land_area'::text AS entity_type,
    lu.id AS entity_id,
    lu.public_id::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, lu.name, lc.name_en) AS display_name,
    COALESCE(lc.name_en, lu.class_code) AS subtitle,
    COALESCE(nm.name_my, lu.name, lc.name_mm) AS primary_name_my,
    COALESCE(nm.name_en, lu.name, lc.name_en) AS primary_name_en,
    COALESCE(lu.name, lc.name_en) AS primary_name_und,
    COALESCE(lc.code, lu.class_code) AS code,
    lu.external_id,
    COALESCE(lc.code, lu.class_code) AS category_code,
    lc.name_mm AS category_name_my,
    lc.name_en AS category_name_en,
    lu.admin_area_id,
    ctx.adm_my AS admin_area_name_my,
    ctx.adm_en AS admin_area_name_en,
    ctx.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(lu.geom) AS geometry_type,
    COALESCE(lu.centroid, search.safe_centroid(lu.geom)) AS centroid,
    search.safe_bbox(lu.geom) AS bbox,
    (COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL) AS has_geometry,
    (COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL) AS supports_plus_code,
    concat_ws(
      ' ',
      lu.name, nm.all_names, lc.name_en, lc.name_mm, lu.class_code,
      ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    COALESCE(lu.confidence_score, 0) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(lu.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(lu.is_active, false) AS is_active,
    lu.updated_at AS source_updated_at,
    COALESCE(nm.names_json, '[]'::jsonb) AS names
FROM core.core_land_areas lu
LEFT JOIN ref.ref_land_area_classes lc ON lc.id = lu.land_area_class_id
LEFT JOIN LATERAL (
    SELECT search.admin_area_name(lu.admin_area_id, 'my') AS adm_my,
           search.admin_area_name(lu.admin_area_id, 'en') AS adm_en,
           search.admin_area_hierarchy(lu.admin_area_id) AS hierarchy
) ctx ON true
LEFT JOIN LATERAL (
    SELECT
        (SELECT x.name FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                          WHEN x.is_primary THEN 2
                          WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                     x.search_weight DESC NULLS LAST, x.name
            LIMIT 1) AS name_my,
        (SELECT x.name FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                          WHEN x.is_primary THEN 2
                          WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                     x.search_weight DESC NULLS LAST, x.name
            LIMIT 1) AS name_en,
        (SELECT jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    ORDER BY x.is_primary DESC, x.name)
            FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS names_json,
        (SELECT string_agg(DISTINCT x.name, ' ')
            FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS all_names
) nm ON true
WHERE lu.deleted_at IS NULL
  AND COALESCE(lu.is_active, false) = true;

COMMENT ON VIEW search.v_search_land_area_source IS
  'Canonical search source for core.core_land_areas (entity_type=land_area).';

-- Compatibility alias for any leftover internal SQL that still names the old view.
CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT * FROM search.v_search_land_area_source;

COMMENT ON VIEW search.v_search_landuse_source IS
  'Compatibility alias for search.v_search_land_area_source. Prefer the land_area name.';

-- Migrate indexed documents atomically.
UPDATE search.search_documents
SET entity_type = 'land_area',
    updated_at = now()
WHERE entity_type = 'landuse';

-- Keep rebuild function on the new view name when present.
DO $$
DECLARE
  def text;
BEGIN
  IF to_regprocedure('search.rebuild_search_documents()') IS NULL THEN
    RAISE NOTICE '158: search.rebuild_search_documents() missing — skip body rewrite';
    RETURN;
  END IF;

  def := pg_get_functiondef('search.rebuild_search_documents()'::regprocedure);
  IF def ILIKE '%v_search_landuse_source%' AND def NOT ILIKE '%v_search_land_area_source%' THEN
    def := replace(def, 'search.v_search_landuse_source', 'search.v_search_land_area_source');
    EXECUTE def;
  END IF;
END $$;

-- Alias helper maps (if present from mig 131/134)
DO $$
BEGIN
  IF to_regclass('search.search_entity_type_alias') IS NOT NULL THEN
    UPDATE search.search_entity_type_alias
    SET canonical_entity_type = 'land_area'
    WHERE canonical_entity_type = 'landuse'
       OR alias_entity_type = 'landuse';
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- Backfill import_review candidate family slug for API list filters.
UPDATE import_review.land_area_candidates
SET entity_family = 'land_areas',
    updated_at = now()
WHERE entity_family = 'landuse';

COMMIT;

