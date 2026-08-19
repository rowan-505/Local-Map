-- Phase 4 (land/water): normalized FK classifications are authoritative.
-- No geometry update and no table rewrite. Legacy API response fields remain
-- available from ref-table joins in the Fastify API.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  null_land bigint;
  null_lines bigint;
  null_polygons bigint;
  orphan_land bigint;
  orphan_lines bigint;
  orphan_polygons bigint;
BEGIN
  SELECT count(*) INTO null_land FROM core.core_land_areas WHERE land_area_class_id IS NULL;
  SELECT count(*) INTO null_lines FROM core.core_water_lines WHERE water_class_id IS NULL;
  SELECT count(*) INTO null_polygons FROM core.core_water_polygons WHERE water_class_id IS NULL;
  SELECT count(*) INTO orphan_land
  FROM core.core_land_areas x
  WHERE NOT EXISTS (SELECT 1 FROM ref.ref_land_area_classes r WHERE r.id = x.land_area_class_id);
  SELECT count(*) INTO orphan_lines
  FROM core.core_water_lines x
  WHERE NOT EXISTS (SELECT 1 FROM ref.ref_water_classes r WHERE r.id = x.water_class_id);
  SELECT count(*) INTO orphan_polygons
  FROM core.core_water_polygons x
  WHERE NOT EXISTS (SELECT 1 FROM ref.ref_water_classes r WHERE r.id = x.water_class_id);

  IF null_land + null_lines + null_polygons + orphan_land + orphan_lines + orphan_polygons <> 0 THEN
    RAISE EXCEPTION
      '172 refused: null ids land=% lines=% polygons=%; orphan ids land=% lines=% polygons=%',
      null_land, null_lines, null_polygons, orphan_land, orphan_lines, orphan_polygons;
  END IF;
END $$;

-- Preserve every non-canonical water text classification explicitly before the
-- legacy columns are removed. This currently affects only 46 rows.
UPDATE core.core_water_lines AS w
SET normalized_data = jsonb_set(
      coalesce(w.normalized_data, '{}'::jsonb),
      '{legacy_classification}',
      coalesce(w.normalized_data->'legacy_classification', '{}'::jsonb)
        || jsonb_build_object('class_code', w.class_code),
      true
    )
FROM ref.ref_water_classes AS wc
WHERE wc.id = w.water_class_id
  AND nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code;

UPDATE core.core_water_polygons AS w
SET normalized_data = jsonb_set(
      coalesce(w.normalized_data, '{}'::jsonb),
      '{legacy_classification}',
      coalesce(w.normalized_data->'legacy_classification', '{}'::jsonb)
        || jsonb_build_object('class_code', w.class_code),
      true
    )
FROM ref.ref_water_classes AS wc
WHERE wc.id = w.water_class_id
  AND nullif(btrim(w.class_code), '') IS DISTINCT FROM wc.code;

CREATE OR REPLACE VIEW tiles.tiles_water_lines_v AS
SELECT
  w.id,
  w.name,
  wc.code AS waterway_class,
  wc.code AS water_class_code,
  wc.name_en AS water_class_name_en,
  wc.name_mm AS water_class_name_mm,
  w.geom
FROM core.core_water_lines AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
WHERE w.is_active IS TRUE
  AND w.deleted_at IS NULL
  AND w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom);

CREATE OR REPLACE VIEW tiles.tiles_water_polygons_v AS
SELECT
  w.id,
  w.name,
  wc.code AS water_class,
  wc.code AS water_class_code,
  wc.name_en AS water_class_name_en,
  wc.name_mm AS water_class_name_mm,
  w.geom
FROM core.core_water_polygons AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
WHERE w.is_active IS TRUE
  AND w.deleted_at IS NULL
  AND w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom);

CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT
  'landuse'::text AS entity_type,
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
  COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL AS has_geometry,
  COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL AS supports_plus_code,
  concat_ws(' ', lu.name, nm.all_names, lc.name_en, lc.name_mm, lc.code,
    ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)) AS searchable_text,
  0::numeric AS importance_score,
  0::numeric AS popularity_score,
  COALESCE(lu.confidence_score, 0) AS confidence_score,
  0::numeric AS boundary_confidence_score,
  COALESCE(lu.is_verified, false) AS is_verified,
  true AS is_public,
  COALESCE(lu.is_active, false) AS is_active,
  lu.updated_at AS source_updated_at,
  COALESCE(nm.names_json, '[]'::jsonb) AS names
FROM core.core_land_areas AS lu
JOIN ref.ref_land_area_classes AS lc ON lc.id = lu.land_area_class_id
LEFT JOIN LATERAL (
  SELECT search.admin_area_name(lu.admin_area_id, 'my') AS adm_my,
         search.admin_area_name(lu.admin_area_id, 'en') AS adm_en,
         search.admin_area_hierarchy(lu.admin_area_id) AS hierarchy
) AS ctx ON true
LEFT JOIN LATERAL (
  SELECT
    (SELECT x.name FROM core.core_land_area_names x
      WHERE x.land_area_id = lu.id
        AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                    WHEN x.is_primary THEN 2
                    WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
               x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_my,
    (SELECT x.name FROM core.core_land_area_names x
      WHERE x.land_area_id = lu.id
        AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                    WHEN x.is_primary THEN 2
                    WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
               x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_en,
    (SELECT jsonb_agg(jsonb_build_object(
      'name', x.name, 'language_code', x.language_code, 'script_code', x.script_code,
      'name_type', x.name_type, 'is_primary', x.is_primary,
      'search_weight', coalesce(x.search_weight, 0))
      ORDER BY x.is_primary DESC, x.name)
      FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS names_json,
    (SELECT string_agg(DISTINCT x.name, ' ')
      FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS all_names
) AS nm ON true
WHERE lu.deleted_at IS NULL
  AND lu.is_active = true
  AND lu.geom IS NOT NULL
  AND NOT ST_IsEmpty(lu.geom)
  AND (nullif(btrim(lu.name), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM core.core_land_area_names x WHERE x.land_area_id = lu.id));

CREATE OR REPLACE VIEW search.v_search_water_lines_source AS
SELECT
  'water_line'::text AS entity_type, w.id AS entity_id, NULL::text AS public_id,
  COALESCE(nm.name_en, nm.name_my, w.name) AS display_name,
  COALESCE(wc.name_en, 'Waterway') AS subtitle,
  COALESCE(nm.name_my, w.name) AS primary_name_my,
  COALESCE(nm.name_en, w.name) AS primary_name_en,
  w.name AS primary_name_und,
  wc.code, w.external_id, wc.code AS category_code,
  wc.name_mm AS category_name_my, wc.name_en AS category_name_en,
  NULL::bigint AS admin_area_id, NULL::text AS admin_area_name_my,
  NULL::text AS admin_area_name_en, '{}'::jsonb AS admin_hierarchy,
  NULL::text AS address_text, NULL::jsonb AS address_parts,
  geometrytype(w.geom) AS geometry_type,
  search.safe_centroid(w.geom) AS centroid, search.safe_bbox(w.geom) AS bbox,
  search.safe_centroid(w.geom) IS NOT NULL AS has_geometry,
  search.safe_centroid(w.geom) IS NOT NULL AS supports_plus_code,
  concat_ws(' ', w.name, nm.all_names, wc.name_en, wc.name_mm, wc.code) AS searchable_text,
  0::numeric AS importance_score, 0::numeric AS popularity_score,
  0::numeric AS confidence_score, 0::numeric AS boundary_confidence_score,
  COALESCE(w.is_verified, false) AS is_verified, true AS is_public,
  COALESCE(w.is_active, false) AS is_active, w.updated_at AS source_updated_at,
  COALESCE(nm.names_json, '[]'::jsonb) AS names
FROM core.core_water_lines AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
LEFT JOIN LATERAL (
  SELECT
    (SELECT x.name FROM core.core_water_line_names x WHERE x.water_line_id = w.id
      AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1 WHEN x.is_primary THEN 2 WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
        x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_my,
    (SELECT x.name FROM core.core_water_line_names x WHERE x.water_line_id = w.id
      AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1 WHEN x.is_primary THEN 2 WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
        x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_en,
    (SELECT jsonb_agg(jsonb_build_object('name', x.name, 'language_code', x.language_code,
      'script_code', x.script_code, 'name_type', x.name_type, 'is_primary', x.is_primary,
      'search_weight', coalesce(x.search_weight, 0)) ORDER BY x.is_primary DESC, x.name)
      FROM core.core_water_line_names x WHERE x.water_line_id = w.id) AS names_json,
    (SELECT string_agg(DISTINCT x.name, ' ') FROM core.core_water_line_names x
      WHERE x.water_line_id = w.id) AS all_names
) AS nm ON true
WHERE w.deleted_at IS NULL AND w.is_active = true AND w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom)
  AND (nullif(btrim(w.name), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM core.core_water_line_names x WHERE x.water_line_id = w.id));

CREATE OR REPLACE VIEW search.v_search_water_polygons_source AS
SELECT
  'water_polygon'::text AS entity_type, w.id AS entity_id, NULL::text AS public_id,
  COALESCE(nm.name_en, nm.name_my, w.name) AS display_name,
  COALESCE(wc.name_en, 'Water') AS subtitle,
  COALESCE(nm.name_my, w.name) AS primary_name_my,
  COALESCE(nm.name_en, w.name) AS primary_name_en,
  w.name AS primary_name_und,
  wc.code, w.external_id, wc.code AS category_code,
  wc.name_mm AS category_name_my, wc.name_en AS category_name_en,
  NULL::bigint AS admin_area_id, NULL::text AS admin_area_name_my,
  NULL::text AS admin_area_name_en, '{}'::jsonb AS admin_hierarchy,
  NULL::text AS address_text, NULL::jsonb AS address_parts,
  geometrytype(w.geom) AS geometry_type,
  search.safe_centroid(w.geom) AS centroid, search.safe_bbox(w.geom) AS bbox,
  search.safe_centroid(w.geom) IS NOT NULL AS has_geometry,
  search.safe_centroid(w.geom) IS NOT NULL AS supports_plus_code,
  concat_ws(' ', w.name, nm.all_names, wc.name_en, wc.name_mm, wc.code) AS searchable_text,
  0::numeric AS importance_score, 0::numeric AS popularity_score,
  0::numeric AS confidence_score, 0::numeric AS boundary_confidence_score,
  COALESCE(w.is_verified, false) AS is_verified, true AS is_public,
  COALESCE(w.is_active, false) AS is_active, w.updated_at AS source_updated_at,
  COALESCE(nm.names_json, '[]'::jsonb) AS names
FROM core.core_water_polygons AS w
JOIN ref.ref_water_classes AS wc ON wc.id = w.water_class_id
LEFT JOIN LATERAL (
  SELECT
    (SELECT x.name FROM core.core_water_polygon_names x WHERE x.water_polygon_id = w.id
      AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1 WHEN x.is_primary THEN 2 WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
        x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_my,
    (SELECT x.name FROM core.core_water_polygon_names x WHERE x.water_polygon_id = w.id
      AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
      ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1 WHEN x.is_primary THEN 2 WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
        x.search_weight DESC NULLS LAST, x.name LIMIT 1) AS name_en,
    (SELECT jsonb_agg(jsonb_build_object('name', x.name, 'language_code', x.language_code,
      'script_code', x.script_code, 'name_type', x.name_type, 'is_primary', x.is_primary,
      'search_weight', coalesce(x.search_weight, 0)) ORDER BY x.is_primary DESC, x.name)
      FROM core.core_water_polygon_names x WHERE x.water_polygon_id = w.id) AS names_json,
    (SELECT string_agg(DISTINCT x.name, ' ') FROM core.core_water_polygon_names x
      WHERE x.water_polygon_id = w.id) AS all_names
) AS nm ON true
WHERE w.deleted_at IS NULL AND w.is_active = true AND w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom)
  AND (nullif(btrim(w.name), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM core.core_water_polygon_names x WHERE x.water_polygon_id = w.id));

ALTER TABLE core.core_land_areas ALTER COLUMN land_area_class_id SET NOT NULL;
ALTER TABLE core.core_water_lines ALTER COLUMN water_class_id SET NOT NULL;
ALTER TABLE core.core_water_polygons ALTER COLUMN water_class_id SET NOT NULL;

ALTER TABLE core.core_land_areas DROP COLUMN class_code;
ALTER TABLE core.core_water_lines DROP COLUMN class_code;
ALTER TABLE core.core_water_polygons DROP COLUMN class_code;

COMMENT ON COLUMN core.core_land_areas.land_area_class_id IS
  'Authoritative land-area classification FK to ref.ref_land_area_classes.';
COMMENT ON COLUMN core.core_water_lines.water_class_id IS
  'Authoritative water classification FK to ref.ref_water_classes.';
COMMENT ON COLUMN core.core_water_polygons.water_class_id IS
  'Authoritative water classification FK to ref.ref_water_classes.';

COMMIT;
