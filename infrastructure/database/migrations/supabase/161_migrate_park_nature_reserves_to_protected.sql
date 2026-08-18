-- =============================================================================
-- Supabase migration 161: move mistaken park nature_reserves → protected overlay
-- =============================================================================
--
-- Scope (existing Core rows only):
--   CASE A: park + leisure=nature_reserve, no physical landuse/natural
--           → create core_protected_areas + soft-delete land row
--   CASE B: land row already has physical class (forest/orchard/religious) OR
--           natural/landuse surface tags, AND protect signal
--           → create protected overlay; KEEP land row
--   CASE C/D: leisure=park / garden → unchanged
--
-- Does NOT:
--   convert leisure=park or leisure=garden
--   import national OSM protected areas
--   hard-delete land rows
--   guess class from weak name text alone
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '15min';

-- ---------------------------------------------------------------------------
-- 0) Baseline
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m161_before ON COMMIT DROP AS
SELECT
  (SELECT count(*)::bigint FROM core.core_land_areas) AS land_total,
  (SELECT count(*)::bigint FROM core.core_land_areas WHERE deleted_at IS NULL AND is_active) AS land_active,
  (SELECT count(*)::bigint
     FROM core.core_land_areas a
     JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
    WHERE a.deleted_at IS NULL AND a.is_active AND lc.code = 'park') AS park_active,
  (SELECT count(*)::bigint FROM core.core_land_area_names) AS land_names,
  (SELECT count(*)::bigint FROM core.core_protected_areas) AS pa_total,
  (SELECT count(*)::bigint FROM core.core_protected_area_names) AS pa_names;

DO $$
DECLARE b _m161_before%ROWTYPE;
BEGIN
  SELECT * INTO b FROM _m161_before;
  IF b.pa_total <> 0 THEN
    RAISE EXCEPTION '161: refuse — core_protected_areas already has % rows', b.pa_total;
  END IF;
  RAISE NOTICE '161 baseline: land_total=% park_active=% land_names=%',
    b.land_total, b.park_active, b.land_names;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Candidate staging + deterministic classification
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m161_candidates ON COMMIT DROP AS
WITH src AS (
  SELECT
    a.id AS land_area_id,
    a.public_id AS land_public_id,
    lc.code AS land_class_code,
    a.geom,
    a.centroid,
    a.area_m2,
    a.admin_area_id,
    a.region_code,
    a.external_id,
    a.source_registry_id,
    a.source_snapshot_id,
    a.source_feature_type,
    a.source_feature_id,
    a.source_tags,
    a.source_refs,
    a.normalized_data,
    a.confidence_score,
    a.name AS legacy_name,
    lower(nullif(btrim(a.source_tags->>'leisure'), '')) AS leisure,
    lower(nullif(btrim(a.source_tags->>'boundary'), '')) AS boundary,
    nullif(btrim(a.source_tags->>'protect_class'), '') AS protect_class,
    nullif(btrim(a.source_tags->>'protection_title'), '') AS protection_title,
    nullif(btrim(a.source_tags->>'designation'), '') AS designation,
    lower(nullif(btrim(a.source_tags->>'natural'), '')) AS natural_tag,
    lower(nullif(btrim(a.source_tags->>'landuse'), '')) AS landuse_tag
  FROM core.core_land_areas a
  JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
  WHERE a.deleted_at IS NULL
    AND a.is_active IS TRUE
),
cand AS (
  SELECT *
  FROM src
  WHERE leisure = 'nature_reserve'
     OR boundary IN ('protected_area', 'national_park')
     OR protect_class IS NOT NULL
     OR protection_title IS NOT NULL
     OR lower(coalesce(designation, '')) ~ '(protect|reserve|national.?park|wildlife|sanctuar)'
)
SELECT
  c.*,
  -- Protected-area class code (strongest signal first; no weak name guessing)
  CASE
    WHEN c.boundary = 'national_park' THEN 'national_park'
    WHEN lower(coalesce(c.protection_title, '')) ~ '(wildlife|sanctuar)'
      OR lower(coalesce(c.designation, '')) ~ '(wildlife|sanctuar)'
      THEN 'wildlife_protected_area'
    WHEN lower(coalesce(c.protection_title, '')) ~ '(forest.?reserve|reserved.?forest)'
      OR lower(coalesce(c.designation, '')) ~ '(forest.?reserve|reserved.?forest)'
      THEN 'forest_reserve'
    WHEN lower(coalesce(c.protection_title, '')) ~ '(marine|mpa)'
      OR lower(coalesce(c.designation, '')) ~ '(marine|mpa)'
      THEN 'marine_protected_area'
    WHEN c.leisure = 'nature_reserve' THEN 'nature_reserve'
    WHEN c.boundary = 'protected_area' THEN 'other'
    WHEN c.protect_class IS NOT NULL OR c.protection_title IS NOT NULL THEN 'other'
    ELSE NULL
  END AS pa_class_code,
  -- Land disposition
  CASE
    -- CASE A: mistaken park (protection-only)
    WHEN c.land_class_code = 'park'
         AND c.leisure = 'nature_reserve'
         AND c.natural_tag IS NULL
         AND c.landuse_tag IS NULL
      THEN 'deactivate'
    -- CASE B: physical surface / non-park class already present
    WHEN c.natural_tag IS NOT NULL
      OR c.landuse_tag IS NOT NULL
      OR c.land_class_code IS DISTINCT FROM 'park'
      THEN 'keep_land'
    -- Should not reach for current data; quarantine
    ELSE 'ambiguous'
  END AS land_action,
  -- Parse OSM identity for protected row (land may lack source_feature_*)
  CASE
    WHEN c.source_feature_type IN ('way', 'relation') THEN c.source_feature_type
    WHEN c.external_id ~* '^osm:way:' THEN 'way'
    WHEN c.external_id ~* '^osm:relation:' THEN 'relation'
    WHEN lower(coalesce(c.source_refs->>'osm_feature_type', '')) IN ('w', 'way') THEN 'way'
    WHEN lower(coalesce(c.source_refs->>'osm_feature_type', '')) IN ('r', 'relation') THEN 'relation'
    ELSE NULL
  END AS parsed_feature_type,
  COALESCE(
    c.source_feature_id,
    CASE
      WHEN c.external_id ~* '^osm:(way|relation):[0-9]+$'
        THEN substring(c.external_id from '[0-9]+$')::bigint
      WHEN coalesce(c.source_refs->>'osm_id', '') ~ '^[0-9]+$'
        THEN (c.source_refs->>'osm_id')::bigint
      ELSE NULL
    END
  ) AS parsed_feature_id
FROM cand c;

DO $$
DECLARE
  n bigint;
  amb bigint;
  null_class bigint;
BEGIN
  SELECT count(*) INTO n FROM _m161_candidates;
  SELECT count(*) INTO amb FROM _m161_candidates WHERE land_action = 'ambiguous';
  SELECT count(*) INTO null_class FROM _m161_candidates WHERE pa_class_code IS NULL;
  IF n = 0 THEN
    RAISE EXCEPTION '161: no candidates found (unexpected)';
  END IF;
  IF amb > 0 THEN
    RAISE EXCEPTION '161: % ambiguous candidates — refuse automatic migration', amb;
  END IF;
  IF null_class > 0 THEN
    RAISE EXCEPTION '161: % candidates missing pa_class_code', null_class;
  END IF;
  RAISE NOTICE '161 candidates=% deactivate=% keep_land=%',
    n,
    (SELECT count(*) FROM _m161_candidates WHERE land_action = 'deactivate'),
    (SELECT count(*) FROM _m161_candidates WHERE land_action = 'keep_land');
END $$;

-- ---------------------------------------------------------------------------
-- 2) Insert protected areas (class by CODE)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m161_created ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO core.core_protected_areas (
    protected_area_class_id,
    admin_area_id,
    geom,
    centroid,
    area_m2,
    external_id,
    source_registry_id,
    source_snapshot_id,
    source_feature_type,
    source_feature_id,
    region_code,
    source_tags,
    source_refs,
    normalized_data,
    confidence_score,
    is_verified,
    verification_status,
    manual_override,
    is_active,
    created_at,
    updated_at
  )
  SELECT
    pc.id,
    c.admin_area_id,
    CASE
      WHEN GeometryType(c.geom) = 'MULTIPOLYGON' THEN c.geom
      ELSE ST_Multi(c.geom)
    END::geometry(MultiPolygon, 4326),
    COALESCE(c.centroid, ST_PointOnSurface(c.geom))::geometry(Point, 4326),
    COALESCE(c.area_m2, ST_Area(c.geom::geography)::numeric),
    c.external_id,
    c.source_registry_id,
    c.source_snapshot_id,
    c.parsed_feature_type,
    c.parsed_feature_id,
    c.region_code,
    c.source_tags,
    coalesce(c.source_refs, '{}'::jsonb) || jsonb_build_object(
      'migrated_from', 'core.core_land_areas',
      'migrated_land_area_id', c.land_area_id,
      'migrated_land_public_id', c.land_public_id,
      'migration', '161_park_nature_reserve_to_protected'
    ),
    coalesce(c.normalized_data, '{}'::jsonb) || jsonb_build_object(
      'land_action', c.land_action,
      'pa_class_code', c.pa_class_code,
      'source_land_class_code', c.land_class_code,
      'migration', '161_park_nature_reserve_to_protected'
    ),
    c.confidence_score,
    false,
    'unverified',
    false,
    true,
    now(),
    now()
  FROM _m161_candidates c
  JOIN ref.ref_protected_area_classes pc
    ON pc.code = c.pa_class_code AND pc.is_active IS TRUE
  RETURNING id, external_id, protected_area_class_id, source_refs
)
SELECT
  i.id AS protected_area_id,
  (i.source_refs->>'migrated_land_area_id')::bigint AS land_area_id,
  i.external_id,
  i.protected_area_class_id
FROM ins i;

DO $$
DECLARE
  cand bigint;
  created bigint;
BEGIN
  SELECT count(*) INTO cand FROM _m161_candidates;
  SELECT count(*) INTO created FROM _m161_created;
  IF created IS DISTINCT FROM cand THEN
    RAISE EXCEPTION '161: created % protected rows but candidates=%', created, cand;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Copy names (land names table + legacy name fallback)
-- ---------------------------------------------------------------------------
INSERT INTO core.core_protected_area_names (
  protected_area_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT
  x.protected_area_id,
  n.name,
  n.language_code,
  n.script_code,
  n.name_type,
  n.is_primary,
  n.search_weight
FROM _m161_created x
JOIN core.core_land_area_names n ON n.land_area_id = x.land_area_id
WHERE nullif(btrim(n.name), '') IS NOT NULL;

-- Legacy single name when no name rows exist
INSERT INTO core.core_protected_area_names (
  protected_area_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT
  x.protected_area_id,
  btrim(c.legacy_name),
  'und',
  NULL,
  'imported',
  true,
  50
FROM _m161_created x
JOIN _m161_candidates c ON c.land_area_id = x.land_area_id
WHERE nullif(btrim(c.legacy_name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_protected_area_names p
    WHERE p.protected_area_id = x.protected_area_id
  );

-- ---------------------------------------------------------------------------
-- 4) Soft-delete CASE A land rows (protection-only parks)
-- ---------------------------------------------------------------------------
UPDATE core.core_land_areas a
SET
  is_active = false,
  deleted_at = now(),
  updated_at = now(),
  normalized_data = coalesce(a.normalized_data, '{}'::jsonb) || jsonb_build_object(
    'migration', '161_park_nature_reserve_to_protected',
    'land_action', 'deactivate',
    'replaced_by_protected_area', true
  ),
  source_refs = coalesce(a.source_refs, '{}'::jsonb) || jsonb_build_object(
    'protected_area_migration', '161',
    'protected_area_id', x.protected_area_id
  )
FROM _m161_created x
JOIN _m161_candidates c ON c.land_area_id = x.land_area_id
WHERE a.id = x.land_area_id
  AND c.land_action = 'deactivate';

-- Annotate CASE B land rows (kept) without changing class/geometry
UPDATE core.core_land_areas a
SET
  updated_at = now(),
  normalized_data = coalesce(a.normalized_data, '{}'::jsonb) || jsonb_build_object(
    'migration', '161_park_nature_reserve_to_protected',
    'land_action', 'keep_land',
    'protected_area_overlay_created', true
  ),
  source_refs = coalesce(a.source_refs, '{}'::jsonb) || jsonb_build_object(
    'protected_area_migration', '161',
    'protected_area_id', x.protected_area_id
  )
FROM _m161_created x
JOIN _m161_candidates c ON c.land_area_id = x.land_area_id
WHERE a.id = x.land_area_id
  AND c.land_action = 'keep_land';

-- ---------------------------------------------------------------------------
-- 5) Assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  b _m161_before%ROWTYPE;
  after_total bigint;
  after_names bigint;
  after_park bigint;
  after_pa bigint;
  after_pa_names bigint;
  deactivated bigint;
  keep_land bigint;
  dup_ident bigint;
  bad_geom bigint;
  empty_geom bigint;
  class_counts jsonb;
  expected_deactivate bigint := 97;
  expected_keep bigint := 5;
  expected_pa bigint := 102;
BEGIN
  SELECT * INTO b FROM _m161_before;

  SELECT count(*) INTO after_total FROM core.core_land_areas;
  SELECT count(*) INTO after_names FROM core.core_land_area_names;
  SELECT count(*) INTO after_park
  FROM core.core_land_areas a
  JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
  WHERE a.deleted_at IS NULL AND a.is_active AND lc.code = 'park';
  SELECT count(*) INTO after_pa FROM core.core_protected_areas WHERE deleted_at IS NULL AND is_active;
  SELECT count(*) INTO after_pa_names FROM core.core_protected_area_names;
  SELECT count(*) INTO deactivated FROM _m161_candidates WHERE land_action = 'deactivate';
  SELECT count(*) INTO keep_land FROM _m161_candidates WHERE land_action = 'keep_land';

  IF after_total IS DISTINCT FROM b.land_total THEN
    RAISE EXCEPTION '161: land_areas total changed % → %', b.land_total, after_total;
  END IF;
  IF after_names IS DISTINCT FROM b.land_names THEN
    RAISE EXCEPTION '161: land names count changed % → %', b.land_names, after_names;
  END IF;
  IF deactivated IS DISTINCT FROM expected_deactivate THEN
    RAISE EXCEPTION '161: unexpected deactivate count % (expected %)', deactivated, expected_deactivate;
  END IF;
  IF keep_land IS DISTINCT FROM expected_keep THEN
    RAISE EXCEPTION '161: unexpected keep_land count % (expected %)', keep_land, expected_keep;
  END IF;
  IF after_pa IS DISTINCT FROM expected_pa THEN
    RAISE EXCEPTION '161: protected rows=% expected %', after_pa, expected_pa;
  END IF;
  IF after_park IS DISTINCT FROM (b.park_active - expected_deactivate) THEN
    RAISE EXCEPTION '161: park_active=% expected %', after_park, b.park_active - expected_deactivate;
  END IF;

  -- No leisure=nature_reserve should remain as active park
  IF EXISTS (
    SELECT 1
    FROM core.core_land_areas a
    JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
    WHERE a.deleted_at IS NULL AND a.is_active AND lc.code = 'park'
      AND lower(coalesce(a.source_tags->>'leisure', '')) = 'nature_reserve'
  ) THEN
    RAISE EXCEPTION '161: active park nature_reserve rows remain';
  END IF;

  -- Unrelated parks must remain: leisure=park (581) + garden (113) + empty-tags Myoma (1)
  IF (
    SELECT count(*) FROM core.core_land_areas a
    JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
    WHERE a.deleted_at IS NULL AND a.is_active AND lc.code = 'park'
      AND lower(coalesce(a.source_tags->>'leisure', '')) = 'park'
  ) IS DISTINCT FROM 581 THEN
    RAISE EXCEPTION '161: leisure=park active count changed';
  END IF;
  IF (
    SELECT count(*) FROM core.core_land_areas a
    JOIN ref.ref_land_area_classes lc ON lc.id = a.land_area_class_id
    WHERE a.deleted_at IS NULL AND a.is_active AND lc.code = 'park'
      AND lower(coalesce(a.source_tags->>'leisure', '')) = 'garden'
  ) IS DISTINCT FROM 113 THEN
    RAISE EXCEPTION '161: leisure=garden active count changed';
  END IF;

  SELECT count(*) INTO dup_ident
  FROM (
    SELECT source_registry_id, source_feature_type, source_feature_id, count(*)
    FROM core.core_protected_areas
    WHERE source_registry_id IS NOT NULL
      AND source_feature_type IS NOT NULL
      AND source_feature_id IS NOT NULL
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) d;
  IF dup_ident <> 0 THEN
    RAISE EXCEPTION '161: duplicate protected source identities=%', dup_ident;
  END IF;

  SELECT count(*) INTO bad_geom
  FROM core.core_protected_areas
  WHERE deleted_at IS NULL AND (NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326);
  SELECT count(*) INTO empty_geom
  FROM core.core_protected_areas
  WHERE deleted_at IS NULL AND ST_IsEmpty(geom);
  IF bad_geom <> 0 OR empty_geom <> 0 THEN
    RAISE EXCEPTION '161: bad_geom=% empty_geom=%', bad_geom, empty_geom;
  END IF;

  SELECT jsonb_object_agg(code, n) INTO class_counts
  FROM (
    SELECT pc.code, count(*)::int AS n
    FROM core.core_protected_areas p
    JOIN ref.ref_protected_area_classes pc ON pc.id = p.protected_area_class_id
    WHERE p.deleted_at IS NULL AND p.is_active
    GROUP BY pc.code
  ) s;

  RAISE NOTICE '161 ok: park %→% pa=% names=% classes=%',
    b.park_active, after_park, after_pa, after_pa_names, class_counts;
END $$;

COMMIT;
