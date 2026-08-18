-- =============================================================================
-- Supabase migration 159: land-area classification source of truth = FK → ref
-- =============================================================================
--
-- Goal:
--   tiles + search classify via core.core_land_areas.land_area_class_id
--   → ref.ref_land_area_classes.code (not legacy core.core_land_areas.class_code).
--
-- Does NOT:
--   drop class_code or name columns
--   rewrite row data / geometry / names
--   rename PMTiles source-layer tiles_landuse_v
--   rename search view / entity_type (still landuse for this task)
--   start protected-area migration
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- 0) Baseline counts (assert unchanged at end)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m159_before ON COMMIT DROP AS
SELECT
  (SELECT count(*)::bigint FROM core.core_land_areas) AS land_areas,
  (SELECT count(*)::bigint FROM core.core_land_areas WHERE deleted_at IS NULL) AS active,
  (SELECT count(*)::bigint FROM core.core_land_areas WHERE deleted_at IS NULL AND is_active) AS active_flag,
  (SELECT count(*)::bigint FROM core.core_land_area_names) AS names,
  (SELECT count(*)::bigint FROM tiles.tiles_landuse_v) AS tile_rows,
  (SELECT count(*)::bigint FROM search.v_search_landuse_source) AS search_rows,
  (SELECT count(*)::bigint
     FROM core.core_land_areas
    WHERE deleted_at IS NULL AND land_area_class_id IS NULL) AS null_fk_active,
  (SELECT count(*)::bigint
     FROM core.core_land_areas a
    WHERE a.deleted_at IS NULL
      AND a.land_area_class_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ref.ref_land_area_classes r WHERE r.id = a.land_area_class_id
      )) AS invalid_fk_active,
  (SELECT count(*)::bigint
     FROM core.core_land_areas a
     JOIN ref.ref_land_area_classes r ON r.id = a.land_area_class_id
    WHERE a.deleted_at IS NULL
      AND lower(btrim(coalesce(a.class_code, ''))) IS DISTINCT FROM lower(btrim(r.code))
  ) AS class_code_mismatch_active;

DO $$
DECLARE
  b _m159_before%ROWTYPE;
BEGIN
  SELECT * INTO b FROM _m159_before;
  IF b.null_fk_active > 0 THEN
    RAISE EXCEPTION '159: refuse — % active rows have null land_area_class_id', b.null_fk_active;
  END IF;
  IF b.invalid_fk_active > 0 THEN
    RAISE EXCEPTION '159: refuse — % active rows have invalid land_area_class_id', b.invalid_fk_active;
  END IF;
  RAISE NOTICE '159 baseline: land_areas=% active=% tile_rows=% search_rows=% mismatch=%',
    b.land_areas, b.active, b.tile_rows, b.search_rows, b.class_code_mismatch_active;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Mark legacy class_code deprecated (column kept)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN core.core_land_areas.class_code IS
  'DEPRECATED compatibility mirror of ref.ref_land_area_classes.code. '
  'Authoritative classification is land_area_class_id → ref.ref_land_area_classes. '
  'Do not use class_code as the primary source for tiles, search, API category, or imports.';

COMMENT ON COLUMN core.core_land_areas.land_area_class_id IS
  'Authoritative land-area classification FK → ref.ref_land_area_classes.id. '
  'Tiles, search, API, and imports must resolve category through this column.';

-- ---------------------------------------------------------------------------
-- 2) tiles.tiles_landuse_v — landuse_class from ref.code
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS tiles.tiles_landuse_v;
CREATE VIEW tiles.tiles_landuse_v AS
SELECT
  l.id,
  l.name,
  -- Compatibility attribute for existing PMTiles / style.json (source-layer unchanged).
  lc.code AS landuse_class,
  lc.code AS land_area_class_code,
  lc.name_en AS land_area_class_name_en,
  lc.name_mm AS land_area_class_name_mm,
  l.geom
FROM core.core_land_areas AS l
INNER JOIN ref.ref_land_area_classes AS lc
  ON lc.id = l.land_area_class_id
WHERE l.is_active IS TRUE
  AND l.deleted_at IS NULL
  AND l.geom IS NOT NULL
  AND NOT ST_IsEmpty(l.geom);

COMMENT ON VIEW tiles.tiles_landuse_v IS
  'Land-area polygons for MVT. Source-layer name tiles_landuse_v unchanged. '
  'landuse_class is ref.ref_land_area_classes.code via land_area_class_id (not legacy class_code).';

REVOKE ALL ON TABLE tiles.tiles_landuse_v FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) search.v_search_landuse_source — category fields from ref only
-- ---------------------------------------------------------------------------
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
    lc.code AS code,
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
      lu.name, nm.all_names, lc.name_en, lc.name_mm, lc.code, lu.class_code,
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
  AND lu.is_active = true
  AND lu.geom IS NOT NULL
  AND NOT st_isempty(lu.geom)
  AND (
      nullif(btrim(lu.name), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM core.core_land_area_names x WHERE x.land_area_id = lu.id)
  );

COMMENT ON VIEW search.v_search_landuse_source IS
  'Search source for land areas (entity_type=landuse). '
  'Category code/names come from ref.ref_land_area_classes via land_area_class_id. '
  'Legacy class_code may appear only inside searchable_text for compatibility.';

-- Keep alias view in sync if present (migration 158).
DO $$
BEGIN
  IF to_regclass('search.v_search_land_area_source') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW search.v_search_land_area_source AS
      SELECT * FROM search.v_search_landuse_source
    $v$;
    EXECUTE $c$
      COMMENT ON VIEW search.v_search_land_area_source IS
        'Alias of search.v_search_landuse_source (classification via ref.ref_land_area_classes).'
    $c$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  b _m159_before%ROWTYPE;
  after_areas bigint;
  after_active bigint;
  after_names bigint;
  after_tiles bigint;
  after_search bigint;
  after_null_fk bigint;
  after_invalid_fk bigint;
  after_mismatch bigint;
  tile_null_class bigint;
  search_null_code bigint;
  dup_code bigint;
BEGIN
  SELECT * INTO b FROM _m159_before;

  SELECT count(*) INTO after_areas FROM core.core_land_areas;
  SELECT count(*) INTO after_active FROM core.core_land_areas WHERE deleted_at IS NULL;
  SELECT count(*) INTO after_names FROM core.core_land_area_names;
  SELECT count(*) INTO after_tiles FROM tiles.tiles_landuse_v;
  SELECT count(*) INTO after_search FROM search.v_search_landuse_source;
  SELECT count(*) INTO after_null_fk
  FROM core.core_land_areas WHERE deleted_at IS NULL AND land_area_class_id IS NULL;
  SELECT count(*) INTO after_invalid_fk
  FROM core.core_land_areas a
  WHERE a.deleted_at IS NULL
    AND a.land_area_class_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ref.ref_land_area_classes r WHERE r.id = a.land_area_class_id);
  SELECT count(*) INTO after_mismatch
  FROM core.core_land_areas a
  JOIN ref.ref_land_area_classes r ON r.id = a.land_area_class_id
  WHERE a.deleted_at IS NULL
    AND lower(btrim(coalesce(a.class_code, ''))) IS DISTINCT FROM lower(btrim(r.code));
  SELECT count(*) INTO tile_null_class
  FROM tiles.tiles_landuse_v WHERE landuse_class IS NULL OR btrim(landuse_class) = '';
  SELECT count(*) INTO search_null_code
  FROM search.v_search_landuse_source WHERE category_code IS NULL OR btrim(category_code) = '';
  SELECT count(*) INTO dup_code
  FROM (
    SELECT lower(btrim(code)) AS c, count(*) AS n
    FROM ref.ref_land_area_classes
    GROUP BY 1 HAVING count(*) > 1
  ) d;

  IF after_areas IS DISTINCT FROM b.land_areas THEN
    RAISE EXCEPTION '159: land_areas count changed % → %', b.land_areas, after_areas;
  END IF;
  IF after_active IS DISTINCT FROM b.active THEN
    RAISE EXCEPTION '159: active land_areas count changed % → %', b.active, after_active;
  END IF;
  IF after_names IS DISTINCT FROM b.names THEN
    RAISE EXCEPTION '159: names count changed % → %', b.names, after_names;
  END IF;
  IF after_tiles IS DISTINCT FROM b.tile_rows THEN
    RAISE EXCEPTION '159: tile row coverage changed % → %', b.tile_rows, after_tiles;
  END IF;
  IF after_search IS DISTINCT FROM b.search_rows THEN
    RAISE EXCEPTION '159: search row coverage changed % → %', b.search_rows, after_search;
  END IF;
  IF after_null_fk <> 0 THEN
    RAISE EXCEPTION '159: null land_area_class_id on active rows = %', after_null_fk;
  END IF;
  IF after_invalid_fk <> 0 THEN
    RAISE EXCEPTION '159: invalid land_area_class_id = %', after_invalid_fk;
  END IF;
  IF dup_code <> 0 THEN
    RAISE EXCEPTION '159: duplicate ref codes = %', dup_code;
  END IF;
  IF tile_null_class <> 0 THEN
    RAISE EXCEPTION '159: tiles.tiles_landuse_v has % rows with empty landuse_class', tile_null_class;
  END IF;
  IF search_null_code <> 0 THEN
    RAISE EXCEPTION '159: search source has % rows with empty category_code', search_null_code;
  END IF;
  IF pg_get_viewdef('tiles.tiles_landuse_v'::regclass, true) NOT ILIKE '%ref.ref_land_area_classes%' THEN
    RAISE EXCEPTION '159: tiles_landuse_v does not join ref.ref_land_area_classes';
  END IF;
  IF pg_get_viewdef('tiles.tiles_landuse_v'::regclass, true) ILIKE '%class_code AS landuse_class%' THEN
    RAISE EXCEPTION '159: tiles_landuse_v still aliases legacy class_code as landuse_class';
  END IF;
  IF pg_get_viewdef('search.v_search_landuse_source'::regclass, true)
       ILIKE '%COALESCE(lc.code, lu.class_code) AS category_code%' THEN
    RAISE EXCEPTION '159: search still falls back to legacy class_code for category_code';
  END IF;

  RAISE NOTICE '159 ok: tiles=% search=% mismatch_legacy_vs_ref=% (informational)',
    after_tiles, after_search, after_mismatch;
END $$;

COMMIT;
