-- =============================================================================
-- One-time copy: staging.staging_building_candidates (snapshot 13)
--            → basemap_source.buildings
--
-- Local geo_core only. Idempotent upsert on external_id.
-- Stops if any source row cannot produce way|relation + positive osm_id.
-- Does not copy staging workflow fields (review_*, match_status, auto_action,
-- import_class, etc.).
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_snap constant bigint := 13;
  v_expected constant bigint := 5578282;
  v_source bigint;
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_source
  FROM staging.staging_building_candidates
  WHERE source_snapshot_id = v_snap;

  IF v_source <> v_expected THEN
    RAISE EXCEPTION
      'basemap_source copy: source count=% expected=% for snapshot %',
      v_source, v_expected, v_snap;
  END IF;

  -- Fail closed: every row must yield way|relation + positive osm_id.
  WITH parsed AS (
    SELECT
      s.id,
      s.external_id,
      CASE
        WHEN s.external_id ~ '^osm:way:[1-9][0-9]*$' THEN 'way'
        WHEN s.external_id ~ '^osm:relation:[1-9][0-9]*$' THEN 'relation'
        WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('w', 'way') THEN 'way'
        WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('r', 'relation') THEN 'relation'
        ELSE NULL
      END AS osm_feature_type,
      CASE
        WHEN s.external_id ~ '^osm:(way|relation):[1-9][0-9]*$'
          THEN substring(s.external_id FROM '^osm:(?:way|relation):([1-9][0-9]*)$')::bigint
        WHEN coalesce(s.source_refs->>'osm_id', '') ~ '^[1-9][0-9]*$'
          THEN (s.source_refs->>'osm_id')::bigint
        ELSE NULL
      END AS osm_id
    FROM staging.staging_building_candidates s
    WHERE s.source_snapshot_id = v_snap
  )
  SELECT count(*) INTO v_bad
  FROM parsed
  WHERE osm_feature_type IS NULL
     OR osm_id IS NULL
     OR osm_id <= 0;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'basemap_source copy: % rows cannot produce way/relation + positive osm_id; aborting (no silent repair)',
      v_bad;
  END IF;
END $$;

INSERT INTO basemap_source.buildings AS b (
  external_id,
  osm_feature_type,
  osm_id,
  source_snapshot_id,
  raw_id,
  source_staging_id,
  class_code,
  canonical_name,
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
    WHEN s.external_id ~ '^osm:way:[1-9][0-9]*$' THEN 'way'
    WHEN s.external_id ~ '^osm:relation:[1-9][0-9]*$' THEN 'relation'
    WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('w', 'way') THEN 'way'
    WHEN lower(coalesce(s.source_refs->>'osm_feature_type', '')) IN ('r', 'relation') THEN 'relation'
    ELSE NULL
  END AS osm_feature_type,
  CASE
    WHEN s.external_id ~ '^osm:(way|relation):[1-9][0-9]*$'
      THEN substring(s.external_id FROM '^osm:(?:way|relation):([1-9][0-9]*)$')::bigint
    WHEN coalesce(s.source_refs->>'osm_id', '') ~ '^[1-9][0-9]*$'
      THEN (s.source_refs->>'osm_id')::bigint
    ELSE NULL
  END AS osm_id,
  s.source_snapshot_id,
  s.raw_id,
  s.id AS source_staging_id,
  s.class_code,
  nullif(btrim(s.canonical_name), '') AS canonical_name,
  coalesce(s.normalized_data, '{}'::jsonb) AS normalized_data,
  coalesce(s.source_refs, '{}'::jsonb) AS source_refs,
  s.geom,
  s.geometry_hash,
  s.normalized_hash AS content_hash,
  now() AS imported_at,
  now() AS updated_at
FROM staging.staging_building_candidates s
WHERE s.source_snapshot_id = 13
ON CONFLICT (external_id) DO UPDATE SET
  osm_feature_type = EXCLUDED.osm_feature_type,
  osm_id = EXCLUDED.osm_id,
  source_snapshot_id = EXCLUDED.source_snapshot_id,
  raw_id = EXCLUDED.raw_id,
  source_staging_id = EXCLUDED.source_staging_id,
  class_code = EXCLUDED.class_code,
  canonical_name = EXCLUDED.canonical_name,
  normalized_data = EXCLUDED.normalized_data,
  source_refs = EXCLUDED.source_refs,
  geom = EXCLUDED.geom,
  geometry_hash = EXCLUDED.geometry_hash,
  content_hash = EXCLUDED.content_hash,
  updated_at = now()
WHERE
  (b.osm_feature_type, b.osm_id, b.source_snapshot_id, b.raw_id, b.source_staging_id,
   b.class_code, b.canonical_name, b.normalized_data, b.source_refs, b.geom,
   b.geometry_hash, b.content_hash)
  IS DISTINCT FROM
  (EXCLUDED.osm_feature_type, EXCLUDED.osm_id, EXCLUDED.source_snapshot_id, EXCLUDED.raw_id,
   EXCLUDED.source_staging_id, EXCLUDED.class_code, EXCLUDED.canonical_name,
   EXCLUDED.normalized_data, EXCLUDED.source_refs, EXCLUDED.geom,
   EXCLUDED.geometry_hash, EXCLUDED.content_hash);

SELECT
  'basemap_source_copy' AS section,
  (SELECT count(*) FROM staging.staging_building_candidates WHERE source_snapshot_id = 13) AS source_rows,
  (SELECT count(*) FROM basemap_source.buildings WHERE source_snapshot_id = 13) AS dest_rows;
