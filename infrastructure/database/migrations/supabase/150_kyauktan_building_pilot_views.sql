-- =============================================================================
-- Kyauktan building pilot: lean tile contract, canonical name fallback, search
-- eligibility, and reverse POI-link lookup.
--
-- This migration changes no building, name, or place-building relationship rows.
-- It is safe to apply after 149_core_map_buildings_source_identity.sql.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- CREATE OR REPLACE VIEW cannot remove legacy columns. Refuse to drop the view
-- if another database view has acquired a dependency since the pilot audit.
DO $$
DECLARE
    dependent_views text;
BEGIN
    SELECT string_agg(format('%I.%I', dependent_schema.nspname, dependent.relname), ', ')
    INTO dependent_views
    FROM pg_depend AS dependency
    JOIN pg_rewrite AS rewrite
      ON rewrite.oid = dependency.objid
    JOIN pg_class AS dependent
      ON dependent.oid = rewrite.ev_class
    JOIN pg_namespace AS dependent_schema
      ON dependent_schema.oid = dependent.relnamespace
    WHERE dependency.refobjid = 'tiles.tiles_buildings_v'::regclass
      AND dependent.oid <> dependency.refobjid;

    IF dependent_views IS NOT NULL THEN
        RAISE EXCEPTION
            'tiles.tiles_buildings_v has dependent views: %',
            dependent_views;
    END IF;
END
$$;

DROP VIEW tiles.tiles_buildings_v;

CREATE VIEW tiles.tiles_buildings_v AS
SELECT
    building.id,
    building.public_id,
    building.region_code,
    name_my.name AS name_my,
    name_en.name AS name_en,
    name_und.name AS name_und,
    coalesce(
        nullif(btrim(name_my.name), ''),
        nullif(btrim(name_en.name), ''),
        nullif(btrim(name_und.name), ''),
        nullif(btrim(building.name), '')
    ) AS name,
    building_type.code AS building_type_code,
    building.levels,
    building.height_m,
    building.geom
FROM core.core_map_buildings AS building
LEFT JOIN ref.ref_building_types AS building_type
  ON building_type.id = building.building_type_id
 AND building_type.is_active IS TRUE
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND (
          lower(btrim(building_name.language_code)) IN ('my', 'mm')
          OR upper(btrim(coalesce(building_name.script_code, ''))) = 'MYMR'
      )
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official'
             AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type <> 'imported'
             AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'official' THEN 2
            WHEN building_name.name_type = 'imported'
             AND building_name.is_primary IS TRUE THEN 3
            WHEN building_name.name_type = 'imported' THEN 4
            ELSE 5
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_my ON true
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND (
          lower(btrim(building_name.language_code)) = 'en'
          OR upper(btrim(coalesce(building_name.script_code, ''))) = 'LATN'
      )
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official'
             AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type <> 'imported'
             AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'official' THEN 2
            WHEN building_name.name_type = 'imported'
             AND building_name.is_primary IS TRUE THEN 3
            WHEN building_name.name_type = 'imported' THEN 4
            ELSE 5
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_en ON true
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND lower(btrim(building_name.language_code)) = 'und'
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official'
             AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type <> 'imported'
             AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'official' THEN 2
            WHEN building_name.name_type = 'imported'
             AND building_name.is_primary IS TRUE THEN 3
            WHEN building_name.name_type = 'imported' THEN 4
            ELSE 5
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_und ON true
WHERE building.is_active IS TRUE
  AND building.deleted_at IS NULL;

COMMENT ON VIEW tiles.tiles_buildings_v IS
    'Lean building tile source: stable IDs, region, canonical my/en/und label fallback, render attributes, and geometry.';

REVOKE ALL ON TABLE tiles.tiles_buildings_v FROM PUBLIC;

-- Already present in the live database from migration 008. Keep the pilot
-- migration idempotent for drifted/local databases.
CREATE INDEX IF NOT EXISTS core_place_buildings_building_id_idx
    ON core.core_place_buildings (building_id);

-- Keep the exact 34-column unified-search source contract. Imported child names
-- are eligible only as name fallbacks; rows still need a real inline/child name.
CREATE OR REPLACE VIEW search.v_search_buildings_source AS
SELECT
    'building'::text AS entity_type,
    building.id AS entity_id,
    building.public_id::text AS public_id,
    coalesce(names.name_my, names.name_en, names.name_und, building.name) AS display_name,
    building_type.name AS subtitle,
    names.name_my AS primary_name_my,
    names.name_en AS primary_name_en,
    coalesce(names.name_und, building.name) AS primary_name_und,
    NULL::text AS code,
    building.external_id,
    building_type.code AS category_code,
    building_type.name_mm AS category_name_my,
    building_type.name AS category_name_en,
    building.admin_area_id,
    admin_context.adm_my AS admin_area_name_my,
    admin_context.adm_en AS admin_area_name_en,
    admin_context.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(building.geom) AS geometry_type,
    coalesce(building.centroid, search.safe_centroid(building.geom)) AS centroid,
    search.safe_bbox(building.geom) AS bbox,
    (coalesce(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL) AS has_geometry,
    (coalesce(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL) AS supports_plus_code,
    concat_ws(
        ' ',
        building.name,
        names.all_names,
        building_type.name,
        building_type.name_mm,
        admin_context.adm_en,
        admin_context.adm_my,
        search.hierarchy_text(admin_context.hierarchy)
    ) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    coalesce(building.confidence_score, 0) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    coalesce(building.is_verified, false) AS is_verified,
    true AS is_public,
    coalesce(building.is_active, false) AS is_active,
    building.updated_at AS source_updated_at,
    coalesce(names.names_json, '[]'::jsonb) AS names
FROM core.core_map_buildings AS building
LEFT JOIN ref.ref_building_types AS building_type
  ON building_type.id = building.building_type_id
LEFT JOIN LATERAL (
    SELECT
        search.admin_area_name(building.admin_area_id, 'my') AS adm_my,
        search.admin_area_name(building.admin_area_id, 'en') AS adm_en,
        search.admin_area_hierarchy(building.admin_area_id) AS hierarchy
) AS admin_context ON true
LEFT JOIN LATERAL (
    SELECT
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND (
                  lower(btrim(building_name.language_code)) IN ('my', 'mm')
                  OR upper(btrim(coalesce(building_name.script_code, ''))) = 'MYMR'
              )
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official'
                     AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type <> 'imported'
                     AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'official' THEN 2
                    WHEN building_name.name_type = 'imported'
                     AND building_name.is_primary IS TRUE THEN 3
                    WHEN building_name.name_type = 'imported' THEN 4
                    ELSE 5
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_my,
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND (
                  lower(btrim(building_name.language_code)) = 'en'
                  OR upper(btrim(coalesce(building_name.script_code, ''))) = 'LATN'
              )
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official'
                     AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type <> 'imported'
                     AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'official' THEN 2
                    WHEN building_name.name_type = 'imported'
                     AND building_name.is_primary IS TRUE THEN 3
                    WHEN building_name.name_type = 'imported' THEN 4
                    ELSE 5
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_en,
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND lower(btrim(building_name.language_code)) = 'und'
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official'
                     AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type <> 'imported'
                     AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'official' THEN 2
                    WHEN building_name.name_type = 'imported'
                     AND building_name.is_primary IS TRUE THEN 3
                    WHEN building_name.name_type = 'imported' THEN 4
                    ELSE 5
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_und,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'name', building_name.name,
                    'language_code', building_name.language_code,
                    'script_code', building_name.script_code,
                    'name_type', building_name.name_type,
                    'is_primary', building_name.is_primary,
                    'search_weight', coalesce(building_name.search_weight, 0)
                )
                ORDER BY building_name.is_primary DESC, building_name.name
            )
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
        ) AS names_json,
        (
            SELECT string_agg(DISTINCT building_name.name, ' ')
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND nullif(btrim(building_name.name), '') IS NOT NULL
        ) AS all_names
) AS names ON true
WHERE building.deleted_at IS NULL
  AND building.is_active IS TRUE
  AND building.geom IS NOT NULL
  AND NOT st_isempty(building.geom)
  AND (
      nullif(btrim(building.name), '') IS NOT NULL
      OR EXISTS (
          SELECT 1
          FROM core.core_map_building_names AS building_name
          WHERE building_name.building_id = building.id
            AND nullif(btrim(building_name.name), '') IS NOT NULL
      )
  );

COMMENT ON VIEW search.v_search_buildings_source IS
    'Named active building search source. Ordinary unnamed footprints remain excluded; official/manual names precede imported my/en/und fallbacks.';

COMMIT;
