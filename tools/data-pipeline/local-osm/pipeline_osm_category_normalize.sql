-- =============================================================================
-- OSM → CoreMap category normalization (local-osm pipeline)
-- =============================================================================
-- Version-controlled tag→CODE maps. Resolve numeric IDs via JOIN on code.
-- Never invent Core categories from unknown OSM values.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- ---------------------------------------------------------------------------
-- Land areas (landuse / landcover / wetland / leisure)
-- Returns CoreMap ref.ref_land_area_classes.code, or NULL if unmapped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION system.pipeline_normalize_land_area_class(p_tags jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_landuse text := lower(nullif(btrim(v_tags->>'landuse'), ''));
  v_natural text := lower(nullif(btrim(v_tags->>'natural'), ''));
  v_wetland text := lower(nullif(btrim(v_tags->>'wetland'), ''));
  v_leisure text := lower(nullif(btrim(v_tags->>'leisure'), ''));
  v_amenity text := lower(nullif(btrim(v_tags->>'amenity'), ''));
BEGIN
  -- Route 4: natural=wetland (+ optional subtype). Never guess subtype.
  IF v_natural = 'wetland' THEN
    RETURN CASE v_wetland
      WHEN 'marsh' THEN 'marsh'
      WHEN 'swamp' THEN 'swamp'
      WHEN 'mangrove' THEN 'mangrove'
      WHEN 'reedbed' THEN 'reedbed'
      WHEN 'saltmarsh' THEN 'saltmarsh'
      WHEN 'tidalflat' THEN 'tidalflat'
      WHEN 'bog' THEN 'bog'
      WHEN 'fen' THEN 'fen'
      WHEN 'wet_meadow' THEN 'wet_meadow'
      ELSE 'wetland'
    END;
  END IF;

  -- Route 5: recognized landuse=*
  IF v_landuse IS NOT NULL THEN
    RETURN CASE v_landuse
      WHEN 'residential' THEN 'residential'
      WHEN 'commercial' THEN 'commercial'
      WHEN 'retail' THEN 'retail'
      WHEN 'industrial' THEN 'industrial'
      WHEN 'construction' THEN 'construction'
      WHEN 'farmland' THEN 'farmland'
      WHEN 'farm' THEN 'farmland'
      WHEN 'meadow' THEN 'grassland'
      WHEN 'orchard' THEN 'orchard'
      WHEN 'farmyard' THEN 'farmyard'
      WHEN 'paddy' THEN 'paddy'
      WHEN 'aquaculture' THEN 'aquaculture'
      WHEN 'forest' THEN 'forest'
      WHEN 'grass' THEN 'grassland'
      WHEN 'cemetery' THEN 'cemetery'
      WHEN 'religious' THEN 'religious'
      WHEN 'military' THEN 'military'
      WHEN 'quarry' THEN 'quarry'
      WHEN 'landfill' THEN 'landfill'
      WHEN 'railway' THEN 'transport'
      WHEN 'highway' THEN 'transport'
      WHEN 'education' THEN 'education'
      WHEN 'school' THEN 'education'
      WHEN 'university' THEN 'education'
      WHEN 'hospital' THEN 'healthcare'
      WHEN 'clinic' THEN 'healthcare'
      WHEN 'brownfield' THEN 'vacant'
      WHEN 'greenfield' THEN 'vacant'
      WHEN 'basin' THEN NULL  -- water-like; not a land-area class here
      WHEN 'reservoir' THEN NULL
      ELSE NULL
    END;
  END IF;

  -- Route 6: recognized natural=* surface / cover
  IF v_natural IS NOT NULL THEN
    RETURN CASE v_natural
      WHEN 'wood' THEN 'forest'
      WHEN 'forest' THEN 'forest'
      WHEN 'grassland' THEN 'grassland'
      WHEN 'scrub' THEN 'scrub'
      WHEN 'heath' THEN 'heath'
      WHEN 'sand' THEN 'sand'
      WHEN 'beach' THEN 'beach'
      WHEN 'bare_rock' THEN 'bare_rock'
      WHEN 'mud' THEN 'mud'
      WHEN 'water' THEN NULL  -- water polygon route
      WHEN 'coastline' THEN NULL
      ELSE NULL
    END;
  END IF;

  -- Route 7: recognized leisure area values
  -- nature_reserve is a protected-area overlay (not land cover) — handled separately.
  IF v_leisure IS NOT NULL THEN
    RETURN CASE v_leisure
      WHEN 'park' THEN 'park'
      WHEN 'recreation_ground' THEN 'recreation_ground'
      WHEN 'garden' THEN 'park'
      WHEN 'nature_reserve' THEN NULL
      ELSE NULL
    END;
  END IF;

  IF v_amenity = 'grave_yard' THEN
    RETURN 'cemetery';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION system.pipeline_normalize_land_area_class(jsonb) IS
  'Map OSM landuse/natural/wetland/leisure tags → CoreMap land-area CODE. NULL = unmapped (skip Core).';

-- True when tags should be considered for land-area extraction (before normalize).
CREATE OR REPLACE FUNCTION system.pipeline_is_land_area_candidate_tags(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_tags, '{}'::jsonb) ? 'landuse'
    OR lower(coalesce(p_tags->>'natural', '')) IN (
      'wetland', 'wood', 'forest', 'grassland', 'scrub', 'heath',
      'sand', 'beach', 'bare_rock', 'mud'
    )
    OR lower(coalesce(p_tags->>'leisure', '')) IN (
      'park', 'recreation_ground', 'garden'
    )
    OR lower(coalesce(p_tags->>'amenity', '')) = 'grave_yard';
$$;

-- Water polygon candidate tags (not wetland, not coastline).
CREATE OR REPLACE FUNCTION system.pipeline_is_water_polygon_candidate_tags(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    lower(coalesce(p_tags->>'natural', '')) = 'water'
    OR (p_tags ? 'water' AND nullif(btrim(p_tags->>'water'), '') IS NOT NULL)
    OR lower(coalesce(p_tags->>'waterway', '')) = 'riverbank';
$$;

CREATE OR REPLACE FUNCTION system.pipeline_is_coastline_tags(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(p_tags->>'natural', '')) = 'coastline';
$$;

-- ---------------------------------------------------------------------------
-- Water classes (lines + polygons) → ref.ref_water_classes.code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION system.pipeline_normalize_water_class(
  p_tags jsonb,
  p_kind text DEFAULT 'line'  -- 'line' | 'polygon'
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_kind text := lower(btrim(coalesce(p_kind, 'line')));
  v_waterway text := lower(nullif(btrim(v_tags->>'waterway'), ''));
  v_water text := lower(nullif(btrim(v_tags->>'water'), ''));
  v_natural text := lower(nullif(btrim(v_tags->>'natural'), ''));
  v_raw text;
BEGIN
  IF system.pipeline_is_coastline_tags(v_tags) THEN
    RETURN NULL;
  END IF;

  IF v_kind = 'line' THEN
    v_raw := v_waterway;
  ELSE
    -- Prefer water=* then natural=water then riverbank waterway
    v_raw := coalesce(
      v_water,
      CASE WHEN v_natural = 'water' THEN 'water' ELSE NULL END,
      CASE WHEN v_waterway = 'riverbank' THEN 'river' ELSE v_waterway END
    );
  END IF;

  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Property / invalid values are not CoreMap classes.
  IF v_raw IN (
    'yes', 'no', 'seasonal', 'intermittent', 'tidal', 'permanent',
    'intermittent;yes', 'yes;intermittent'
  ) THEN
    RETURN NULL;
  END IF;

  -- Compound / alias normalization (deterministic; no guessing).
  IF v_raw IN ('lake;pond', 'pond;lake') THEN
    RETURN 'lake';
  END IF;
  IF v_raw IN ('fish_pond', 'fish farming pond', 'fish_farm', 'fishpond') THEN
    RETURN 'fishpond';
  END IF;
  IF v_raw IN ('stream_pool', 'stream pool') THEN
    RETURN 'stream_pool';
  END IF;
  IF v_raw IN ('lock_gate', 'lock gate') THEN
    RETURN 'lock_gate';
  END IF;
  IF v_raw IN ('sluice_gate', 'sluice gate') THEN
    RETURN 'sluice_gate';
  END IF;
  IF v_raw IN ('tidal_channel', 'tidal channel') THEN
    RETURN 'tidal_channel';
  END IF;
  IF v_raw = 'riverbank' THEN
    RETURN 'river';
  END IF;

  RETURN CASE v_raw
    WHEN 'river' THEN 'river'
    WHEN 'stream' THEN 'stream'
    WHEN 'canal' THEN 'canal'
    WHEN 'ditch' THEN 'ditch'
    WHEN 'drain' THEN 'drain'
    WHEN 'tidal_channel' THEN 'tidal_channel'
    WHEN 'water' THEN 'water'
    WHEN 'lake' THEN 'lake'
    WHEN 'pond' THEN 'pond'
    WHEN 'reservoir' THEN 'reservoir'
    WHEN 'basin' THEN 'basin'
    WHEN 'lagoon' THEN 'lagoon'
    WHEN 'oxbow' THEN 'oxbow'
    WHEN 'moat' THEN 'moat'
    WHEN 'wastewater' THEN 'wastewater'
    WHEN 'dam' THEN 'dam'
    WHEN 'weir' THEN 'weir'
    WHEN 'lock' THEN 'lock'
    WHEN 'waterfall' THEN 'waterfall'
    WHEN 'dock' THEN 'dock'
    WHEN 'boatyard' THEN 'boatyard'
    WHEN 'fishpond' THEN 'fishpond'
    WHEN 'stream_pool' THEN 'stream_pool'
    WHEN 'lock_gate' THEN 'lock_gate'
    WHEN 'sluice_gate' THEN 'sluice_gate'
    ELSE NULL
  END;
END;
$$;

COMMENT ON FUNCTION system.pipeline_normalize_water_class(jsonb, text) IS
  'Map OSM waterway/water/natural tags → CoreMap water CODE. NULL = unmapped/property value.';

-- Recognized CoreMap land-area leaf/parent codes (for Core eligibility; codes not IDs).
CREATE OR REPLACE FUNCTION system.pipeline_is_coremap_land_area_code(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_code, ''))) IN (
    'residential', 'commercial', 'retail', 'industrial', 'construction',
    'farmland', 'paddy', 'orchard', 'farmyard', 'aquaculture',
    'forest', 'grassland', 'scrub', 'heath', 'sand', 'beach', 'bare_rock', 'mud',
    'park', 'recreation_ground',
    'education', 'healthcare', 'religious', 'cemetery', 'government',
    'military', 'vacant', 'quarry', 'landfill', 'transport', 'other',
    'wetland', 'marsh', 'swamp', 'mangrove', 'reedbed', 'saltmarsh',
    'tidalflat', 'bog', 'fen', 'wet_meadow'
  );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_is_coremap_water_class_code(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_code, ''))) IN (
    'river', 'stream', 'canal', 'tidal_channel', 'ditch', 'drain',
    'water', 'lake', 'reservoir', 'pond', 'basin', 'lagoon', 'oxbow',
    'fishpond', 'moat', 'stream_pool', 'wastewater',
    'dam', 'weir', 'lock', 'lock_gate', 'sluice_gate', 'waterfall',
    'dock', 'boatyard', 'other'
  );
$$;

-- ---------------------------------------------------------------------------
-- Protected areas (overlay) → ref.ref_protected_area_classes.code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION system.pipeline_is_protected_area_candidate_tags(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    lower(coalesce(p_tags->>'boundary', '')) IN ('protected_area', 'national_park')
    OR lower(coalesce(p_tags->>'leisure', '')) = 'nature_reserve';
$$;

COMMENT ON FUNCTION system.pipeline_is_protected_area_candidate_tags(jsonb) IS
  'True for OSM polygons that belong in the protected-area overlay family (not ordinary parks).';

CREATE OR REPLACE FUNCTION system.pipeline_normalize_protected_area_class(p_tags jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_boundary text := lower(nullif(btrim(v_tags->>'boundary'), ''));
  v_leisure text := lower(nullif(btrim(v_tags->>'leisure'), ''));
  v_title text := lower(nullif(btrim(v_tags->>'protection_title'), ''));
  v_designation text := lower(nullif(btrim(v_tags->>'designation'), ''));
  v_protect_class text := lower(nullif(btrim(v_tags->>'protect_class'), ''));
BEGIN
  IF NOT system.pipeline_is_protected_area_candidate_tags(v_tags) THEN
    RETURN NULL;
  END IF;

  -- Strongest explicit signals first. Do not invent classes from protect_class alone.
  IF v_boundary = 'national_park' THEN
    RETURN 'national_park';
  END IF;

  IF coalesce(v_title, '') ~ '(wildlife|sanctuar)'
     OR coalesce(v_designation, '') ~ '(wildlife|sanctuar)' THEN
    RETURN 'wildlife_protected_area';
  END IF;

  IF coalesce(v_title, '') ~ '(forest.?reserve|reserved.?forest)'
     OR coalesce(v_designation, '') ~ '(forest.?reserve|reserved.?forest)' THEN
    RETURN 'forest_reserve';
  END IF;

  IF coalesce(v_title, '') ~ '(marine|mpa)'
     OR coalesce(v_designation, '') ~ '(marine|mpa)' THEN
    RETURN 'marine_protected_area';
  END IF;

  IF v_leisure = 'nature_reserve' THEN
    RETURN 'nature_reserve';
  END IF;

  IF v_boundary = 'protected_area' THEN
    RETURN 'other';
  END IF;

  -- Candidate but no deterministic subtype (should be rare).
  IF v_protect_class IS NOT NULL OR v_title IS NOT NULL OR v_designation IS NOT NULL THEN
    RETURN 'other';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION system.pipeline_normalize_protected_area_class(jsonb) IS
  'Map OSM protected-area tags → CoreMap protected-area CODE. Keep protect_class/designation/title in source tags.';

CREATE OR REPLACE FUNCTION system.pipeline_is_coremap_protected_area_code(p_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_code, ''))) IN (
    'national_park',
    'nature_reserve',
    'wildlife_protected_area',
    'forest_reserve',
    'marine_protected_area',
    'other'
  );
$$;

-- Normalize polygon/multipolygon to MultiPolygon 4326 or NULL if not polygonal.
CREATE OR REPLACE FUNCTION system.pipeline_normalize_protected_area_geom(p_geom geometry)
RETURNS geometry
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v geometry;
  v_poly geometry;
BEGIN
  IF p_geom IS NULL OR ST_IsEmpty(p_geom) THEN
    RETURN NULL;
  END IF;

  v := CASE
    WHEN ST_SRID(p_geom) = 0 THEN ST_SetSRID(p_geom, 4326)
    WHEN ST_SRID(p_geom) = 4326 THEN p_geom
    ELSE ST_Transform(p_geom, 4326)
  END;

  IF NOT ST_IsValid(v) THEN
    v := ST_MakeValid(v);
  END IF;

  IF v IS NULL OR ST_IsEmpty(v) THEN
    RETURN NULL;
  END IF;

  v_poly := ST_CollectionExtract(v, 3);
  IF v_poly IS NULL OR ST_IsEmpty(v_poly) THEN
    RETURN NULL;
  END IF;

  v_poly := ST_Multi(v_poly);
  IF GeometryType(v_poly) <> 'MULTIPOLYGON' OR ST_IsEmpty(v_poly) THEN
    RETURN NULL;
  END IF;

  RETURN v_poly::geometry(MultiPolygon, 4326);
END;
$$;
