-- Upload review-only protected-area rows (duplicates/conflicts) to import_review.
-- Does NOT insert safe_new / safe_update.
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TEMP TABLE review_protected_areas_raw (
  classification text,
  local_staging_id text,
  external_id text,
  name_und text,
  name_my text,
  name_en text,
  class_code text,
  geom_ewkt text,
  confidence_score text,
  source_tags text,
  source_refs text,
  normalized_data text,
  validation_status text,
  rejection_reason text
) ON COMMIT DROP;

\copy review_protected_areas_raw FROM PROGRAM 'cat "$DIRECT_CORE_REVIEW_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::numeric; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v),'')::jsonb,'{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.try_geom(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v),'')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE review_protected_areas_stage AS
SELECT
  lower(nullif(btrim(classification), '')) AS classification,
  pg_temp.try_bigint(local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(external_id) AS external_id,
  nullif(btrim(name_und), '') AS name_und,
  nullif(btrim(name_my), '') AS name_my,
  nullif(btrim(name_en), '') AS name_en,
  lower(nullif(btrim(class_code), '')) AS class_code,
  (
    SELECT pac.id FROM ref.ref_protected_area_classes pac
    WHERE pac.is_active AND pac.code = lower(nullif(btrim(class_code), ''))
    ORDER BY pac.sort_order NULLS LAST, pac.id LIMIT 1
  ) AS protected_area_class_id,
  pg_temp.try_geom(geom_ewkt) AS geom,
  pg_temp.try_numeric(confidence_score) AS confidence_score,
  pg_temp.try_jsonb(source_tags) AS source_tags,
  pg_temp.try_jsonb(source_refs) AS source_refs,
  pg_temp.try_jsonb(normalized_data) AS normalized_data,
  nullif(btrim(validation_status), '') AS validation_status,
  pg_temp.try_jsonb(rejection_reason) AS rejection_reason
FROM review_protected_areas_raw;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM review_protected_areas_stage
    WHERE classification IN ('safe_new', 'safe_update', 'unchanged')
  ) THEN
    RAISE EXCEPTION 'review upload refused: CSV contains safe/unchanged rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM review_protected_areas_stage) THEN
    RAISE EXCEPTION 'review upload: zero rows';
  END IF;
END $$;

WITH batch AS (
  INSERT INTO import_review.review_batches (
    batch_name,
    source_snapshot_version,
    source_snapshot_id_local,
    source_registry_code,
    region_code,
    entity_families,
    status,
    upload_mode,
    total_candidate_count,
    uploaded_candidate_count,
    summary,
    uploaded_at
  )
  SELECT
    format(
      'protected_areas_review:%s:%s',
      :'snapshot_version',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    :'snapshot_version',
    15,
    'osm_myanmar',
    'MM',
    ARRAY['protected_areas']::text[],
    'uploaded',
    'conflict_only',
    (SELECT count(*)::int FROM review_protected_areas_stage),
    (SELECT count(*)::int FROM review_protected_areas_stage),
    jsonb_build_object(
      'loader', 'direct_core.protected_areas_review',
      'classification_counts', (
        SELECT coalesce(jsonb_object_agg(classification, n), '{}'::jsonb)
        FROM (
          SELECT classification, count(*)::int AS n
          FROM review_protected_areas_stage
          GROUP BY 1
        ) x
      )
    ),
    now()
  RETURNING id
)
INSERT INTO import_review.protected_area_candidates (
  review_batch_id,
  source_snapshot_version,
  source_snapshot_id_local,
  local_staging_id,
  entity_family,
  external_id,
  canonical_name,
  class_code,
  protected_area_class_id,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  normalized_data,
  source_refs,
  validation_warnings,
  name,
  name_mm,
  name_en,
  geom,
  centroid
)
SELECT
  b.id,
  :'snapshot_version',
  15,
  s.local_staging_id,
  'protected_areas',
  s.external_id,
  coalesce(s.name_en, s.name_my, s.name_und),
  s.class_code,
  s.protected_area_class_id,
  s.confidence_score,
  'needs_review',
  'needs_review',
  'pending',
  coalesce(s.normalized_data, '{}'::jsonb)
    || jsonb_build_object(
      'import_class', s.classification,
      'source_tags', s.source_tags,
      'rejection_reason', s.rejection_reason
    ),
  coalesce(s.source_refs, '{}'::jsonb),
  CASE
    WHEN s.validation_status IS NOT NULL THEN jsonb_build_array(s.validation_status)
    ELSE '[]'::jsonb
  END,
  coalesce(s.name_en, s.name_my, s.name_und),
  s.name_my,
  s.name_en,
  s.geom,
  CASE WHEN s.geom IS NOT NULL THEN ST_PointOnSurface(s.geom)::geometry(Point, 4326) ELSE NULL END
FROM review_protected_areas_stage s
CROSS JOIN batch b;

SELECT
  'protected_areas_review_upload' AS section,
  count(*)::bigint AS uploaded
FROM import_review.protected_area_candidates c
JOIN import_review.review_batches b ON b.id = c.review_batch_id
WHERE b.source_snapshot_version = :'snapshot_version'
  AND b.entity_families @> ARRAY['protected_areas']::text[]
  AND b.uploaded_at > now() - interval '5 minutes';

COMMIT;
