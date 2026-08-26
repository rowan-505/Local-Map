-- =============================================================================
-- Supabase migration 197: repair unified-search runtime / health schema drift
-- =============================================================================
-- Forward-only production repair for environments where migration 158 did not
-- complete. Keeps land_area as the canonical API entity type and landuse as a
-- compatibility view name. Runtime document rebuild is intentionally separate.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

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
    SELECT
        search.admin_area_name(lu.admin_area_id, 'my') AS adm_my,
        search.admin_area_name(lu.admin_area_id, 'en') AS adm_en,
        search.admin_area_hierarchy(lu.admin_area_id) AS hierarchy
) ctx ON true
LEFT JOIN LATERAL (
    SELECT
        (
            SELECT x.name
            FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            ORDER BY
                CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                     WHEN x.is_primary THEN 2
                     WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                x.search_weight DESC NULLS LAST,
                x.name
            LIMIT 1
        ) AS name_my,
        (
            SELECT x.name
            FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            ORDER BY
                CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                     WHEN x.is_primary THEN 2
                     WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                x.search_weight DESC NULLS LAST,
                x.name
            LIMIT 1
        ) AS name_en,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'name', x.name,
                    'language_code', x.language_code,
                    'script_code', x.script_code,
                    'name_type', x.name_type,
                    'is_primary', x.is_primary,
                    'search_weight', coalesce(x.search_weight, 0)
                )
                ORDER BY x.is_primary DESC, x.name
            )
            FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
        ) AS names_json,
        (
            SELECT string_agg(DISTINCT x.name, ' ')
            FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
        ) AS all_names
) nm ON true
WHERE lu.deleted_at IS NULL
  AND COALESCE(lu.is_active, false) = true;

COMMENT ON VIEW search.v_search_land_area_source IS
    'Canonical search source for core.core_land_areas (entity_type=land_area).';

-- Preserve callers that still use the former source-view name.
CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT * FROM search.v_search_land_area_source;

-- Avoid unique-key conflicts in environments that briefly indexed both names.
DELETE FROM search.search_documents legacy
USING search.search_documents canonical
WHERE legacy.entity_type = 'landuse'
  AND canonical.entity_type = 'land_area'
  AND canonical.entity_id = legacy.entity_id;

UPDATE search.search_documents
SET entity_type = 'land_area'
WHERE entity_type = 'landuse';

-- Exact alias/name matching should not depend on the trigram operator path.
CREATE INDEX IF NOT EXISTS search_document_names_normalized_name_idx
    ON search.search_document_names (normalized_name)
    WHERE normalized_name IS NOT NULL;

-- Align the actual parameterized rebuild function with the canonical view key.
DO $block$
DECLARE
    def text;
BEGIN
    IF to_regprocedure('search.rebuild_search_documents(text[])') IS NULL THEN
        RAISE EXCEPTION '197: search.rebuild_search_documents(text[]) is missing';
    END IF;

    def := pg_get_functiondef('search.rebuild_search_documents(text[])'::regprocedure);
    def := replace(def, '''landuse''', '''land_area''');
    def := replace(def, 'search.v_search_landuse_source', 'search.v_search_land_area_source');
    EXECUTE def;
END
$block$;

DO $block$
BEGIN
    IF to_regclass('search.search_entity_type_alias') IS NOT NULL THEN
        UPDATE search.search_entity_type_alias
        SET canonical_entity_type = 'land_area'
        WHERE canonical_entity_type = 'landuse'
           OR alias_entity_type = 'landuse';
    END IF;
END
$block$;

DO $block$
BEGIN
    IF to_regclass('import_review.land_area_candidates') IS NOT NULL THEN
        UPDATE import_review.land_area_candidates
        SET entity_family = 'land_areas', updated_at = now()
        WHERE entity_family = 'landuse';
    END IF;
END
$block$;

DO $block$
DECLARE
    rebuild_def text;
BEGIN
    IF to_regclass('search.v_search_land_area_source') IS NULL
       OR to_regclass('search.v_search_landuse_source') IS NULL THEN
        RAISE EXCEPTION '197: required land-area search views are missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM search.search_documents WHERE entity_type = 'landuse'
    ) THEN
        RAISE EXCEPTION '197: legacy landuse search documents remain';
    END IF;

    rebuild_def := pg_get_functiondef('search.rebuild_search_documents(text[])'::regprocedure);
    IF rebuild_def NOT ILIKE '%''land_area''%' THEN
        RAISE EXCEPTION '197: rebuild function does not accept land_area';
    END IF;
END
$block$;

COMMIT;

-- Post-deploy operation (outside the migration transaction):
--   SELECT search.rebuild_search_documents(ARRAY[
--     'places', 'settlements', 'admin_areas', 'street_groups', 'addresses',
--     'bus_stops', 'bus_routes', 'transport_terminals', 'buildings',
--     'water_lines', 'water_polygons', 'land_area'
--   ]);
