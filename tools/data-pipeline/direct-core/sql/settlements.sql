\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

DO $$
BEGIN
  IF to_regclass('core.core_settlements') IS NULL
     OR to_regclass('ref.ref_settlement_types') IS NULL THEN
    RAISE EXCEPTION
      'settlements: core.core_settlements / ref.ref_settlement_types missing; apply supabase migration 192 first';
  END IF;
END $$;

CREATE TEMP TABLE direct_settlements_params (
  source_registry_id bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  source_type_id bigint NOT NULL,
  dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO direct_settlements_params
SELECT r.id, s.id, s.snapshot_version, :'region_code', st.id, :'dry_run'::boolean
FROM system.system_source_registry r
JOIN system.system_source_snapshots s
  ON s.source_registry_id = r.id
 AND s.snapshot_version = :'snapshot_version'
JOIN ref.ref_source_types st ON st.code = 'osm'
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_settlements_params) THEN
    RAISE EXCEPTION 'settlements: active osm_myanmar source/snapshot/osm source type not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:settlements:' || (SELECT region_code FROM direct_settlements_params), 0
  ));
END $$;

CREATE TEMP TABLE direct_settlements_raw (
  classification text,
  local_staging_id text,
  external_id text,
  canonical_name text,
  name_mm text,
  name_en text,
  class_code text,
  township_id text,
  population text,
  point_ewkt text,
  source_refs text,
  normalized_data text
) ON COMMIT DROP;

\copy direct_settlements_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(v), '')::bigint;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_int(v text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(v), '')::integer;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN coalesce(nullif(btrim(v), '')::jsonb, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN ST_GeomFromEWKT(nullif(btrim(v), ''));
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE TEMP TABLE direct_settlements_stage AS
SELECT
  row_number() OVER ()::bigint AS row_no,
  lower(nullif(btrim(r.classification), '')) AS classification,
  pg_temp.direct_try_bigint(r.local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(r.external_id) AS identity_key,
  system.pipeline_osm_identity_key(r.external_id) AS external_id,
  nullif(btrim(r.canonical_name), '') AS canonical_name,
  nullif(btrim(r.name_mm), '') AS name_mm,
  nullif(btrim(r.name_en), '') AS name_en,
  lower(nullif(btrim(r.class_code), '')) AS class_code,
  (
    SELECT t.id
    FROM ref.ref_settlement_types t
    WHERE t.code = lower(nullif(btrim(r.class_code), ''))
    ORDER BY t.id
    LIMIT 1
  ) AS settlement_type_id,
  pg_temp.direct_try_bigint(r.township_id) AS township_id,
  pg_temp.direct_try_int(r.population) AS population,
  pg_temp.direct_try_geometry(r.point_ewkt) AS point_geom,
  pg_temp.direct_try_jsonb(r.source_refs) AS source_refs,
  pg_temp.direct_try_jsonb(r.normalized_data) AS normalized_data,
  count(*) OVER (
    PARTITION BY system.pipeline_osm_identity_key(r.external_id)
  ) AS identity_count
FROM direct_settlements_raw r;

CREATE INDEX ON direct_settlements_stage (identity_key);

CREATE TEMP TABLE direct_settlements_core AS
SELECT c.*
FROM core.core_settlements c
JOIN (SELECT DISTINCT identity_key FROM direct_settlements_stage) s
  ON system.pipeline_osm_identity_key(c.external_id) = s.identity_key;
CREATE INDEX ON direct_settlements_core (system.pipeline_osm_identity_key(external_id));

CREATE TEMP TABLE direct_settlements_plan AS
SELECT
  s.*,
  c.id AS target_id,
  c.deleted_at AS target_deleted_at,
  count(c.id) OVER (PARTITION BY s.identity_key) AS target_count,
  array_remove(ARRAY[
    CASE WHEN s.classification NOT IN('safe_new','safe_update')
         THEN 'unsupported classification' END,
    CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id <= 0
         THEN 'missing/invalid local_staging_id' END,
    CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
    CASE WHEN s.identity_count > 1 THEN 'duplicate identity in file' END,
    CASE WHEN count(c.id) OVER (PARTITION BY s.identity_key) > 1
         THEN 'identity resolves to multiple Core rows' END,
    CASE WHEN s.canonical_name IS NULL THEN 'canonical_name required' END,
    CASE WHEN s.class_code IS NULL OR s.class_code NOT IN ('city', 'town', 'village', 'local_area')
         THEN 'invalid class_code' END,
    CASE WHEN s.settlement_type_id IS NULL
         THEN 'settlement_type_id could not be resolved from class_code' END,
    CASE WHEN s.township_id IS NULL THEN 'township_id required' END,
    CASE WHEN s.township_id IS NOT NULL AND NOT EXISTS (
           SELECT 1
           FROM core.core_admin_areas aa
           JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
           WHERE aa.id = s.township_id
             AND aa.deleted_at IS NULL
             AND lower(btrim(al.code)) = 'township'
         ) THEN 'township_id is not a live township admin area' END,
    CASE WHEN s.point_geom IS NULL OR ST_SRID(s.point_geom) <> 4326
              OR GeometryType(s.point_geom) <> 'POINT'
              OR ST_IsEmpty(s.point_geom) OR NOT ST_IsValid(s.point_geom)
         THEN 'invalid Point geometry' END,
    CASE WHEN s.population IS NOT NULL AND s.population < 0
         THEN 'population must be >= 0' END,
    CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL
         THEN 'invalid JSON' END,
    CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL
         THEN 'identity belongs to soft-deleted Core row' END,
    CASE WHEN s.classification = 'safe_update' AND c.id IS NULL
         THEN 'safe_update target missing' END,
    CASE WHEN s.classification = 'safe_update' AND (
              c.is_verified OR lower(c.verification_status) = 'verified'
            )
         THEN 'safe_update target is verified' END,
    CASE WHEN s.classification = 'safe_update' AND (
              coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
              OR c.source_refs @> '{"source":"dashboard"}'::jsonb
              OR c.source_refs @> '{"source":"manual"}'::jsonb
            )
         THEN 'safe_update target is manual-protected' END,
    CASE WHEN s.classification = 'safe_new' AND c.id IS NOT NULL AND (
              c.canonical_name IS DISTINCT FROM s.canonical_name
              OR c.settlement_type_id IS DISTINCT FROM s.settlement_type_id
              OR c.township_id IS DISTINCT FROM s.township_id
              OR NOT ST_Equals(c.point_geom, s.point_geom)
            )
         THEN 'safe_new identity already exists with different data' END
  ], NULL)::text[] AS errors
FROM direct_settlements_stage s
LEFT JOIN direct_settlements_core c
  ON system.pipeline_osm_identity_key(c.external_id) = s.identity_key;

DO $$
DECLARE n bigint; sample text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_settlements_plan) THEN
    RAISE EXCEPTION 'settlements: CSV contains zero rows';
  END IF;
  SELECT count(*), min(array_to_string(errors, '; '))
  INTO n, sample
  FROM direct_settlements_plan
  WHERE cardinality(errors) > 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'settlements: % rejected row(s): %', n, sample;
  END IF;
END $$;

CREATE TEMP TABLE direct_settlements_changes (
  action text NOT NULL,
  entity_id bigint NOT NULL,
  external_id text NOT NULL,
  before_data jsonb,
  after_data jsonb
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO core.core_settlements (
    settlement_type_id, canonical_name, name_mm, name_en,
    point_geom, township_id, population,
    external_id, source_type_id, source_refs,
    is_public, is_verified, verification_status
  )
  SELECT
    p.settlement_type_id,
    p.canonical_name,
    p.name_mm,
    p.name_en,
    p.point_geom::geometry(Point, 4326),
    p.township_id,
    p.population,
    p.external_id,
    q.source_type_id,
    coalesce(p.source_refs, '{}'::jsonb) || jsonb_build_object(
      'external_id', p.external_id,
      'source_snapshot_version', q.snapshot_version,
      'region_code', q.region_code,
      'loader', 'direct_core.settlements',
      'local_staging_id', p.local_staging_id,
      'import_class', p.classification,
      'source_place_type', p.normalized_data->>'source_place_type'
    ),
    true,
    false,
    'unverified'
  FROM direct_settlements_plan p
  CROSS JOIN direct_settlements_params q
  WHERE p.classification = 'safe_new'
    AND p.target_id IS NULL
  RETURNING *
)
INSERT INTO direct_settlements_changes
SELECT 'insert', i.id, i.external_id, NULL, to_jsonb(i)
FROM ins i;

WITH upd AS (
  UPDATE core.core_settlements c SET
    settlement_type_id = p.settlement_type_id,
    canonical_name = p.canonical_name,
    name_mm = p.name_mm,
    name_en = p.name_en,
    point_geom = p.point_geom::geometry(Point, 4326),
    township_id = p.township_id,
    population = p.population,
    source_type_id = coalesce(c.source_type_id, q.source_type_id),
    source_refs = coalesce(c.source_refs, '{}'::jsonb)
      || coalesce(p.source_refs, '{}'::jsonb)
      || jsonb_build_object(
        'external_id', p.external_id,
        'source_snapshot_version', q.snapshot_version,
        'region_code', q.region_code,
        'loader', 'direct_core.settlements',
        'local_staging_id', p.local_staging_id,
        'import_class', p.classification,
        'source_place_type', p.normalized_data->>'source_place_type'
      ),
    updated_at = now()
  FROM direct_settlements_plan p
  CROSS JOIN direct_settlements_params q
  WHERE c.id = p.target_id
    AND p.classification = 'safe_update'
    AND (
      c.settlement_type_id,
      c.canonical_name,
      c.name_mm,
      c.name_en,
      c.point_geom,
      c.township_id,
      c.population,
      c.source_refs
    ) IS DISTINCT FROM (
      p.settlement_type_id,
      p.canonical_name,
      p.name_mm,
      p.name_en,
      p.point_geom,
      p.township_id,
      p.population,
      coalesce(c.source_refs, '{}'::jsonb)
        || coalesce(p.source_refs, '{}'::jsonb)
        || jsonb_build_object(
          'external_id', p.external_id,
          'source_snapshot_version', q.snapshot_version,
          'region_code', q.region_code,
          'loader', 'direct_core.settlements',
          'local_staging_id', p.local_staging_id,
          'import_class', p.classification,
          'source_place_type', p.normalized_data->>'source_place_type'
        )
    )
  RETURNING c.id, c.external_id
)
INSERT INTO direct_settlements_changes
SELECT 'update', u.id, u.external_id, to_jsonb(b), to_jsonb(a)
FROM upd u
JOIN direct_settlements_core b ON b.id = u.id
JOIN core.core_settlements a ON a.id = u.id;

CREATE TEMP TABLE direct_settlements_audit (
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
      'direct_core_settlements:%s:%s:%s',
      region_code, snapshot_version, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'manual',
    'completed',
    now(),
    'Regional direct-Core settlements bulk import'
  FROM direct_settlements_params
  RETURNING id
), pb AS (
  INSERT INTO system.system_publish_batches (
    batch_name, status, note, source_snapshot_version, region_code,
    total_item_count, success_count, failed_count, skipped_count, summary,
    published_at, promoted_at
  )
  SELECT
    format(
      'direct_core_settlements:%s:%s:%s',
      region_code, snapshot_version, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'promoted',
    'Regional direct-Core settlements bulk import',
    snapshot_version,
    region_code,
    (SELECT count(*) FROM direct_settlements_plan),
    (SELECT count(*) FROM direct_settlements_changes),
    0,
    (SELECT count(*) FROM direct_settlements_plan)
      - (SELECT count(*) FROM direct_settlements_changes),
    jsonb_build_object(
      'loader', 'direct_core.settlements',
      'transaction_scope', 'region',
      'inserted', (SELECT count(*) FROM direct_settlements_changes WHERE action = 'insert'),
      'updated', (SELECT count(*) FROM direct_settlements_changes WHERE action = 'update')
    ),
    now(),
    now()
  FROM direct_settlements_params
  RETURNING id
)
INSERT INTO direct_settlements_audit
SELECT ib.id, pb.id FROM ib CROSS JOIN pb;

INSERT INTO system.system_publish_items (
  publish_batch_id, entity_family, entity_id, publish_action, publish_status,
  external_id, target_schema, target_table, target_id, before_data, after_data,
  validation_result, published_at, source_snapshot_version
)
SELECT
  a.publish_batch_id,
  'settlements',
  c.entity_id,
  c.action,
  'success',
  c.external_id,
  'core',
  'core_settlements',
  c.entity_id,
  c.before_data,
  c.after_data,
  '{"validated":true,"source":"local_pipeline"}'::jsonb,
  now(),
  p.snapshot_version
FROM direct_settlements_changes c
CROSS JOIN direct_settlements_audit a
CROSS JOIN direct_settlements_params p;

DO $$
DECLARE staged bigint; resolved bigint; changed bigint;
BEGIN
  SELECT count(*) INTO staged FROM direct_settlements_plan;
  SELECT count(*) INTO resolved
  FROM direct_settlements_plan p
  WHERE EXISTS (
    SELECT 1
    FROM core.core_settlements c
    WHERE c.deleted_at IS NULL
      AND system.pipeline_osm_identity_key(c.external_id) = p.identity_key
  );
  SELECT count(*) INTO changed FROM direct_settlements_changes;
  IF resolved <> staged THEN
    RAISE EXCEPTION 'settlements verification: staged=% resolved=%', staged, resolved;
  END IF;
  IF changed > staged THEN
    RAISE EXCEPTION 'settlements verification: impossible mutation count=%', changed;
  END IF;
END $$;

SELECT
  'direct_core_settlements' AS section,
  (SELECT count(*) FROM direct_settlements_plan) AS staged,
  count(*) FILTER (WHERE action = 'insert') AS inserted,
  count(*) FILTER (WHERE action = 'update') AS updated,
  (SELECT publish_batch_id FROM direct_settlements_audit) AS publish_batch_id,
  (SELECT dry_run FROM direct_settlements_params) AS dry_run
FROM direct_settlements_changes;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
