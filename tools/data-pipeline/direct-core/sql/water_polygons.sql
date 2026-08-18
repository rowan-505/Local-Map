\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30min';

CREATE TEMP TABLE direct_water_polygons_params(
 source_registry_id bigint NOT NULL,source_snapshot_id bigint NOT NULL,
 snapshot_version text NOT NULL,region_code text NOT NULL,dry_run boolean NOT NULL
)ON COMMIT DROP;
INSERT INTO direct_water_polygons_params
SELECT r.id,s.id,s.snapshot_version,:'region_code',:'dry_run'::boolean
FROM system.system_source_registry r JOIN system.system_source_snapshots s
 ON s.source_registry_id=r.id AND s.snapshot_version=:'snapshot_version'
WHERE r.source_code='osm_myanmar'AND r.is_active;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM direct_water_polygons_params)THEN RAISE EXCEPTION 'water_polygons: active source/snapshot not found';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'direct_core:water_polygons:'||(SELECT region_code FROM direct_water_polygons_params),0));
END $$;
CREATE TEMP TABLE direct_water_polygons_raw(
 classification text,local_staging_id text,external_id text,name_und text,
 name_my text,name_en text,class_code text,geom_ewkt text,source_refs text,normalized_data text
)ON COMMIT DROP;
\copy direct_water_polygons_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH(FORMAT csv,HEADER true)
CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text)RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::bigint;EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text)RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v),'')::jsonb,'{}'::jsonb);EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text)RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v),''));EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE TEMP TABLE direct_water_polygons_stage AS
SELECT row_number()OVER()::bigint row_no,lower(nullif(btrim(classification),''))classification,
 pg_temp.direct_try_bigint(local_staging_id)local_staging_id,
 system.pipeline_osm_identity_key(external_id)identity_key,
 system.pipeline_osm_identity_key(external_id)external_id,
 nullif(btrim(name_und),'')name_und,nullif(btrim(name_my),'')name_my,
 nullif(btrim(name_en),'')name_en,lower(nullif(btrim(class_code),''))class_code,
 (SELECT wc.id FROM ref.ref_water_classes wc
   WHERE wc.is_active IS TRUE AND wc.code=lower(nullif(btrim(class_code),''))
   ORDER BY wc.sort_order ASC NULLS LAST, wc.id ASC LIMIT 1)water_class_id,
 pg_temp.direct_try_geometry(geom_ewkt)geom,pg_temp.direct_try_jsonb(source_refs)source_refs,
 pg_temp.direct_try_jsonb(normalized_data)normalized_data,
 count(*)OVER(PARTITION BY system.pipeline_osm_identity_key(external_id))identity_count
FROM direct_water_polygons_raw;
CREATE INDEX ON direct_water_polygons_stage(identity_key);
CREATE TEMP TABLE direct_water_polygons_core AS
SELECT c.* FROM core.core_water_polygons c JOIN(SELECT DISTINCT identity_key FROM direct_water_polygons_stage)s
 ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;
CREATE INDEX ON direct_water_polygons_core(system.pipeline_osm_identity_key(external_id));
CREATE TEMP TABLE direct_water_polygons_plan AS
SELECT s.*,c.id target_id,c.deleted_at target_deleted_at,
 count(c.id)OVER(PARTITION BY s.identity_key)target_count,
 coalesce(s.name_my,s.name_en,s.name_und)resolved_name,
 array_remove(ARRAY[
  CASE WHEN s.classification NOT IN('safe_new','safe_update')THEN 'unsupported classification'END,
  CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id<=0 THEN 'missing/invalid local_staging_id'END,
  CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity'END,
  CASE WHEN s.identity_count>1 THEN 'duplicate identity in file'END,
  CASE WHEN count(c.id)OVER(PARTITION BY s.identity_key)>1
   THEN 'identity resolves to multiple Core rows'END,
  CASE WHEN s.class_code IS NULL THEN 'class_code required'END,
  CASE WHEN s.water_class_id IS NULL THEN 'water_class_id could not be resolved from class_code'END,
  CASE WHEN s.geom IS NULL OR ST_SRID(s.geom)<>4326 OR GeometryType(s.geom)<>'MULTIPOLYGON'
   OR ST_IsEmpty(s.geom)OR NOT ST_IsValid(s.geom)THEN 'invalid MultiPolygon geometry'END,
  CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL THEN 'invalid JSON'END,
  CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL THEN 'identity belongs to soft-deleted Core row'END,
  CASE WHEN s.classification='safe_update'AND c.id IS NULL THEN 'safe_update target missing'END,
  CASE WHEN s.classification='safe_update'AND(c.is_verified OR lower(c.verification_status)='verified')
   THEN 'safe_update target is verified'END,
  CASE WHEN s.classification='safe_update'AND(
   coalesce((c.source_refs->>'manual_override')IN('true','t','1'),false)
   OR c.source_refs@>'{"source":"dashboard"}'::jsonb OR c.source_refs@>'{"source":"manual"}'::jsonb)
   THEN 'safe_update target is manual-protected'END,
  CASE WHEN s.classification='safe_new'AND c.id IS NOT NULL AND(
   c.name IS DISTINCT FROM coalesce(s.name_my,s.name_en,s.name_und)
   OR c.water_class_id IS DISTINCT FROM s.water_class_id OR NOT ST_Equals(c.geom,s.geom))
   THEN 'safe_new identity already exists with different data'END
 ],NULL)::text[]errors
FROM direct_water_polygons_stage s LEFT JOIN direct_water_polygons_core c
 ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;
DO $$
DECLARE n bigint;sample text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM direct_water_polygons_plan)THEN RAISE EXCEPTION 'water_polygons: CSV contains zero rows';END IF;
 SELECT count(*),min(array_to_string(errors,'; '))INTO n,sample FROM direct_water_polygons_plan WHERE cardinality(errors)>0;
 IF n>0 THEN RAISE EXCEPTION 'water_polygons: % rejected row(s): %',n,sample;END IF;
END $$;
CREATE TEMP TABLE direct_water_polygons_changes(
 action text NOT NULL,entity_id bigint NOT NULL,external_id text NOT NULL,before_data jsonb,after_data jsonb
)ON COMMIT DROP;
WITH ins AS(
 INSERT INTO core.core_water_polygons(external_id,name,water_class_id,geom,source_refs,normalized_data,source_registry_id,source_snapshot_id,source_feature_type,source_feature_id,region_code,
  is_active,is_verified,verification_status)
 SELECT s.external_id,s.resolved_name,s.water_class_id,s.geom::geometry(MultiPolygon,4326),
  p.source_registry_id,p.source_snapshot_id,'osm',s.external_id,p.region_code,
  s.source_refs||jsonb_build_object('external_id',s.external_id,
   'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.water_polygons'),
  s.normalized_data||jsonb_build_object('local_staging_id',s.local_staging_id,
   'import_class',s.classification),true,false,'unverified'
 FROM direct_water_polygons_plan s CROSS JOIN direct_water_polygons_params p
 WHERE s.classification='safe_new'AND s.target_id IS NULL RETURNING id,external_id
)INSERT INTO direct_water_polygons_changes SELECT 'insert',i.id,i.external_id,NULL,to_jsonb(c)
FROM ins i JOIN core.core_water_polygons c ON c.id=i.id;
WITH upd AS(
 UPDATE core.core_water_polygons c SET name=s.resolved_name,
  water_class_id=s.water_class_id,
  geom=s.geom::geometry(MultiPolygon,4326),
  source_registry_id=coalesce(c.source_registry_id,p.source_registry_id),
  source_snapshot_id=coalesce(c.source_snapshot_id,p.source_snapshot_id),
  source_feature_type=coalesce(c.source_feature_type,'osm'),
  source_feature_id=coalesce(c.source_feature_id,s.external_id),
  region_code=coalesce(c.region_code,p.region_code),
  source_refs=c.source_refs||s.source_refs||jsonb_build_object('external_id',s.external_id,
   'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.water_polygons'),
  normalized_data=c.normalized_data||s.normalized_data||jsonb_build_object(
   'local_staging_id',s.local_staging_id,'import_class',s.classification),updated_at=now()
 FROM direct_water_polygons_plan s CROSS JOIN direct_water_polygons_params p
 WHERE c.id=s.target_id AND s.classification='safe_update'
  AND(c.name,c.water_class_id,c.geom,c.source_refs,c.normalized_data)IS DISTINCT FROM(
   s.resolved_name,s.water_class_id,s.geom,
   c.source_refs||s.source_refs||jsonb_build_object('external_id',s.external_id,
    'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.water_polygons'),
   c.normalized_data||s.normalized_data||jsonb_build_object(
    'local_staging_id',s.local_staging_id,'import_class',s.classification))
 RETURNING c.id,c.external_id
)INSERT INTO direct_water_polygons_changes SELECT 'update',u.id,u.external_id,to_jsonb(b),to_jsonb(a)
FROM upd u JOIN direct_water_polygons_core b ON b.id=u.id JOIN core.core_water_polygons a ON a.id=u.id;
CREATE TEMP TABLE direct_water_polygons_name_source AS
SELECT coalesce(c.entity_id,s.target_id)water_polygon_id,s.name_my,s.name_en,s.name_und
FROM direct_water_polygons_plan s LEFT JOIN direct_water_polygons_changes c ON c.external_id=s.external_id;
INSERT INTO core.core_water_polygon_names(
 water_polygon_id,name,language_code,script_code,name_type,is_primary,search_weight)
SELECT water_polygon_id,name,lang,script,'official',true,100
FROM direct_water_polygons_name_source s CROSS JOIN LATERAL(VALUES
 (s.name_my,'my','Mymr'),(s.name_en,'en','Latn'),(s.name_und,'und',NULL)
)n(name,lang,script)WHERE nullif(btrim(name),'')IS NOT NULL
ON CONFLICT(water_polygon_id,language_code,name_type)WHERE is_primary=true
DO UPDATE SET name=EXCLUDED.name,script_code=EXCLUDED.script_code,
 search_weight=100,updated_at=now()
WHERE (core_water_polygon_names.name,core_water_polygon_names.script_code,
       core_water_polygon_names.search_weight)
 IS DISTINCT FROM(EXCLUDED.name,EXCLUDED.script_code,100);
CREATE TEMP TABLE direct_water_polygons_audit(import_batch_id bigint,publish_batch_id bigint)ON COMMIT DROP;
WITH ib AS(
 INSERT INTO system.system_import_batches(source_registry_id,batch_name,trigger_type,status,finished_at,note)
 SELECT source_registry_id,format('direct_core_water_polygons:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'manual','completed',now(),
  'Regional direct-Core water-polygons bulk import'FROM direct_water_polygons_params RETURNING id
),pb AS(
 INSERT INTO system.system_publish_batches(batch_name,status,note,source_snapshot_version,region_code,
  total_item_count,success_count,failed_count,skipped_count,summary,published_at,promoted_at)
 SELECT format('direct_core_water_polygons:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'promoted','Regional direct-Core water-polygons bulk import',
  snapshot_version,region_code,(SELECT count(*)FROM direct_water_polygons_plan),
  (SELECT count(*)FROM direct_water_polygons_changes),0,
  (SELECT count(*)FROM direct_water_polygons_plan)-(SELECT count(*)FROM direct_water_polygons_changes),
  jsonb_build_object('loader','direct_core.water_polygons','transaction_scope','region',
   'inserted',(SELECT count(*)FROM direct_water_polygons_changes WHERE action='insert'),
   'updated',(SELECT count(*)FROM direct_water_polygons_changes WHERE action='update')),now(),now()
 FROM direct_water_polygons_params RETURNING id
)INSERT INTO direct_water_polygons_audit SELECT ib.id,pb.id FROM ib CROSS JOIN pb;
INSERT INTO system.system_publish_items(publish_batch_id,entity_family,entity_id,publish_action,publish_status,
 external_id,target_schema,target_table,target_id,before_data,after_data,validation_result,published_at,
 source_snapshot_version)
SELECT a.publish_batch_id,'water_polygons',c.entity_id,c.action,'success',c.external_id,'core',
 'core_water_polygons',c.entity_id,c.before_data,c.after_data,
 '{"validated":true,"source":"local_pipeline"}'::jsonb,now(),p.snapshot_version
FROM direct_water_polygons_changes c CROSS JOIN direct_water_polygons_audit a CROSS JOIN direct_water_polygons_params p;
DO $$
DECLARE staged bigint;resolved bigint;
BEGIN
 SELECT count(*)INTO staged FROM direct_water_polygons_plan;
 SELECT count(*)INTO resolved FROM direct_water_polygons_plan s WHERE EXISTS(
  SELECT 1 FROM core.core_water_polygons c WHERE c.deleted_at IS NULL
   AND system.pipeline_osm_identity_key(c.external_id)=s.identity_key);
 IF staged<>resolved THEN RAISE EXCEPTION 'water_polygons verification: staged=% resolved=%',staged,resolved;END IF;
END $$;
SELECT 'direct_core_water_polygons'section,(SELECT count(*)FROM direct_water_polygons_plan)staged,
 count(*)FILTER(WHERE action='insert')inserted,count(*)FILTER(WHERE action='update')updated,
 (SELECT publish_batch_id FROM direct_water_polygons_audit)publish_batch_id,
 (SELECT dry_run FROM direct_water_polygons_params)dry_run FROM direct_water_polygons_changes;
\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
