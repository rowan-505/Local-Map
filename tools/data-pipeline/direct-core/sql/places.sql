\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE TEMP TABLE direct_places_params (
    source_registry_id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text NOT NULL,
    source_type_id bigint NOT NULL,
    dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO direct_places_params
SELECT registry.id, snapshot.id, snapshot.snapshot_version, :'region_code',
       source_type.id, :'dry_run'::boolean
FROM system.system_source_registry registry
JOIN system.system_source_snapshots snapshot
  ON snapshot.source_registry_id = registry.id
 AND snapshot.snapshot_version = :'snapshot_version'
JOIN ref.ref_source_types source_type ON source_type.code = 'osm'
WHERE registry.source_code = 'osm_myanmar'
  AND registry.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_places_params) THEN
    RAISE EXCEPTION 'places: active osm_myanmar source/snapshot/osm source type not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:places:' || (SELECT region_code FROM direct_places_params), 0
  ));
END $$;

CREATE TEMP TABLE direct_places_raw (
    classification text,
    local_staging_id text,
    external_id text,
    primary_name text,
    name_my text,
    name_en text,
    category_id text,
    admin_area_id text,
    point_ewkt text,
    importance_score text,
    popularity_score text,
    confidence_score text,
    source_refs text,
    normalized_data text
) ON COMMIT DROP;

\copy direct_places_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v), '')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v), '')::numeric; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v), '')::jsonb, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v), '')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE direct_places_stage AS
SELECT
  row_number() OVER ()::bigint AS row_no,
  lower(nullif(btrim(r.classification), '')) AS classification,
  pg_temp.direct_try_bigint(r.local_staging_id) AS local_staging_id,
  system.pipeline_osm_identity_key(r.external_id) AS identity_key,
  system.pipeline_osm_identity_key(r.external_id) AS external_id,
  nullif(btrim(r.primary_name), '') AS primary_name,
  nullif(btrim(r.name_my), '') AS name_my,
  nullif(btrim(r.name_en), '') AS name_en,
  pg_temp.direct_try_bigint(r.category_id) AS category_id,
  pg_temp.direct_try_bigint(r.admin_area_id) AS admin_area_id,
  pg_temp.direct_try_geometry(r.point_ewkt) AS point_geom,
  pg_temp.direct_try_numeric(r.importance_score) AS importance_score,
  pg_temp.direct_try_numeric(r.popularity_score) AS popularity_score,
  pg_temp.direct_try_numeric(r.confidence_score) AS confidence_score,
  pg_temp.direct_try_jsonb(r.source_refs) AS source_refs,
  pg_temp.direct_try_jsonb(r.normalized_data) AS normalized_data,
  count(*) OVER (
    PARTITION BY system.pipeline_osm_identity_key(r.external_id)
  ) AS identity_count
FROM direct_places_raw r;

CREATE INDEX ON direct_places_stage (identity_key);

CREATE TEMP TABLE direct_places_core AS
SELECT c.*
FROM core.core_places c
JOIN (SELECT DISTINCT identity_key FROM direct_places_stage) s
  ON system.pipeline_osm_identity_key(c.external_id) = s.identity_key;
CREATE INDEX ON direct_places_core (system.pipeline_osm_identity_key(external_id));

CREATE TEMP TABLE direct_places_plan AS
SELECT s.*,
       c.id AS target_id,
       c.deleted_at AS target_deleted_at,
       count(c.id) OVER (PARTITION BY s.identity_key) AS target_count,
       c.is_verified AS target_verified,
       (
         coalesce((c.source_refs->>'manual_override') IN ('true','t','1'), false)
         OR c.source_refs @> '{"source":"dashboard"}'::jsonb
         OR c.source_refs @> '{"source":"manual"}'::jsonb
       ) AS target_manual,
       array_remove(ARRAY[
         CASE WHEN s.classification NOT IN ('safe_new','safe_update')
              THEN 'unsupported classification' END,
         CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id <= 0
              THEN 'missing/invalid local_staging_id' END,
         CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
         CASE WHEN s.identity_count > 1 THEN 'duplicate identity in file' END,
         CASE WHEN count(c.id) OVER (PARTITION BY s.identity_key) > 1
              THEN 'identity resolves to multiple Core rows' END,
         CASE WHEN s.primary_name IS NULL THEN 'primary_name required' END,
         CASE WHEN s.category_id IS NULL OR NOT EXISTS (
                    SELECT 1 FROM ref.ref_poi_categories x WHERE x.id=s.category_id
              ) THEN 'invalid category_id' END,
         CASE WHEN s.admin_area_id IS NULL OR NOT EXISTS (
                    SELECT 1 FROM core.core_admin_areas x
                    WHERE x.id=s.admin_area_id AND x.deleted_at IS NULL
              ) THEN 'invalid admin_area_id' END,
         CASE WHEN s.point_geom IS NULL OR ST_SRID(s.point_geom)<>4326
                    OR GeometryType(s.point_geom)<>'POINT'
                    OR ST_IsEmpty(s.point_geom) OR NOT ST_IsValid(s.point_geom)
              THEN 'invalid Point geometry' END,
         CASE WHEN s.importance_score IS NULL OR s.importance_score NOT BETWEEN 0 AND 100
              THEN 'importance_score outside 0..100' END,
         CASE WHEN s.popularity_score IS NULL OR s.popularity_score NOT BETWEEN 0 AND 100
              THEN 'popularity_score outside 0..100' END,
         CASE WHEN s.confidence_score IS NULL OR s.confidence_score NOT BETWEEN 0 AND 100
              THEN 'confidence_score outside 0..100' END,
         CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL
              THEN 'invalid JSON' END,
         CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL
              THEN 'identity belongs to soft-deleted Core row' END,
         CASE WHEN s.classification='safe_update' AND c.id IS NULL
              THEN 'safe_update target missing' END,
         CASE WHEN s.classification='safe_update' AND (c.is_verified OR
                    lower(c.verification_status)='verified')
              THEN 'safe_update target is verified' END,
         CASE WHEN s.classification='safe_update' AND (
                    coalesce((c.source_refs->>'manual_override') IN ('true','t','1'), false)
                    OR c.source_refs @> '{"source":"dashboard"}'::jsonb
                    OR c.source_refs @> '{"source":"manual"}'::jsonb)
              THEN 'safe_update target is manual-protected' END,
         CASE WHEN s.classification='safe_new' AND c.id IS NOT NULL AND (
                    c.primary_name IS DISTINCT FROM s.primary_name
                    OR c.category_id IS DISTINCT FROM s.category_id
                    OR c.admin_area_id IS DISTINCT FROM s.admin_area_id
                    OR NOT ST_Equals(c.point_geom, s.point_geom))
              THEN 'safe_new identity already exists with different data' END
       ], NULL)::text[] AS errors
FROM direct_places_stage s
LEFT JOIN direct_places_core c
  ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;

DO $$
DECLARE n bigint; sample text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_places_plan) THEN
    RAISE EXCEPTION 'places: CSV contains zero rows';
  END IF;
  SELECT count(*), min(array_to_string(errors, '; '))
  INTO n, sample FROM direct_places_plan WHERE cardinality(errors)>0;
  IF n>0 THEN RAISE EXCEPTION 'places: % rejected row(s): %', n, sample; END IF;
END $$;

CREATE TEMP TABLE direct_places_changes (
  action text NOT NULL,
  entity_id bigint NOT NULL,
  external_id text NOT NULL,
  before_data jsonb,
  after_data jsonb
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO core.core_places (
    primary_name, display_name, category_id, admin_area_id, point_geom, lat, lng,
    importance_score, popularity_score, confidence_score, is_public, is_verified,
    source_type_id, external_id, source_refs, normalized_data, verification_status
  )
  SELECT p.primary_name, p.primary_name, p.category_id, p.admin_area_id,
         p.point_geom::geometry(Point,4326), ST_Y(p.point_geom), ST_X(p.point_geom),
         p.importance_score, p.popularity_score, p.confidence_score, true, false,
         q.source_type_id, p.external_id,
         p.source_refs || jsonb_build_object(
           'external_id',p.external_id,'source_snapshot_version',q.snapshot_version,
           'region_code',q.region_code,'loader','direct_core.places'),
         p.normalized_data || jsonb_build_object(
           'local_staging_id',p.local_staging_id,'import_class',p.classification),
         'unverified'
  FROM direct_places_plan p CROSS JOIN direct_places_params q
  WHERE p.classification='safe_new' AND p.target_id IS NULL
  RETURNING id, external_id
)
INSERT INTO direct_places_changes
SELECT 'insert', i.id, i.external_id, NULL, to_jsonb(c)
FROM ins i JOIN core.core_places c ON c.id=i.id;

WITH upd AS (
  UPDATE core.core_places c SET
    primary_name=p.primary_name, display_name=p.primary_name,
    category_id=p.category_id, admin_area_id=p.admin_area_id,
    point_geom=p.point_geom::geometry(Point,4326),
    lat=ST_Y(p.point_geom), lng=ST_X(p.point_geom),
    importance_score=p.importance_score, popularity_score=p.popularity_score,
    confidence_score=p.confidence_score,
    source_refs=c.source_refs || p.source_refs || jsonb_build_object(
      'external_id',p.external_id,'source_snapshot_version',q.snapshot_version,
      'region_code',q.region_code,'loader','direct_core.places'),
    normalized_data=c.normalized_data || p.normalized_data || jsonb_build_object(
      'local_staging_id',p.local_staging_id,'import_class',p.classification),
    updated_at=now()
  FROM direct_places_plan p CROSS JOIN direct_places_params q
  WHERE c.id=p.target_id AND p.classification='safe_update'
    AND (
      c.primary_name,c.display_name,c.category_id,c.admin_area_id,c.point_geom,
      c.importance_score,c.popularity_score,c.confidence_score,c.source_refs,c.normalized_data
    ) IS DISTINCT FROM (
      p.primary_name,p.primary_name,p.category_id,p.admin_area_id,p.point_geom,
      p.importance_score,p.popularity_score,p.confidence_score,
      c.source_refs || p.source_refs || jsonb_build_object(
        'external_id',p.external_id,'source_snapshot_version',q.snapshot_version,
        'region_code',q.region_code,'loader','direct_core.places'),
      c.normalized_data || p.normalized_data || jsonb_build_object(
        'local_staging_id',p.local_staging_id,'import_class',p.classification)
    )
  RETURNING c.id,c.external_id
)
INSERT INTO direct_places_changes
SELECT 'update',u.id,u.external_id,to_jsonb(b),to_jsonb(a)
FROM upd u JOIN direct_places_core b ON b.id=u.id
JOIN core.core_places a ON a.id=u.id;

CREATE TEMP TABLE direct_places_name_source AS
SELECT coalesce(ch.entity_id,p.target_id) AS place_id, p.name_my, p.name_en,
       p.primary_name AS name_und
FROM direct_places_plan p
LEFT JOIN direct_places_changes ch ON ch.external_id=p.external_id
WHERE coalesce(ch.entity_id,p.target_id) IS NOT NULL;

INSERT INTO core.core_place_names (
  place_id,name,language_code,script_code,name_type,is_primary,search_weight
)
SELECT place_id,name,lang,script,'official',true,100
FROM direct_places_name_source s
CROSS JOIN LATERAL (VALUES
  (s.name_my,'my','Mymr'),(s.name_en,'en','Latn'),(s.name_und,'und',NULL)
) n(name,lang,script)
WHERE nullif(btrim(name),'') IS NOT NULL
ON CONFLICT (place_id,language_code)
WHERE name_type='official' AND is_primary=true
DO UPDATE SET name=EXCLUDED.name,script_code=EXCLUDED.script_code,search_weight=100
WHERE (core_place_names.name,core_place_names.script_code,
       core_place_names.search_weight)
  IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.script_code,100);

UPDATE core.core_place_sources x SET
  source_name='OpenStreetMap Myanmar',
  captured_at=now(),
  raw_payload=p.normalized_data
FROM direct_places_plan p, direct_places_params q
WHERE x.place_id=coalesce(p.target_id,(
        SELECT entity_id FROM direct_places_changes c WHERE c.external_id=p.external_id
      ))
  AND x.source_type_id=q.source_type_id
  AND system.pipeline_osm_identity_key(x.external_id)=p.identity_key
  AND (x.source_name,x.raw_payload)
      IS DISTINCT FROM ('OpenStreetMap Myanmar',p.normalized_data);

INSERT INTO core.core_place_sources (
  place_id,source_type_id,external_id,source_name,captured_at,raw_payload
)
SELECT coalesce(p.target_id,c.entity_id),q.source_type_id,p.external_id,
       'OpenStreetMap Myanmar',now(),p.normalized_data
FROM direct_places_plan p
CROSS JOIN direct_places_params q
LEFT JOIN direct_places_changes c ON c.external_id=p.external_id
WHERE NOT EXISTS (
  SELECT 1 FROM core.core_place_sources x
  WHERE x.place_id=coalesce(p.target_id,c.entity_id)
    AND x.source_type_id=q.source_type_id
    AND system.pipeline_osm_identity_key(x.external_id)=p.identity_key
);

CREATE TEMP TABLE direct_places_audit (
  import_batch_id bigint,
  publish_batch_id bigint
) ON COMMIT DROP;

WITH ib AS (
  INSERT INTO system.system_import_batches (
    source_registry_id,batch_name,trigger_type,status,finished_at,note
  )
  SELECT source_registry_id,
         format('direct_core_places:%s:%s:%s',region_code,snapshot_version,
                to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),
         'manual','completed',now(),'Regional direct-Core places bulk import'
  FROM direct_places_params RETURNING id
), pb AS (
  INSERT INTO system.system_publish_batches (
    batch_name,status,note,source_snapshot_version,region_code,
    total_item_count,success_count,failed_count,skipped_count,summary,
    published_at,promoted_at
  )
  SELECT format('direct_core_places:%s:%s:%s',region_code,snapshot_version,
                to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),
         'promoted','Regional direct-Core places bulk import',snapshot_version,
         region_code,(SELECT count(*) FROM direct_places_plan),
         (SELECT count(*) FROM direct_places_changes),0,
         (SELECT count(*) FROM direct_places_plan)-(SELECT count(*) FROM direct_places_changes),
         jsonb_build_object('loader','direct_core.places','transaction_scope','region',
           'inserted',(SELECT count(*) FROM direct_places_changes WHERE action='insert'),
           'updated',(SELECT count(*) FROM direct_places_changes WHERE action='update')),
         now(),now()
  FROM direct_places_params RETURNING id
)
INSERT INTO direct_places_audit SELECT ib.id,pb.id FROM ib CROSS JOIN pb;

INSERT INTO system.system_publish_items (
  publish_batch_id,entity_family,entity_id,publish_action,publish_status,
  external_id,target_schema,target_table,target_id,before_data,after_data,
  validation_result,published_at,source_snapshot_version
)
SELECT a.publish_batch_id,'places',c.entity_id,c.action,'success',c.external_id,
       'core','core_places',c.entity_id,c.before_data,c.after_data,
       '{"validated":true,"source":"local_pipeline"}'::jsonb,now(),p.snapshot_version
FROM direct_places_changes c CROSS JOIN direct_places_audit a
CROSS JOIN direct_places_params p;

DO $$
DECLARE staged bigint; resolved bigint; changed bigint;
BEGIN
  SELECT count(*) INTO staged FROM direct_places_plan;
  SELECT count(*) INTO resolved
  FROM direct_places_plan p
  WHERE EXISTS (
    SELECT 1 FROM core.core_places c
    WHERE c.deleted_at IS NULL
      AND system.pipeline_osm_identity_key(c.external_id)=p.identity_key
  );
  SELECT count(*) INTO changed FROM direct_places_changes;
  IF resolved<>staged THEN
    RAISE EXCEPTION 'places verification: staged=% resolved=%',staged,resolved;
  END IF;
  IF changed>(SELECT count(*) FROM direct_places_plan) THEN
    RAISE EXCEPTION 'places verification: impossible mutation count=%',changed;
  END IF;
END $$;

SELECT 'direct_core_places' AS section,
       (SELECT count(*) FROM direct_places_plan) AS staged,
       count(*) FILTER (WHERE action='insert') AS inserted,
       count(*) FILTER (WHERE action='update') AS updated,
       (SELECT publish_batch_id FROM direct_places_audit) AS publish_batch_id,
       (SELECT dry_run FROM direct_places_params) AS dry_run
FROM direct_places_changes;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
