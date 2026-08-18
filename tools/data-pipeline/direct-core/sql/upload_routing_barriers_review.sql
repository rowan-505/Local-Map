-- Upload review-only routing-barrier rows to import_review.
-- Does NOT insert safe_new / safe_update / skipped unsupported types.
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TEMP TABLE review_barriers_raw (
  classification text,
  local_staging_id text,
  external_id text,
  barrier_type text,
  core_street_id text,
  point_ewkt text,
  access_tags text,
  source_refs text,
  normalized_data text,
  import_class_reason text
) ON COMMIT DROP;

\copy review_barriers_raw FROM PROGRAM 'cat "$DIRECT_CORE_REVIEW_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v), '')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v), '')::jsonb, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.try_geom(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v), '')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE review_barriers_stage AS
SELECT
  lower(nullif(btrim(classification), '')) AS classification,
  pg_temp.try_bigint(local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(external_id) AS external_id,
  lower(nullif(btrim(barrier_type), '')) AS barrier_type,
  pg_temp.try_bigint(core_street_id) AS core_street_id,
  pg_temp.try_geom(point_ewkt)::geometry(Point, 4326) AS point_geom,
  pg_temp.try_jsonb(access_tags) AS access_tags,
  pg_temp.try_jsonb(source_refs) AS source_refs,
  pg_temp.try_jsonb(normalized_data) AS normalized_data,
  nullif(btrim(import_class_reason), '') AS import_class_reason
FROM review_barriers_raw;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM review_barriers_stage
    WHERE classification IN ('safe_new', 'safe_update', 'unchanged', 'skipped')
  ) THEN
    RAISE EXCEPTION 'review upload refused: CSV contains safe/unchanged/skipped rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM review_barriers_stage WHERE classification IN ('review', 'conflict')) THEN
    RAISE EXCEPTION 'review upload: zero review/conflict rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM review_barriers_stage
    WHERE external_id IS NULL OR local_staging_id IS NULL OR point_geom IS NULL OR barrier_type IS NULL
  ) THEN
    RAISE EXCEPTION 'review upload: missing identity/geometry/barrier_type';
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
      'routing_barriers_review:%s:%s',
      :'snapshot_version',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    :'snapshot_version',
    16,
    'osm_myanmar',
    'MM',
    ARRAY['routing_barriers']::text[],
    'uploaded',
    'conflict_only',
    (SELECT count(*)::int FROM review_barriers_stage),
    (SELECT count(*)::int FROM review_barriers_stage),
    jsonb_build_object(
      'loader', 'direct_core.routing_barriers_review',
      'classification_counts', (
        SELECT coalesce(jsonb_object_agg(classification, n), '{}'::jsonb)
        FROM (
          SELECT classification, count(*)::int AS n
          FROM review_barriers_stage
          GROUP BY 1
        ) x
      )
    ),
    now()
  RETURNING id
)
INSERT INTO import_review.routing_barrier_candidates (
  review_batch_id,
  source_snapshot_version,
  source_snapshot_id_local,
  local_staging_id,
  entity_family,
  external_id,
  canonical_name,
  class_code,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  normalized_data,
  source_refs,
  validation_warnings,
  barrier_type,
  point_geom
)
SELECT
  b.id,
  :'snapshot_version',
  16,
  s.local_staging_id,
  'routing_barriers',
  s.external_id,
  s.barrier_type,
  s.barrier_type,
  50,
  'needs_review',
  'needs_review',
  'pending',
  coalesce(s.normalized_data, '{}'::jsonb)
    || jsonb_build_object(
      'import_class', s.classification,
      'access_rules', s.access_tags,
      'import_class_reason', s.import_class_reason,
      'core_street_id', s.core_street_id
    ),
  coalesce(s.source_refs, '{}'::jsonb)
    || jsonb_build_object('external_id', s.external_id),
  CASE
    WHEN s.import_class_reason IS NOT NULL THEN jsonb_build_array(s.import_class_reason)
    ELSE '[]'::jsonb
  END,
  s.barrier_type,
  s.point_geom
FROM review_barriers_stage s
CROSS JOIN batch b;

SELECT
  'routing_barriers_review_upload' AS section,
  count(*)::bigint AS uploaded
FROM import_review.routing_barrier_candidates c
JOIN import_review.review_batches b ON b.id = c.review_batch_id
WHERE b.source_snapshot_version = :'snapshot_version'
  AND b.entity_families @> ARRAY['routing_barriers']::text[]
  AND b.uploaded_at > now() - interval '10 minutes';

COMMIT;
