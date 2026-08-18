-- Upload review-only routing turn-restriction rows to import_review.
-- Includes: ambiguous/missing street resolve + complex via-way structures.
-- Does NOT insert safe_new / safe_update / unchanged / malformed junk.
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TEMP TABLE review_tr_raw (
  classification text,
  local_staging_id text,
  external_id text,
  restriction_type text,
  from_external_id text,
  via_external_id text,
  to_external_id text,
  from_street_id text,
  to_street_id text,
  via_ewkt text,
  source_refs text,
  normalized_data text,
  import_class_reason text
) ON COMMIT DROP;

\copy review_tr_raw FROM PROGRAM 'cat "$DIRECT_CORE_REVIEW_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v), '')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v), '')::jsonb, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.try_geom(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v), '')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE review_tr_stage AS
SELECT
  lower(nullif(btrim(classification), '')) AS classification,
  pg_temp.try_bigint(local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(external_id) AS external_id,
  lower(nullif(btrim(restriction_type), '')) AS restriction_type,
  system.pipeline_osm_identity_key(from_external_id) AS from_external_id,
  system.pipeline_osm_identity_key(via_external_id) AS via_external_id,
  system.pipeline_osm_identity_key(to_external_id) AS to_external_id,
  pg_temp.try_bigint(from_street_id) AS from_street_id,
  pg_temp.try_bigint(to_street_id) AS to_street_id,
  pg_temp.try_geom(via_ewkt)::geometry(Point, 4326) AS via_geom,
  pg_temp.try_jsonb(source_refs) AS source_refs,
  pg_temp.try_jsonb(normalized_data) AS normalized_data,
  nullif(btrim(import_class_reason), '') AS import_class_reason
FROM review_tr_raw;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM review_tr_stage
    WHERE classification IN ('safe_new', 'safe_update', 'unchanged', 'skipped')
  ) THEN
    RAISE EXCEPTION 'review upload refused: CSV contains safe/unchanged/skipped rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM review_tr_stage WHERE classification IN ('review', 'conflict')) THEN
    RAISE EXCEPTION 'review upload: zero review/conflict rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM review_tr_stage
    WHERE external_id IS NULL OR local_staging_id IS NULL OR restriction_type IS NULL
  ) THEN
    RAISE EXCEPTION 'review upload: missing identity/restriction_type';
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
      'routing_turn_restrictions_review:%s:%s',
      :'snapshot_version',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    :'snapshot_version',
    17,
    'osm_myanmar',
    'MM',
    ARRAY['routing_turn_restrictions']::text[],
    'uploaded',
    'conflict_only',
    (SELECT count(*)::int FROM review_tr_stage),
    (SELECT count(*)::int FROM review_tr_stage),
    jsonb_build_object(
      'loader', 'direct_core.routing_turn_restrictions_review',
      'classification_counts', (
        SELECT coalesce(jsonb_object_agg(classification, n), '{}'::jsonb)
        FROM (
          SELECT classification, count(*)::int AS n
          FROM review_tr_stage
          GROUP BY 1
        ) x
      )
    ),
    now()
  RETURNING id
)
INSERT INTO import_review.routing_turn_restriction_candidates (
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
  restriction_type,
  from_external_id,
  via_external_id,
  to_external_id,
  geom
)
SELECT
  b.id,
  :'snapshot_version',
  17,
  s.local_staging_id,
  'routing_turn_restrictions',
  s.external_id,
  s.restriction_type,
  s.restriction_type,
  50,
  'needs_review',
  'needs_review',
  'pending',
  coalesce(s.normalized_data, '{}'::jsonb)
    || jsonb_build_object(
      'import_class', s.classification,
      'import_class_reason', s.import_class_reason,
      'from_street_id', s.from_street_id,
      'to_street_id', s.to_street_id
    ),
  coalesce(s.source_refs, '{}'::jsonb)
    || jsonb_build_object('external_id', s.external_id),
  CASE
    WHEN s.import_class_reason IS NOT NULL THEN jsonb_build_array(s.import_class_reason)
    ELSE '[]'::jsonb
  END,
  s.restriction_type,
  s.from_external_id,
  s.via_external_id,
  s.to_external_id,
  s.via_geom
FROM review_tr_stage s
CROSS JOIN batch b;

SELECT
  'routing_turn_restrictions_review_upload' AS section,
  count(*)::bigint AS uploaded
FROM import_review.routing_turn_restriction_candidates c
JOIN import_review.review_batches b ON b.id = c.review_batch_id
WHERE b.source_snapshot_version = :'snapshot_version'
  AND b.entity_families @> ARRAY['routing_turn_restrictions']::text[]
  AND b.uploaded_at > now() - interval '10 minutes';

COMMIT;
