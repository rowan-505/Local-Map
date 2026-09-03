-- =============================================================================
-- Supabase migration 199: search eligibility, named land, folded route codes
-- =============================================================================
--
-- 1. Ensure search.v_search_land_area_source exists (197 may not be applied) and
--    restore named + geom filters so unnamed land polygons are not indexed.
--    Do not reference core.core_land_areas.class_code (dropped in 172).
-- 2. Allow imported_unreviewed rows into unified search (still hide rejected).
-- 3. Fold YBS-37 / YBS 37 into route searchable text and names.
--
-- Does NOT activate YBS routes (is_active). That is an audited API script.
-- Does NOT rebuild search.search_documents.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION search.transport_search_review_status_searchable(p_review_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO pg_catalog, public, extensions, core, ref, system, import_review, search, transport, routing, tiles, app_auth
AS $$
    SELECT coalesce(p_review_status, '') IN (
        'reviewed',
        'verified',
        'manual_protected',
        'needs_review',
        'imported_unreviewed'
    );
$$;

COMMENT ON FUNCTION search.transport_search_review_status_searchable(text) IS
    'True when a transport row review_status is eligible for unified public search indexing. Excludes rejected. Inactive/deleted rows are filtered in source views.';

CREATE OR REPLACE FUNCTION search.folded_route_code_text(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO pg_catalog, public, extensions, search
AS $$
    SELECT NULLIF(btrim(replace(replace(coalesce(p_code, ''), '-', ' '), '_', ' ')), '');
$$;

COMMENT ON FUNCTION search.folded_route_code_text(text) IS
    'Space-folded route code for search text (YBS-37 -> YBS 37). Does not emit a bare number.';

CREATE OR REPLACE FUNCTION search.folded_route_code_names(p_code text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO pg_catalog, public, extensions, search
AS $$
    SELECT CASE
        WHEN NULLIF(btrim(coalesce(p_code, '')), '') IS NULL THEN '[]'::jsonb
        WHEN lower(btrim(search.folded_route_code_text(p_code))) = lower(btrim(p_code)) THEN '[]'::jsonb
        ELSE jsonb_build_array(
            jsonb_build_object(
                'name', search.folded_route_code_text(p_code),
                'language_code', 'und',
                'script_code', NULL,
                'name_type', 'alias',
                'is_primary', false,
                'search_weight', 40
            )
        )
    END;
$$;

COMMENT ON FUNCTION search.folded_route_code_names(text) IS
    'Extra search_document_names payload for the space-folded route code. Empty when fold equals the stored code.';

-- Named + geom land_area source (canonical). landuse remains a compatibility alias.
CREATE OR REPLACE VIEW search.v_search_land_area_source AS
SELECT
    'land_area'::text AS entity_type,
    lu.id AS entity_id,
    lu.public_id::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, lu.name, lc.name_en) AS display_name,
    lc.name_en AS subtitle,
    COALESCE(nm.name_my, lu.name, lc.name_mm) AS primary_name_my,
    COALESCE(nm.name_en, lu.name, lc.name_en) AS primary_name_en,
    COALESCE(lu.name, lc.name_en) AS primary_name_und,
    lc.code,
    lu.external_id,
    lc.code AS category_code,
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
        lu.name, nm.all_names, lc.name_en, lc.name_mm, lc.code,
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
INNER JOIN ref.ref_land_area_classes lc ON lc.id = lu.land_area_class_id
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
  AND COALESCE(lu.is_active, false) = true
  AND lu.geom IS NOT NULL
  AND NOT ST_IsEmpty(lu.geom)
  AND (
      NULLIF(btrim(lu.name), '') IS NOT NULL
      OR EXISTS (
          SELECT 1
          FROM core.core_land_area_names x
          WHERE x.land_area_id = lu.id
            AND NULLIF(btrim(x.name), '') IS NOT NULL
      )
  );

COMMENT ON VIEW search.v_search_land_area_source IS
    'Canonical search source for named core.core_land_areas (entity_type=land_area). Unnamed polygons are excluded.';

CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT * FROM search.v_search_land_area_source;

COMMENT ON VIEW search.v_search_landuse_source IS
    'Compatibility alias for search.v_search_land_area_source.';

DELETE FROM search.search_documents legacy
USING search.search_documents canonical
WHERE legacy.entity_type = 'landuse'
  AND canonical.entity_type = 'land_area'
  AND canonical.entity_id = legacy.entity_id;

UPDATE search.search_documents
SET entity_type = 'land_area'
WHERE entity_type = 'landuse';

DO $block$
BEGIN
    IF to_regclass('search.v_search_bus_routes_source_base') IS NULL
       AND to_regclass('search.v_search_bus_routes_source') IS NOT NULL THEN
        EXECUTE 'ALTER VIEW search.v_search_bus_routes_source RENAME TO v_search_bus_routes_source_base';
    END IF;
END
$block$;

CREATE OR REPLACE VIEW search.v_search_bus_routes_source AS
SELECT
    u.entity_type,
    u.entity_id,
    u.public_id,
    u.display_name,
    u.subtitle,
    u.primary_name_my,
    u.primary_name_en,
    u.primary_name_und,
    u.code,
    u.external_id,
    u.category_code,
    u.category_name_my,
    u.category_name_en,
    u.admin_area_id,
    u.admin_area_name_my,
    u.admin_area_name_en,
    u.admin_hierarchy,
    u.address_text,
    u.address_parts,
    u.geometry_type,
    u.centroid,
    u.bbox,
    u.has_geometry,
    u.supports_plus_code,
    concat_ws(' ', u.searchable_text, search.folded_route_code_text(u.code)) AS searchable_text,
    u.importance_score,
    u.popularity_score,
    u.confidence_score,
    u.boundary_confidence_score,
    u.is_verified,
    u.is_public,
    u.is_active,
    u.source_updated_at,
    COALESCE(u.names, '[]'::jsonb) || search.folded_route_code_names(u.code) AS names
FROM search.v_search_bus_routes_source_base u;

COMMENT ON VIEW search.v_search_bus_routes_source IS
    'Transport route/variant search source with space-folded route codes (YBS-37 / YBS 37).';

COMMENT ON VIEW search.v_search_bus_stops_source IS
    'Search indexer source for transport stops (entity_type=transport_stop). Excludes rejected, inactive, and deleted.';

COMMENT ON VIEW search.v_search_transport_terminals_source IS
    'Search indexer source for transport terminals. Excludes rejected, inactive, and deleted.';

DO $block$
DECLARE
    def text;
BEGIN
    IF to_regprocedure('search.rebuild_search_documents(text[])') IS NULL THEN
        RAISE NOTICE '199: search.rebuild_search_documents(text[]) missing — skip body rewrite';
    ELSE
        def := pg_get_functiondef('search.rebuild_search_documents(text[])'::regprocedure);
        -- Accept both rebuild keys. Re-applying must not duplicate land_area.
        -- Keep landuse so format('v_search_%s_source') still resolves the alias view.
        IF def NOT LIKE '%''land_area''%' THEN
            def := replace(def, '''landuse''', '''land_area'', ''landuse''');
            EXECUTE def;
        END IF;
    END IF;
END
$block$;

DO $block$
BEGIN
    IF search.transport_search_review_status_searchable('imported_unreviewed') IS NOT TRUE THEN
        RAISE EXCEPTION '199: imported_unreviewed must be searchable';
    END IF;
    IF search.transport_search_review_status_searchable('rejected') IS NOT FALSE THEN
        RAISE EXCEPTION '199: rejected must stay unsearchable';
    END IF;
    IF search.folded_route_code_text('YBS-37') IS DISTINCT FROM 'YBS 37' THEN
        RAISE EXCEPTION '199: folded_route_code_text(YBS-37) expected YBS 37';
    END IF;
    IF to_regclass('search.v_search_land_area_source') IS NULL
       OR to_regclass('search.v_search_bus_routes_source') IS NULL THEN
        RAISE EXCEPTION '199: required search views are missing';
    END IF;
END
$block$;

COMMIT;
