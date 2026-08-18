\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30min';

CREATE TEMP TABLE direct_barriers_params(
  source_registry_id bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO direct_barriers_params
SELECT r.id, s.id, s.snapshot_version, :'region_code', :'dry_run'::boolean
FROM system.system_source_registry r
JOIN system.system_source_snapshots s
  ON s.source_registry_id = r.id
 AND s.snapshot_version = :'snapshot_version'
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_barriers_params) THEN
    RAISE EXCEPTION 'routing_barriers: active source/snapshot not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'routing'
      AND table_name = 'routing_barriers'
      AND column_name = 'external_id'
  ) THEN
    RAISE EXCEPTION 'routing_barriers: apply migration 163 before direct-core import (external_id missing)';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:routing_barriers:' || (SELECT region_code FROM direct_barriers_params), 0));
END $$;

CREATE TEMP TABLE direct_barriers_raw(
  classification text,
  local_staging_id text,
  external_id text,
  barrier_type text,
  core_street_id text,
  point_ewkt text,
  access_tags text,
  source_refs text,
  normalized_data text
) ON COMMIT DROP;

\copy direct_barriers_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v), '')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v), '')::jsonb, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v), '')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE direct_barriers_stage AS
SELECT
  row_number() OVER ()::bigint AS row_no,
  lower(nullif(btrim(classification), '')) AS classification,
  pg_temp.direct_try_bigint(local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(external_id) AS identity_key,
  system.pipeline_osm_identity_key(external_id) AS external_id,
  lower(nullif(btrim(barrier_type), '')) AS barrier_type,
  pg_temp.direct_try_bigint(core_street_id) AS core_street_id,
  pg_temp.direct_try_geometry(point_ewkt) AS geom,
  nullif(pg_temp.direct_try_jsonb(access_tags), '{}'::jsonb) AS access_rules,
  pg_temp.direct_try_jsonb(source_refs) AS source_refs,
  pg_temp.direct_try_jsonb(normalized_data) AS normalized_data,
  split_part(system.pipeline_osm_identity_key(external_id), ':', 2) AS source_feature_type,
  nullif(split_part(system.pipeline_osm_identity_key(external_id), ':', 3), '')::bigint AS source_feature_id,
  count(*) OVER (PARTITION BY system.pipeline_osm_identity_key(external_id)) AS identity_count
FROM direct_barriers_raw;

CREATE INDEX ON direct_barriers_stage (identity_key);

CREATE TEMP TABLE direct_barriers_core AS
SELECT
  c.*,
  system.pipeline_osm_identity_key(
    coalesce(
      nullif(btrim(c.external_id), ''),
      nullif(btrim(c.source_refs->>'external_id'), ''),
      nullif(btrim(c.source_refs->>'osm_external_id'), ''),
      CASE
        WHEN nullif(btrim(c.source_refs->>'osm_id'), '') IS NOT NULL THEN
          'osm:'
          || coalesce(nullif(btrim(c.source_refs->>'osm_feature_type'), ''), 'node')
          || ':'
          || btrim(c.source_refs->>'osm_id')
      END
    )
  ) AS identity_key
FROM routing.routing_barriers c
JOIN (SELECT DISTINCT identity_key FROM direct_barriers_stage) s
  ON system.pipeline_osm_identity_key(
       coalesce(
         nullif(btrim(c.external_id), ''),
         nullif(btrim(c.source_refs->>'external_id'), ''),
         nullif(btrim(c.source_refs->>'osm_external_id'), ''),
         CASE
           WHEN nullif(btrim(c.source_refs->>'osm_id'), '') IS NOT NULL THEN
             'osm:'
             || coalesce(nullif(btrim(c.source_refs->>'osm_feature_type'), ''), 'node')
             || ':'
             || btrim(c.source_refs->>'osm_id')
         END
       )
     ) = s.identity_key;

CREATE INDEX ON direct_barriers_core (identity_key);

CREATE TEMP TABLE direct_barriers_plan AS
SELECT
  s.*,
  c.id AS target_id,
  count(c.id) OVER (PARTITION BY s.identity_key) AS target_count,
  array_remove(ARRAY[
    CASE WHEN s.classification NOT IN ('safe_new', 'safe_update') THEN 'unsupported classification' END,
    CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id <= 0 THEN 'missing/invalid local_staging_id' END,
    CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
    CASE WHEN s.identity_count > 1 THEN 'duplicate identity in file' END,
    CASE WHEN count(c.id) OVER (PARTITION BY s.identity_key) > 1
      THEN 'identity resolves to multiple Core rows' END,
    CASE WHEN s.barrier_type IS NULL THEN 'barrier_type required' END,
    CASE WHEN s.core_street_id IS NULL THEN 'core_street_id required for safe apply' END,
    CASE WHEN s.core_street_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM core.core_streets x
      WHERE x.id = s.core_street_id AND x.deleted_at IS NULL AND x.is_active
    ) THEN 'invalid core_street_id' END,
    CASE WHEN s.geom IS NULL OR ST_SRID(s.geom) <> 4326 OR GeometryType(s.geom) <> 'POINT'
      OR ST_IsEmpty(s.geom) OR NOT ST_IsValid(s.geom) THEN 'invalid Point geometry' END,
    CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL THEN 'invalid JSON' END,
    CASE WHEN s.source_feature_type IS NULL OR s.source_feature_id IS NULL
      THEN 'missing source feature identity' END,
    CASE WHEN s.classification = 'safe_update' AND c.id IS NULL THEN 'safe_update target missing' END,
    CASE WHEN s.classification = 'safe_update'
      AND (c.is_verified OR lower(c.verification_status) = 'verified')
      THEN 'safe_update target is verified' END,
    CASE WHEN s.classification = 'safe_update' AND (
      coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
      OR c.source_refs @> '{"source":"dashboard"}'::jsonb
      OR c.source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'safe_update target is manual-protected' END,
    CASE WHEN s.classification = 'safe_new' AND c.id IS NOT NULL AND (
      c.barrier_type IS DISTINCT FROM s.barrier_type
      OR c.core_street_id IS DISTINCT FROM s.core_street_id
      OR coalesce(c.access_rules, '{}'::jsonb) IS DISTINCT FROM coalesce(s.access_rules, '{}'::jsonb)
      OR NOT ST_Equals(c.geom, s.geom)
    ) THEN 'safe_new identity already exists with different data' END
  ], NULL)::text[] AS errors
FROM direct_barriers_stage s
LEFT JOIN direct_barriers_core c ON c.identity_key = s.identity_key;

DO $$
DECLARE
  n bigint;
  sample text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_barriers_plan) THEN
    RAISE EXCEPTION 'routing_barriers: CSV contains zero rows';
  END IF;
  SELECT count(*), min(array_to_string(errors, '; '))
  INTO n, sample
  FROM direct_barriers_plan
  WHERE cardinality(errors) > 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'routing_barriers: % rejected row(s): %', n, sample;
  END IF;
END $$;

CREATE TEMP TABLE direct_barriers_changes(
  action text NOT NULL,
  entity_id bigint NOT NULL,
  external_id text NOT NULL,
  before_data jsonb,
  after_data jsonb
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO routing.routing_barriers (
    barrier_type,
    core_street_id,
    geom,
    is_active,
    access_rules,
    source_registry_id,
    source_snapshot_id,
    source_feature_type,
    source_feature_id,
    external_id,
    source_refs,
    normalized_data,
    is_verified,
    verification_status
  )
  SELECT
    s.barrier_type,
    s.core_street_id,
    s.geom::geometry(Point, 4326),
    true,
    s.access_rules,
    p.source_registry_id,
    p.source_snapshot_id,
    s.source_feature_type,
    s.source_feature_id,
    s.external_id,
    s.source_refs || jsonb_build_object(
      'external_id', s.external_id,
      'access_tags', coalesce(s.access_rules, '{}'::jsonb),
      'source_snapshot_version', p.snapshot_version,
      'region_code', p.region_code,
      'loader', 'direct_core.routing_barriers'
    ),
    s.normalized_data || jsonb_build_object(
      'access_rules', coalesce(s.access_rules, '{}'::jsonb),
      'local_staging_id', s.local_staging_id,
      'import_class', s.classification
    ),
    false,
    'unverified'
  FROM direct_barriers_plan s
  CROSS JOIN direct_barriers_params p
  WHERE s.classification = 'safe_new'
    AND s.target_id IS NULL
  RETURNING *
)
INSERT INTO direct_barriers_changes
SELECT 'insert', i.id, i.external_id, NULL, to_jsonb(i)
FROM ins i;

WITH upd AS (
  UPDATE routing.routing_barriers c
  SET
    barrier_type = s.barrier_type,
    core_street_id = s.core_street_id,
    geom = s.geom::geometry(Point, 4326),
    access_rules = s.access_rules,
    source_registry_id = p.source_registry_id,
    source_snapshot_id = p.source_snapshot_id,
    source_feature_type = s.source_feature_type,
    source_feature_id = s.source_feature_id,
    external_id = s.external_id,
    source_refs = c.source_refs || s.source_refs || jsonb_build_object(
      'external_id', s.external_id,
      'access_tags', coalesce(s.access_rules, '{}'::jsonb),
      'source_snapshot_version', p.snapshot_version,
      'region_code', p.region_code,
      'loader', 'direct_core.routing_barriers'
    ),
    normalized_data = c.normalized_data || s.normalized_data || jsonb_build_object(
      'access_rules', coalesce(s.access_rules, '{}'::jsonb),
      'local_staging_id', s.local_staging_id,
      'import_class', s.classification
    ),
    updated_at = now()
  FROM direct_barriers_plan s
  CROSS JOIN direct_barriers_params p
  WHERE c.id = s.target_id
    AND s.classification = 'safe_update'
    AND (
      c.barrier_type,
      c.core_street_id,
      c.geom,
      coalesce(c.access_rules, '{}'::jsonb),
      c.external_id
    ) IS DISTINCT FROM (
      s.barrier_type,
      s.core_street_id,
      s.geom,
      coalesce(s.access_rules, '{}'::jsonb),
      s.external_id
    )
  RETURNING c.id, c.external_id, to_jsonb(c) AS after_data
)
INSERT INTO direct_barriers_changes
SELECT
  'update',
  u.id,
  u.external_id,
  to_jsonb(b),
  u.after_data
FROM upd u
LEFT JOIN direct_barriers_core b ON b.id = u.id;

CREATE TEMP TABLE direct_barriers_audit(
  import_batch_id bigint,
  publish_batch_id bigint
) ON COMMIT DROP;

WITH ib AS (
  INSERT INTO system.system_import_batches (
    source_registry_id, batch_name, trigger_type, status, finished_at, note
  )
  SELECT
    source_registry_id,
    format(
      'direct_core_routing_barriers:%s:%s:%s',
      region_code,
      snapshot_version,
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'manual',
    'completed',
    now(),
    'National direct-Core routing-barriers batch import'
  FROM direct_barriers_params
  RETURNING id
),
pb AS (
  INSERT INTO system.system_publish_batches (
    batch_name, status, note, source_snapshot_version, region_code,
    total_item_count, success_count, failed_count, skipped_count,
    summary, published_at, promoted_at
  )
  SELECT
    format(
      'direct_core_routing_barriers:%s:%s:%s',
      region_code,
      snapshot_version,
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'promoted',
    'National direct-Core routing-barriers batch import',
    snapshot_version,
    region_code,
    (SELECT count(*) FROM direct_barriers_plan),
    (SELECT count(*) FROM direct_barriers_changes),
    0,
    (SELECT count(*) FROM direct_barriers_plan) - (SELECT count(*) FROM direct_barriers_changes),
    jsonb_build_object(
      'loader', 'direct_core.routing_barriers',
      'transaction_scope', 'batch',
      'valhalla_rebuilt', false,
      'inserted', (SELECT count(*) FROM direct_barriers_changes WHERE action = 'insert'),
      'updated', (SELECT count(*) FROM direct_barriers_changes WHERE action = 'update')
    ),
    now(),
    now()
  FROM direct_barriers_params
  RETURNING id
)
INSERT INTO direct_barriers_audit
SELECT ib.id, pb.id FROM ib CROSS JOIN pb;

INSERT INTO system.system_publish_items (
  publish_batch_id, entity_family, entity_id, publish_action, publish_status,
  external_id, target_schema, target_table, target_id, before_data, after_data,
  validation_result, published_at, source_snapshot_version
)
SELECT
  a.publish_batch_id,
  'routing_barriers',
  c.entity_id,
  c.action,
  'success',
  c.external_id,
  'routing',
  'routing_barriers',
  c.entity_id,
  c.before_data,
  c.after_data,
  '{"validated":true,"source":"local_pipeline"}'::jsonb,
  now(),
  p.snapshot_version
FROM direct_barriers_changes c
CROSS JOIN direct_barriers_audit a
CROSS JOIN direct_barriers_params p;

DO $$
DECLARE
  staged bigint;
  resolved bigint;
BEGIN
  SELECT count(*) INTO staged FROM direct_barriers_plan;
  SELECT count(*) INTO resolved
  FROM direct_barriers_plan s
  WHERE EXISTS (
    SELECT 1
    FROM routing.routing_barriers c
    WHERE c.is_active
      AND system.pipeline_osm_identity_key(
            coalesce(c.external_id, c.source_refs->>'external_id', c.source_refs->>'osm_external_id')
          ) = s.identity_key
  );
  IF staged <> resolved THEN
    RAISE EXCEPTION 'routing_barriers verification: staged=% resolved=%', staged, resolved;
  END IF;
END $$;

SELECT
  'direct_core_routing_barriers' AS section,
  (SELECT count(*) FROM direct_barriers_plan) AS staged,
  count(*) FILTER (WHERE action = 'insert') AS inserted,
  count(*) FILTER (WHERE action = 'update') AS updated,
  (SELECT publish_batch_id FROM direct_barriers_audit) AS publish_batch_id,
  (SELECT dry_run FROM direct_barriers_params) AS dry_run
FROM direct_barriers_changes;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
