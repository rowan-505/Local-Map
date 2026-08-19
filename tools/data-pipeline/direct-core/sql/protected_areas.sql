-- Direct-Core protected areas loader (overlay family).
-- Classification: OSM tags → stable CoreMap code → resolve ref.ref_protected_area_classes.id
-- Never trust local numeric class IDs from the CSV.
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE TEMP TABLE direct_protected_areas_params (
  source_registry_id bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO direct_protected_areas_params
SELECT r.id, s.id, s.snapshot_version, :'region_code', :'dry_run'::boolean
FROM system.system_source_registry r
JOIN system.system_source_snapshots s
  ON s.source_registry_id = r.id
 AND s.snapshot_version = :'snapshot_version'
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_protected_areas_params) THEN
    RAISE EXCEPTION 'protected_areas: active source/snapshot not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:protected_areas:' || (SELECT region_code FROM direct_protected_areas_params), 0));
END $$;

CREATE TEMP TABLE direct_protected_areas_raw (
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
  normalized_data text
) ON COMMIT DROP;

\copy direct_protected_areas_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(v), '')::bigint;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.direct_try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(v), '')::numeric;
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

CREATE TEMP TABLE direct_protected_areas_stage AS
SELECT
  row_number() OVER ()::bigint AS row_no,
  lower(nullif(btrim(classification), '')) AS classification,
  pg_temp.direct_try_bigint(local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(external_id) AS identity_key,
  system.pipeline_osm_identity_key(external_id) AS external_id,
  nullif(btrim(name_und), '') AS name_und,
  nullif(btrim(name_my), '') AS name_my,
  nullif(btrim(name_en), '') AS name_en,
  lower(nullif(btrim(class_code), '')) AS class_code,
  (
    SELECT pac.id
    FROM ref.ref_protected_area_classes pac
    WHERE pac.is_active IS TRUE
      AND pac.code = lower(nullif(btrim(class_code), ''))
    ORDER BY pac.sort_order ASC NULLS LAST, pac.id ASC
    LIMIT 1
  ) AS protected_area_class_id,
  pg_temp.direct_try_geometry(geom_ewkt) AS geom,
  pg_temp.direct_try_numeric(confidence_score) AS confidence_score,
  pg_temp.direct_try_jsonb(source_tags) AS source_tags,
  pg_temp.direct_try_jsonb(source_refs) AS source_refs,
  pg_temp.direct_try_jsonb(normalized_data) AS normalized_data,
  CASE
    WHEN system.pipeline_osm_identity_key(external_id) ~ '^osm:way:' THEN 'way'
    WHEN system.pipeline_osm_identity_key(external_id) ~ '^osm:relation:' THEN 'relation'
    ELSE NULL
  END AS source_feature_type,
  CASE
    WHEN system.pipeline_osm_identity_key(external_id) ~ '^osm:(way|relation):[0-9]+$'
      THEN split_part(system.pipeline_osm_identity_key(external_id), ':', 3)::bigint
    ELSE NULL
  END AS source_feature_id,
  count(*) OVER (PARTITION BY system.pipeline_osm_identity_key(external_id)) AS identity_count
FROM direct_protected_areas_raw;

CREATE INDEX ON direct_protected_areas_stage (identity_key);

CREATE TEMP TABLE direct_protected_areas_core AS
SELECT c.*
FROM core.core_protected_areas c
JOIN (SELECT DISTINCT identity_key FROM direct_protected_areas_stage) s
  ON system.pipeline_osm_identity_key(c.external_id) = s.identity_key;

CREATE INDEX ON direct_protected_areas_core (system.pipeline_osm_identity_key(external_id));

CREATE TEMP TABLE direct_protected_areas_plan AS
SELECT
  s.*,
  c.id AS target_id,
  c.deleted_at AS target_deleted_at,
  c.manual_override AS target_manual_override,
  c.is_verified AS target_is_verified,
  c.verification_status AS target_verification_status,
  count(c.id) OVER (PARTITION BY s.identity_key) AS target_count,
  ST_PointOnSurface(s.geom)::geometry(Point, 4326) AS centroid,
  ST_Area(s.geom::geography)::numeric AS area_m2,
  array_remove(ARRAY[
    CASE WHEN s.classification NOT IN ('safe_new', 'safe_update')
      THEN 'unsupported classification' END,
    CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id <= 0
      THEN 'missing/invalid local_staging_id' END,
    CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
    CASE WHEN s.identity_count > 1 THEN 'duplicate identity in file' END,
    CASE WHEN count(c.id) OVER (PARTITION BY s.identity_key) > 1
      THEN 'identity resolves to multiple Core rows' END,
    CASE WHEN s.class_code IS NULL THEN 'class_code required' END,
    CASE WHEN s.protected_area_class_id IS NULL THEN
      'protected_area_class_id could not be resolved from class_code' END,
    CASE WHEN s.source_feature_type IS NULL OR s.source_feature_id IS NULL
      THEN 'missing source feature identity' END,
    CASE WHEN s.geom IS NULL OR ST_SRID(s.geom) <> 4326
      OR GeometryType(s.geom) <> 'MULTIPOLYGON'
      OR ST_IsEmpty(s.geom) OR NOT ST_IsValid(s.geom)
      THEN 'invalid MultiPolygon geometry' END,
    CASE WHEN s.confidence_score IS NULL OR s.confidence_score NOT BETWEEN 0 AND 100
      THEN 'confidence_score outside 0..100' END,
    CASE WHEN s.source_tags IS NULL OR s.source_refs IS NULL OR s.normalized_data IS NULL
      THEN 'invalid JSON' END,
    CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL
      THEN 'identity belongs to soft-deleted Core row' END,
    CASE WHEN s.classification = 'safe_update' AND c.id IS NULL
      THEN 'safe_update target missing' END,
    CASE WHEN s.classification = 'safe_update'
      AND (c.is_verified OR lower(c.verification_status) = 'verified')
      THEN 'safe_update target is verified' END,
    CASE WHEN s.classification = 'safe_update'
      AND (
        c.manual_override
        OR coalesce((c.source_refs->>'manual_override') IN ('true', 't', '1'), false)
        OR c.source_refs @> '{"source":"dashboard"}'::jsonb
        OR c.source_refs @> '{"source":"manual"}'::jsonb
      )
      THEN 'safe_update target is manual-protected' END,
    CASE WHEN s.classification = 'safe_new' AND c.id IS NOT NULL
      AND (
        c.protected_area_class_id IS DISTINCT FROM s.protected_area_class_id
        OR NOT ST_Equals(c.geom, s.geom)
      )
      THEN 'safe_new identity already exists with different data' END
  ], NULL)::text[] AS errors
FROM direct_protected_areas_stage s
LEFT JOIN direct_protected_areas_core c
  ON system.pipeline_osm_identity_key(c.external_id) = s.identity_key;

-- Manual/verified conflicts → review queue, not hard reject of the whole batch.
CREATE TEMP TABLE direct_protected_areas_to_review ON COMMIT DROP AS
SELECT *
FROM direct_protected_areas_plan
WHERE errors && ARRAY[
  'safe_update target is verified',
  'safe_update target is manual-protected',
  'safe_new identity already exists with different data'
];

UPDATE direct_protected_areas_plan p
SET errors = ARRAY(
  SELECT e
  FROM unnest(p.errors) AS e
  WHERE e NOT IN (
    'safe_update target is verified',
    'safe_update target is manual-protected',
    'safe_new identity already exists with different data'
  )
)
WHERE p.row_no IN (SELECT row_no FROM direct_protected_areas_to_review);

DO $$
DECLARE
  n bigint;
  sample text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_protected_areas_plan) THEN
    RAISE EXCEPTION 'protected_areas: CSV contains zero rows';
  END IF;
  SELECT count(*), min(array_to_string(errors, '; '))
  INTO n, sample
  FROM direct_protected_areas_plan
  WHERE cardinality(errors) > 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'protected_areas: % rejected row(s): %', n, sample;
  END IF;
END $$;

CREATE TEMP TABLE direct_protected_areas_changes (
  action text NOT NULL,
  entity_id bigint NOT NULL,
  external_id text NOT NULL,
  before_data jsonb,
  after_data jsonb
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO core.core_protected_areas (
    protected_area_class_id,
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
    is_active,
    manual_override,
    verification_status
  )
  SELECT
    s.protected_area_class_id,
    s.geom::geometry(MultiPolygon, 4326),
    s.centroid,
    s.area_m2,
    s.external_id,
    p.source_registry_id,
    p.source_snapshot_id,
    s.source_feature_type,
    s.source_feature_id,
    'MM',
    s.source_tags,
    s.source_refs || jsonb_build_object(
      'external_id', s.external_id,
      'source_snapshot_version', p.snapshot_version,
      'region_code', 'MM',
      'loader', 'direct_core.protected_areas'
    ),
    s.normalized_data || jsonb_build_object(
      'local_staging_id', s.local_staging_id,
      'import_class', s.classification,
      'protected_area_class', s.class_code
    ),
    s.confidence_score,
    true,
    false,
    'unverified'
  FROM direct_protected_areas_plan s
  CROSS JOIN direct_protected_areas_params p
  WHERE s.classification = 'safe_new'
    AND s.target_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
    )
  RETURNING id, external_id
)
INSERT INTO direct_protected_areas_changes (action, entity_id, external_id, before_data, after_data)
SELECT 'insert', i.id, i.external_id, NULL, NULL
FROM ins i;

DO $$
DECLARE
  v_expected bigint;
  v_inserted bigint;
BEGIN
  SELECT count(*) INTO v_expected
  FROM direct_protected_areas_plan s
  WHERE s.classification = 'safe_new'
    AND s.target_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
    );
  SELECT count(*) INTO v_inserted
  FROM direct_protected_areas_changes
  WHERE action = 'insert';
  RAISE NOTICE 'protected_areas: safe_new expected=% inserted=%', v_expected, v_inserted;
  IF v_expected > 0 AND v_inserted = 0 THEN
    RAISE EXCEPTION 'protected_areas: expected % safe_new inserts but inserted 0', v_expected;
  END IF;
END $$;

WITH upd AS (
  UPDATE core.core_protected_areas c
  SET
    protected_area_class_id = s.protected_area_class_id,
    geom = s.geom::geometry(MultiPolygon, 4326),
    centroid = s.centroid,
    area_m2 = s.area_m2,
    source_registry_id = coalesce(c.source_registry_id, p.source_registry_id),
    source_snapshot_id = p.source_snapshot_id,
    source_feature_type = coalesce(c.source_feature_type, s.source_feature_type),
    source_feature_id = coalesce(c.source_feature_id, s.source_feature_id),
    region_code = coalesce(c.region_code, 'MM'),
    source_tags = s.source_tags,
    source_refs = c.source_refs || s.source_refs || jsonb_build_object(
      'external_id', s.external_id,
      'source_snapshot_version', p.snapshot_version,
      'region_code', 'MM',
      'loader', 'direct_core.protected_areas'
    ),
    normalized_data = c.normalized_data || s.normalized_data || jsonb_build_object(
      'local_staging_id', s.local_staging_id,
      'import_class', s.classification,
      'protected_area_class', s.class_code
    ),
    confidence_score = s.confidence_score,
    updated_at = now()
  FROM direct_protected_areas_plan s
  CROSS JOIN direct_protected_areas_params p
  WHERE c.id = s.target_id
    AND s.classification = 'safe_update'
    AND NOT EXISTS (
      SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
    )
    AND (
      c.protected_area_class_id,
      c.geom,
      c.centroid,
      c.area_m2,
      c.source_tags,
      c.source_refs,
      c.normalized_data,
      c.confidence_score,
      c.source_snapshot_id
    ) IS DISTINCT FROM (
      s.protected_area_class_id,
      s.geom,
      s.centroid,
      s.area_m2,
      s.source_tags,
      c.source_refs || s.source_refs || jsonb_build_object(
        'external_id', s.external_id,
        'source_snapshot_version', p.snapshot_version,
        'region_code', 'MM',
        'loader', 'direct_core.protected_areas'
      ),
      c.normalized_data || s.normalized_data || jsonb_build_object(
        'local_staging_id', s.local_staging_id,
        'import_class', s.classification,
        'protected_area_class', s.class_code
      ),
      s.confidence_score,
      p.source_snapshot_id
    )
  RETURNING c.id, c.external_id
)
INSERT INTO direct_protected_areas_changes (action, entity_id, external_id, before_data, after_data)
SELECT 'update', u.id, u.external_id, to_jsonb(b), NULL
FROM upd u
JOIN direct_protected_areas_core b ON b.id = u.id;

-- Names upsert (primary per language/type). Skip identical und when same as en/my.
CREATE TEMP TABLE direct_protected_areas_name_source AS
SELECT
  coalesce(c.entity_id, s.target_id) AS protected_area_id,
  s.name_my,
  s.name_en,
  s.name_und
FROM direct_protected_areas_plan s
LEFT JOIN direct_protected_areas_changes c ON c.external_id = s.external_id
WHERE coalesce(c.entity_id, s.target_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
  );

INSERT INTO core.core_protected_area_names (
  protected_area_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT protected_area_id, name, lang, script, 'official', true, 100
FROM direct_protected_areas_name_source s
CROSS JOIN LATERAL (
  VALUES
    (s.name_my, 'my', 'Mymr'),
    (s.name_en, 'en', 'Latn'),
    (
      CASE
        WHEN s.name_und IS NOT NULL
          AND s.name_und IS DISTINCT FROM s.name_en
          AND s.name_und IS DISTINCT FROM s.name_my
        THEN s.name_und
        ELSE NULL
      END,
      'und',
      NULL
    )
) n(name, lang, script)
WHERE nullif(btrim(name), '') IS NOT NULL
ON CONFLICT (protected_area_id, language_code, name_type) WHERE is_primary IS TRUE
DO UPDATE SET
  name = EXCLUDED.name,
  script_code = EXCLUDED.script_code,
  search_weight = 100,
  updated_at = now()
WHERE (
  core_protected_area_names.name,
  core_protected_area_names.script_code,
  core_protected_area_names.search_weight
) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.script_code, 100);

CREATE TEMP TABLE direct_protected_areas_audit (
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
      'direct_core_protected_areas:%s:%s:%s',
      region_code,
      snapshot_version,
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'manual',
    'completed',
    now(),
    'National direct-Core protected-areas import'
  FROM direct_protected_areas_params
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
      'direct_core_protected_areas:%s:%s:%s',
      region_code,
      snapshot_version,
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')
    ),
    'promoted',
    'National direct-Core protected-areas import',
    snapshot_version,
    region_code,
    (SELECT count(*) FROM direct_protected_areas_plan),
    (SELECT count(*) FROM direct_protected_areas_changes),
    0,
    (SELECT count(*) FROM direct_protected_areas_plan)
      - (SELECT count(*) FROM direct_protected_areas_changes),
    jsonb_build_object(
      'loader', 'direct_core.protected_areas',
      'transaction_scope', 'national_protected_areas',
      'inserted', (SELECT count(*) FROM direct_protected_areas_changes WHERE action = 'insert'),
      'updated', (SELECT count(*) FROM direct_protected_areas_changes WHERE action = 'update'),
      'manual_or_verified_to_review', (SELECT count(*) FROM direct_protected_areas_to_review)
    ),
    now(),
    now()
  FROM direct_protected_areas_params
  RETURNING id
)
INSERT INTO direct_protected_areas_audit
SELECT ib.id, pb.id FROM ib CROSS JOIN pb;

INSERT INTO system.system_publish_items (
  publish_batch_id, entity_family, entity_id, publish_action, publish_status,
  external_id, target_schema, target_table, target_id, before_data, after_data,
  validation_result, published_at, source_snapshot_version
)
SELECT
  a.publish_batch_id,
  'protected_areas',
  c.entity_id,
  c.action,
  'success',
  c.external_id,
  'core',
  'core_protected_areas',
  c.entity_id,
  c.before_data,
  c.after_data,
  '{"validated":true,"source":"local_pipeline"}'::jsonb,
  now(),
  p.snapshot_version
FROM direct_protected_areas_changes c
CROSS JOIN direct_protected_areas_audit a
CROSS JOIN direct_protected_areas_params p;

DO $$
DECLARE
  staged bigint;
  resolved bigint;
BEGIN
  SELECT count(*) INTO staged
  FROM direct_protected_areas_plan s
  WHERE NOT EXISTS (
    SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
  );
  SELECT count(*) INTO resolved
  FROM direct_protected_areas_plan s
  WHERE NOT EXISTS (
    SELECT 1 FROM direct_protected_areas_to_review r WHERE r.row_no = s.row_no
  )
  AND EXISTS (
    SELECT 1
    FROM core.core_protected_areas c
    WHERE c.deleted_at IS NULL
      AND system.pipeline_osm_identity_key(c.external_id) = s.identity_key
  );
  IF staged <> resolved THEN
    RAISE EXCEPTION 'protected_areas verification: staged=% resolved=%', staged, resolved;
  END IF;
END $$;

SELECT
  'direct_core_protected_areas' AS section,
  (SELECT count(*) FROM direct_protected_areas_plan) AS staged,
  count(*) FILTER (WHERE action = 'insert') AS inserted,
  count(*) FILTER (WHERE action = 'update') AS updated,
  (SELECT count(*) FROM direct_protected_areas_to_review) AS to_review,
  (SELECT publish_batch_id FROM direct_protected_areas_audit) AS publish_batch_id,
  (SELECT dry_run FROM direct_protected_areas_params) AS dry_run
FROM direct_protected_areas_changes;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
