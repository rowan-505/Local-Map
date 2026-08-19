\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

CREATE TEMP TABLE direct_roads_params (
  source_registry_id bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  source_type_id bigint NOT NULL,
  dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO direct_roads_params
SELECT r.id,s.id,s.snapshot_version,:'region_code',t.id,:'dry_run'::boolean
FROM system.system_source_registry r
JOIN system.system_source_snapshots s
  ON s.source_registry_id=r.id AND s.snapshot_version=:'snapshot_version'
JOIN ref.ref_source_types t ON t.code='osm'
WHERE r.source_code='osm_myanmar' AND r.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM direct_roads_params) THEN
    RAISE EXCEPTION 'roads: active source/snapshot/osm source type not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:roads:'||(SELECT region_code FROM direct_roads_params),0));
END $$;

CREATE TEMP TABLE direct_roads_raw (
  classification text, local_staging_id text, external_id text,
  canonical_name text, name_my text, name_en text, road_class_id text,
  admin_area_id text, geom_ewkt text, is_oneway text, bridge text,
  tunnel text, layer text, surface text, source_refs text, normalized_data text
) ON COMMIT DROP;
\copy direct_roads_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_integer(v text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::integer; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_boolean(v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::boolean; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v),'')::jsonb,'{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v),'')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE direct_roads_stage AS
SELECT row_number() OVER ()::bigint row_no,
  lower(nullif(btrim(classification),'')) classification,
  pg_temp.direct_try_bigint(local_staging_id) local_staging_id,
  system.pipeline_osm_identity_key(external_id) identity_key,
  system.pipeline_osm_identity_key(external_id) external_id,
  nullif(btrim(canonical_name),'') canonical_name,
  nullif(btrim(name_my),'') name_my,
  nullif(btrim(name_en),'') name_en,
  pg_temp.direct_try_bigint(road_class_id) road_class_id,
  pg_temp.direct_try_bigint(admin_area_id) admin_area_id,
  pg_temp.direct_try_geometry(geom_ewkt) geom,
  pg_temp.direct_try_boolean(is_oneway) is_oneway,
  pg_temp.direct_try_boolean(bridge) bridge,
  pg_temp.direct_try_boolean(tunnel) tunnel,
  pg_temp.direct_try_integer(layer) layer,
  nullif(btrim(surface),'') surface,
  pg_temp.direct_try_jsonb(source_refs) source_refs,
  pg_temp.direct_try_jsonb(normalized_data) normalized_data,
  count(*) OVER (PARTITION BY system.pipeline_osm_identity_key(external_id)) identity_count
FROM direct_roads_raw;
CREATE INDEX ON direct_roads_stage(identity_key);

CREATE TEMP TABLE direct_roads_core AS
SELECT c.* FROM core.core_streets c
JOIN (SELECT DISTINCT identity_key FROM direct_roads_stage) s
  ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;
CREATE INDEX ON direct_roads_core(system.pipeline_osm_identity_key(external_id));

CREATE TEMP TABLE direct_roads_plan AS
SELECT s.*,c.id target_id,c.deleted_at target_deleted_at,
  count(c.id)OVER(PARTITION BY s.identity_key) target_count,
  array_remove(ARRAY[
    CASE WHEN s.classification NOT IN ('safe_new','safe_update') THEN 'unsupported classification' END,
    CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id<=0 THEN 'missing/invalid local_staging_id' END,
    CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
    CASE WHEN s.identity_count>1 THEN 'duplicate identity in file' END,
    CASE WHEN count(c.id)OVER(PARTITION BY s.identity_key)>1
      THEN 'identity resolves to multiple Core rows' END,
    CASE WHEN s.canonical_name IS NULL THEN 'canonical_name required' END,
    CASE WHEN s.road_class_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM ref.ref_road_classes x WHERE x.id=s.road_class_id
    ) THEN 'invalid road_class_id' END,
    CASE WHEN s.admin_area_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM core.core_admin_areas x
      WHERE x.id=s.admin_area_id AND x.deleted_at IS NULL
    ) THEN 'invalid admin_area_id' END,
    CASE WHEN s.geom IS NULL OR ST_SRID(s.geom)<>4326
      OR GeometryType(s.geom)<>'LINESTRING' OR ST_IsEmpty(s.geom)
      OR NOT ST_IsValid(s.geom) THEN 'invalid LineString geometry' END,
    CASE WHEN s.is_oneway IS NULL OR s.bridge IS NULL OR s.tunnel IS NULL
      OR s.layer IS NULL THEN 'invalid routing attributes' END,
    CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL THEN 'invalid JSON' END,
    CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL THEN 'identity belongs to soft-deleted Core row' END,
    CASE WHEN s.classification='safe_update' AND c.id IS NULL THEN 'safe_update target missing' END,
    CASE WHEN s.classification='safe_update' AND (
      c.is_verified OR lower(c.verification_status)='verified'
    ) THEN 'safe_update target is verified' END,
    CASE WHEN s.classification='safe_update' AND (
      c.manual_override OR coalesce((c.source_refs->>'manual_override') IN ('true','t','1'),false)
      OR c.source_refs @> '{"source":"dashboard"}'::jsonb
      OR c.source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'safe_update target is manual-protected' END,
    CASE WHEN s.classification='safe_new' AND c.id IS NOT NULL AND (
      c.canonical_name IS DISTINCT FROM s.canonical_name
      OR c.road_class_id IS DISTINCT FROM s.road_class_id
      OR c.admin_area_id IS DISTINCT FROM s.admin_area_id
      OR c.travel_direction IS DISTINCT FROM
        CASE WHEN s.is_oneway THEN 'forward'::text ELSE NULL::text END
      OR c.bridge IS DISTINCT FROM s.bridge
      OR c.tunnel IS DISTINCT FROM s.tunnel
      OR c.layer IS DISTINCT FROM s.layer
      OR c.surface IS DISTINCT FROM s.surface
      OR NOT ST_Equals(c.geom,s.geom)
    ) THEN 'safe_new identity already exists with different data' END
  ],NULL)::text[] errors
FROM direct_roads_stage s
LEFT JOIN direct_roads_core c
  ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;

DO $$
DECLARE n bigint; sample text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM direct_roads_plan) THEN RAISE EXCEPTION 'roads: CSV contains zero rows'; END IF;
  SELECT count(*),min(array_to_string(errors,'; ')) INTO n,sample
  FROM direct_roads_plan WHERE cardinality(errors)>0;
  IF n>0 THEN RAISE EXCEPTION 'roads: % rejected row(s): %',n,sample; END IF;
END $$;

CREATE TEMP TABLE direct_roads_changes (
  action text NOT NULL, entity_id bigint NOT NULL, external_id text NOT NULL,
  before_data jsonb, after_data jsonb
) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO core.core_streets (
    external_id,canonical_name,geom,admin_area_id,source_type_id,road_class_id,
    road_class,surface,travel_direction,bridge,tunnel,layer,source_tags,source_refs,
    normalized_data,is_active,manual_override,verification_status
  )
  SELECT s.external_id,s.canonical_name,s.geom::geometry(LineString,4326),
    s.admin_area_id,p.source_type_id,s.road_class_id,rc.code,s.surface,
    CASE WHEN s.is_oneway THEN 'forward'::text ELSE NULL::text END,
    s.bridge,s.tunnel,s.layer,
    coalesce(s.normalized_data->'tags','{}'::jsonb),
    s.source_refs||jsonb_build_object(
      'external_id',s.external_id,'source_snapshot_version',p.snapshot_version,
      'region_code',p.region_code,'loader','direct_core.roads'),
    s.normalized_data||jsonb_build_object(
      'local_staging_id',s.local_staging_id,'import_class',s.classification),
    true,false,'unverified'
  FROM direct_roads_plan s CROSS JOIN direct_roads_params p
  JOIN ref.ref_road_classes rc ON rc.id=s.road_class_id
  WHERE s.classification='safe_new' AND s.target_id IS NULL
  RETURNING id,external_id
)
INSERT INTO direct_roads_changes
SELECT 'insert',i.id,i.external_id,NULL,to_jsonb(c)
FROM ins i JOIN core.core_streets c ON c.id=i.id;

WITH upd AS (
  UPDATE core.core_streets c SET
    canonical_name=s.canonical_name,geom=s.geom::geometry(LineString,4326),
    admin_area_id=s.admin_area_id,road_class_id=s.road_class_id,
    road_class=rc.code,surface=s.surface,
    travel_direction=CASE WHEN s.is_oneway THEN 'forward'::text ELSE NULL::text END,
    bridge=s.bridge,tunnel=s.tunnel,layer=s.layer,
    source_tags=coalesce(s.normalized_data->'tags',c.source_tags),
    source_refs=c.source_refs||s.source_refs||jsonb_build_object(
      'external_id',s.external_id,'source_snapshot_version',p.snapshot_version,
      'region_code',p.region_code,'loader','direct_core.roads'),
    normalized_data=c.normalized_data||s.normalized_data||jsonb_build_object(
      'local_staging_id',s.local_staging_id,'import_class',s.classification),
    updated_at=now()
  FROM direct_roads_plan s CROSS JOIN direct_roads_params p
  JOIN ref.ref_road_classes rc ON rc.id=s.road_class_id
  WHERE c.id=s.target_id AND s.classification='safe_update'
    AND (c.canonical_name,c.geom,c.admin_area_id,c.road_class_id,c.road_class,
      c.surface,c.travel_direction,c.bridge,c.tunnel,c.layer,c.source_tags,
      c.source_refs,c.normalized_data) IS DISTINCT FROM
    (s.canonical_name,s.geom,s.admin_area_id,s.road_class_id,rc.code,
      s.surface,CASE WHEN s.is_oneway THEN 'forward'::text ELSE NULL::text END,
      s.bridge,s.tunnel,s.layer,
      coalesce(s.normalized_data->'tags',c.source_tags),
      c.source_refs||s.source_refs||jsonb_build_object(
        'external_id',s.external_id,'source_snapshot_version',p.snapshot_version,
        'region_code',p.region_code,'loader','direct_core.roads'),
      c.normalized_data||s.normalized_data||jsonb_build_object(
        'local_staging_id',s.local_staging_id,'import_class',s.classification))
  RETURNING c.id,c.external_id
)
INSERT INTO direct_roads_changes
SELECT 'update',u.id,u.external_id,to_jsonb(b),to_jsonb(a)
FROM upd u JOIN direct_roads_core b ON b.id=u.id
JOIN core.core_streets a ON a.id=u.id;

CREATE TEMP TABLE direct_roads_name_source AS
SELECT coalesce(c.entity_id,s.target_id) street_id,s.name_my,s.name_en,
       s.canonical_name name_und
FROM direct_roads_plan s
LEFT JOIN direct_roads_changes c ON c.external_id=s.external_id;

INSERT INTO core.core_street_names (
  street_id,name,language_code,script_code,name_type,is_primary
)
SELECT street_id,name,lang,script,'official',true
FROM direct_roads_name_source s
CROSS JOIN LATERAL (VALUES
  (s.name_my,'my','Mymr'),(s.name_en,'en','Latn'),(s.name_und,'und',NULL)
) n(name,lang,script)
WHERE nullif(btrim(name),'') IS NOT NULL
ON CONFLICT (street_id,language_code)
WHERE name_type='official' AND is_primary=true
DO UPDATE SET name=EXCLUDED.name,script_code=EXCLUDED.script_code
WHERE (core_street_names.name,core_street_names.script_code)
  IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.script_code);

CREATE TEMP TABLE direct_roads_audit(import_batch_id bigint,publish_batch_id bigint) ON COMMIT DROP;
WITH ib AS (
  INSERT INTO system.system_import_batches(
    source_registry_id,batch_name,trigger_type,status,finished_at,note)
  SELECT source_registry_id,format('direct_core_roads:%s:%s:%s',region_code,snapshot_version,
    to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'manual','completed',now(),
    'Regional direct-Core roads bulk import'
  FROM direct_roads_params RETURNING id
),pb AS (
  INSERT INTO system.system_publish_batches(
    batch_name,status,note,source_snapshot_version,region_code,total_item_count,
    success_count,failed_count,skipped_count,summary,published_at,promoted_at)
  SELECT format('direct_core_roads:%s:%s:%s',region_code,snapshot_version,
    to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'promoted',
    'Regional direct-Core roads bulk import',snapshot_version,region_code,
    (SELECT count(*) FROM direct_roads_plan),(SELECT count(*) FROM direct_roads_changes),0,
    (SELECT count(*) FROM direct_roads_plan)-(SELECT count(*) FROM direct_roads_changes),
    jsonb_build_object('loader','direct_core.roads','transaction_scope','region',
      'inserted',(SELECT count(*) FROM direct_roads_changes WHERE action='insert'),
      'updated',(SELECT count(*) FROM direct_roads_changes WHERE action='update')),
    now(),now() FROM direct_roads_params RETURNING id
)
INSERT INTO direct_roads_audit SELECT ib.id,pb.id FROM ib CROSS JOIN pb;

INSERT INTO system.system_publish_items(
  publish_batch_id,entity_family,entity_id,publish_action,publish_status,
  external_id,target_schema,target_table,target_id,before_data,after_data,
  validation_result,published_at,source_snapshot_version)
SELECT a.publish_batch_id,'roads',c.entity_id,c.action,'success',c.external_id,
  'core','core_streets',c.entity_id,c.before_data,c.after_data,
  '{"validated":true,"source":"local_pipeline"}'::jsonb,now(),p.snapshot_version
FROM direct_roads_changes c CROSS JOIN direct_roads_audit a CROSS JOIN direct_roads_params p;

DO $$
DECLARE staged bigint; resolved bigint;
BEGIN
  SELECT count(*) INTO staged FROM direct_roads_plan;
  SELECT count(*) INTO resolved FROM direct_roads_plan s
  WHERE EXISTS(SELECT 1 FROM core.core_streets c WHERE c.deleted_at IS NULL
    AND system.pipeline_osm_identity_key(c.external_id)=s.identity_key);
  IF resolved<>staged THEN RAISE EXCEPTION 'roads verification: staged=% resolved=%',staged,resolved; END IF;
END $$;

SELECT 'direct_core_roads' section,(SELECT count(*) FROM direct_roads_plan) staged,
  count(*) FILTER(WHERE action='insert') inserted,
  count(*) FILTER(WHERE action='update') updated,
  (SELECT publish_batch_id FROM direct_roads_audit) publish_batch_id,
  (SELECT dry_run FROM direct_roads_params) dry_run
FROM direct_roads_changes;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
