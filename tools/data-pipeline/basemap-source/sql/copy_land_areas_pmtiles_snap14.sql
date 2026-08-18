-- Copy staging pmtiles_only land areas (snapshot 14) → basemap_source.land_areas
-- Local geo_core only. Idempotent upsert on external_id.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_snap constant bigint := 14;
  v_expected constant bigint := 120804;
  v_source bigint;
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_source
  FROM staging.staging_landuse_candidates
  WHERE source_snapshot_id = v_snap
    AND import_class = 'pmtiles_only';

  IF v_source <> v_expected THEN
    RAISE EXCEPTION
      'basemap land_areas copy: source count=% expected=% for snapshot %',
      v_source, v_expected, v_snap;
  END IF;

  WITH parsed AS (
    SELECT
      s.id,
      CASE
        WHEN s.external_id ~ '^osm:(way|w):[1-9][0-9]*$' THEN 'way'
        WHEN s.external_id ~ '^osm:(relation|r):[1-9][0-9]*$' THEN 'relation'
        WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('w', 'way') THEN 'way'
        WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('r', 'relation') THEN 'relation'
        ELSE NULL
      END AS osm_feature_type,
      CASE
        WHEN s.external_id ~ '^osm:(?:way|w|relation|r):[1-9][0-9]*$'
          THEN substring(s.external_id FROM '^osm:(?:way|w|relation|r):([1-9][0-9]*)$')::bigint
        WHEN coalesce(s.source_refs->>'osm_id', '') ~ '^[1-9][0-9]*$'
          THEN (s.source_refs->>'osm_id')::bigint
        ELSE NULL
      END AS osm_id
    FROM staging.staging_landuse_candidates s
    WHERE s.source_snapshot_id = v_snap
      AND s.import_class = 'pmtiles_only'
  )
  SELECT count(*) INTO v_bad
  FROM parsed
  WHERE osm_feature_type IS NULL OR osm_id IS NULL OR osm_id <= 0;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'basemap land_areas copy: % rows lack way/relation + positive osm_id',
      v_bad;
  END IF;
END $$;

INSERT INTO basemap_source.land_areas AS b (
  external_id,
  osm_feature_type,
  osm_id,
  source_snapshot_id,
  raw_id,
  source_staging_id,
  class_code,
  land_area_class_id,
  canonical_name,
  import_class,
  pmtiles_only_reason,
  normalized_data,
  source_refs,
  geom,
  geometry_hash,
  content_hash,
  imported_at,
  updated_at
)
SELECT
  s.external_id,
  CASE
    WHEN s.external_id ~ '^osm:(way|w):[1-9][0-9]*$' THEN 'way'
    WHEN s.external_id ~ '^osm:(relation|r):[1-9][0-9]*$' THEN 'relation'
    WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('w', 'way') THEN 'way'
    ELSE 'relation'
  END,
  CASE
    WHEN s.external_id ~ '^osm:(?:way|w|relation|r):[1-9][0-9]*$'
      THEN substring(s.external_id FROM '^osm:(?:way|w|relation|r):([1-9][0-9]*)$')::bigint
    ELSE (s.source_refs->>'osm_id')::bigint
  END,
  s.source_snapshot_id,
  s.raw_id,
  s.id,
  lower(s.class_code),
  s.land_area_class_id,
  nullif(btrim(s.canonical_name), ''),
  'pmtiles_only',
  s.pmtiles_only_reason,
  s.normalized_data,
  s.source_refs || jsonb_build_object(
    'basemap_loader', 'basemap_source.land_areas',
    'snapshot_version', 'osm_myanmar_2026_08_11_national_land_coastline_dry_run_v1'
  ),
  ST_Multi(ST_CollectionExtract(ST_MakeValid(s.geom), 3))::geometry(MultiPolygon, 4326),
  s.geometry_hash,
  s.normalized_hash,
  now(),
  now()
FROM staging.staging_landuse_candidates s
WHERE s.source_snapshot_id = 14
  AND s.import_class = 'pmtiles_only'
ON CONFLICT (external_id) DO UPDATE
SET
  class_code = EXCLUDED.class_code,
  land_area_class_id = EXCLUDED.land_area_class_id,
  canonical_name = EXCLUDED.canonical_name,
  pmtiles_only_reason = EXCLUDED.pmtiles_only_reason,
  normalized_data = EXCLUDED.normalized_data,
  source_refs = EXCLUDED.source_refs,
  geom = EXCLUDED.geom,
  geometry_hash = EXCLUDED.geometry_hash,
  content_hash = EXCLUDED.content_hash,
  source_snapshot_id = EXCLUDED.source_snapshot_id,
  source_staging_id = EXCLUDED.source_staging_id,
  updated_at = now();

SELECT
  'basemap_land_areas_copy' AS section,
  count(*) AS row_count,
  count(DISTINCT class_code) AS class_codes,
  count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom
FROM basemap_source.land_areas
WHERE source_snapshot_id = 14;
