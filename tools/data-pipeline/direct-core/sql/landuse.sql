-- Direct-Core land areas loader.
-- Classification path (authoritative):
--   OSM tags → normalize to stable CoreMap class code → resolve ref.ref_land_area_classes.id
--   → write land_area_class_id. Legacy class_code is written only as a mirror of ref.code.
-- Do not treat arbitrary OSM tag values as the Core classification source.
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30min';

CREATE TEMP TABLE direct_landuse_params(
 source_registry_id bigint NOT NULL,source_snapshot_id bigint NOT NULL,
 snapshot_version text NOT NULL,region_code text NOT NULL,dry_run boolean NOT NULL
)ON COMMIT DROP;
INSERT INTO direct_landuse_params
SELECT r.id,s.id,s.snapshot_version,:'region_code',:'dry_run'::boolean
FROM system.system_source_registry r JOIN system.system_source_snapshots s
 ON s.source_registry_id=r.id AND s.snapshot_version=:'snapshot_version'
WHERE r.source_code='osm_myanmar' AND r.is_active;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM direct_landuse_params)THEN RAISE EXCEPTION 'landuse: active source/snapshot not found';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'direct_core:landuse:'||(SELECT region_code FROM direct_landuse_params),0));
END $$;

CREATE TEMP TABLE direct_landuse_raw(
 classification text,local_staging_id text,external_id text,name_und text,
 name_my text,name_en text,land_area_class_id text,class_code text,
 admin_area_id text,geom_ewkt text,confidence_score text,detail_level text,
 source_tags text,source_refs text,normalized_data text
)ON COMMIT DROP;
\copy direct_landuse_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH(FORMAT csv,HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text)RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::bigint;EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_numeric(v text)RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::numeric;EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text)RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v),'')::jsonb,'{}'::jsonb);EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text)RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v),''));EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;

CREATE TEMP TABLE direct_landuse_stage AS
SELECT row_number()OVER()::bigint row_no,lower(nullif(btrim(classification),''))classification,
 pg_temp.direct_try_bigint(local_staging_id)local_staging_id,
 system.pipeline_osm_identity_key(external_id)identity_key,
 system.pipeline_osm_identity_key(external_id)external_id,
 nullif(btrim(name_und),'')name_und,nullif(btrim(name_my),'')name_my,
 nullif(btrim(name_en),'')name_en,pg_temp.direct_try_bigint(land_area_class_id)land_area_class_id,
 lower(nullif(btrim(class_code),''))class_code,
 pg_temp.direct_try_bigint(admin_area_id)admin_area_id,
 pg_temp.direct_try_geometry(geom_ewkt)geom,
 pg_temp.direct_try_numeric(confidence_score)confidence_score,
 coalesce(nullif(btrim(detail_level),''),'zone')detail_level,
 pg_temp.direct_try_jsonb(source_tags)source_tags,
 pg_temp.direct_try_jsonb(source_refs)source_refs,
 pg_temp.direct_try_jsonb(normalized_data)normalized_data,
 count(*)OVER(PARTITION BY system.pipeline_osm_identity_key(external_id))identity_count
FROM direct_landuse_raw;
CREATE INDEX ON direct_landuse_stage(identity_key);

-- Resolve class FK by CODE on the target DB (never trust local numeric IDs).
UPDATE direct_landuse_stage s
SET land_area_class_id = r.id,
    class_code = lower(btrim(r.code))
FROM ref.ref_land_area_classes r
WHERE lower(btrim(r.code)) = s.class_code;

-- Drop admin_area_id values that are not present on this target DB.
UPDATE direct_landuse_stage s
SET admin_area_id = NULL
WHERE s.admin_area_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_admin_areas a
    WHERE a.id = s.admin_area_id AND a.deleted_at IS NULL
  );
CREATE TEMP TABLE direct_landuse_core AS
SELECT c.* FROM core.core_land_areas c JOIN(SELECT DISTINCT identity_key FROM direct_landuse_stage)s
 ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;
CREATE INDEX ON direct_landuse_core(system.pipeline_osm_identity_key(external_id));

CREATE TEMP TABLE direct_landuse_plan AS
SELECT s.*,c.id target_id,c.deleted_at target_deleted_at,
 count(c.id)OVER(PARTITION BY s.identity_key)target_count,
 coalesce(s.name_my,s.name_en,s.name_und)resolved_name,
 ST_PointOnSurface(s.geom)::geometry(Point,4326)centroid,
 ST_Area(s.geom::geography)::numeric area_m2,
 array_remove(ARRAY[
  CASE WHEN s.classification NOT IN('safe_new','safe_update')THEN 'unsupported classification'END,
  CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id<=0 THEN 'missing/invalid local_staging_id'END,
  CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity'END,
  CASE WHEN s.identity_count>1 THEN 'duplicate identity in file'END,
  CASE WHEN count(c.id)OVER(PARTITION BY s.identity_key)>1
   THEN 'identity resolves to multiple Core rows'END,
  CASE WHEN s.class_code IS NULL THEN 'class_code required'END,
  CASE WHEN s.land_area_class_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM ref.ref_land_area_classes x WHERE x.id=s.land_area_class_id
  )THEN 'invalid land_area_class_id'END,
  CASE WHEN s.admin_area_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM core.core_admin_areas x WHERE x.id=s.admin_area_id AND x.deleted_at IS NULL
  )THEN 'invalid admin_area_id'END,
  CASE WHEN s.geom IS NULL OR ST_SRID(s.geom)<>4326 OR GeometryType(s.geom)<>'MULTIPOLYGON'
   OR ST_IsEmpty(s.geom)OR NOT ST_IsValid(s.geom)THEN 'invalid MultiPolygon geometry'END,
  CASE WHEN s.confidence_score IS NULL OR s.confidence_score NOT BETWEEN 0 AND 100
   THEN 'confidence_score outside 0..100'END,
  CASE WHEN s.detail_level NOT IN('parcel','zone')
   THEN 'unsupported detail_level'END,
  CASE WHEN s.source_tags IS NULL OR s.source_refs IS NULL OR s.normalized_data IS NULL
   THEN 'invalid JSON'END,
  CASE WHEN c.id IS NOT NULL AND c.deleted_at IS NOT NULL THEN 'identity belongs to soft-deleted Core row'END,
  CASE WHEN s.classification='safe_update'AND c.id IS NULL THEN 'safe_update target missing'END,
  CASE WHEN s.classification='safe_update'AND(c.is_verified OR lower(c.verification_status)='verified')
   THEN 'safe_update target is verified'END,
  CASE WHEN s.classification='safe_update'AND(c.manual_override
   OR coalesce((c.source_refs->>'manual_override')IN('true','t','1'),false)
   OR c.source_refs@>'{"source":"dashboard"}'::jsonb OR c.source_refs@>'{"source":"manual"}'::jsonb)
   THEN 'safe_update target is manual-protected'END,
  CASE WHEN s.classification='safe_new'AND c.id IS NOT NULL AND(
   (coalesce(s.name_my,s.name_en,s.name_und) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM core.core_land_area_names n
      WHERE n.land_area_id=c.id AND n.name=coalesce(s.name_my,s.name_en,s.name_und)))
   OR c.land_area_class_id IS DISTINCT FROM s.land_area_class_id
   OR c.admin_area_id IS DISTINCT FROM s.admin_area_id
   OR c.confidence_score IS DISTINCT FROM s.confidence_score
   OR c.detail_level IS DISTINCT FROM s.detail_level OR NOT ST_Equals(c.geom,s.geom))
   THEN 'safe_new identity already exists with different data'END
 ],NULL)::text[]errors
FROM direct_landuse_stage s LEFT JOIN direct_landuse_core c
 ON system.pipeline_osm_identity_key(c.external_id)=s.identity_key;
DO $$
DECLARE n bigint;sample text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM direct_landuse_plan)THEN RAISE EXCEPTION 'landuse: CSV contains zero rows';END IF;
 SELECT count(*),min(array_to_string(errors,'; '))INTO n,sample FROM direct_landuse_plan WHERE cardinality(errors)>0;
 IF n>0 THEN RAISE EXCEPTION 'landuse: % rejected row(s): %',n,sample;END IF;
END $$;

CREATE TEMP TABLE direct_landuse_changes(
 action text NOT NULL,entity_id bigint NOT NULL,external_id text NOT NULL,before_data jsonb,after_data jsonb
)ON COMMIT DROP;
DO $$
DECLARE v_new bigint;
BEGIN
 SELECT count(*) INTO v_new FROM direct_landuse_plan
 WHERE classification='safe_new' AND target_id IS NULL;
 RAISE NOTICE 'landuse: safe_new insert candidates=%', v_new;
 IF v_new = 0 THEN
   RAISE EXCEPTION 'landuse: zero safe_new insert candidates after planning';
 END IF;
END $$;
WITH ins AS(
 INSERT INTO core.core_land_areas(external_id,land_area_class_id,admin_area_id,
  geom,centroid,area_m2,confidence_score,detail_level,source_tags,source_refs,
  normalized_data,is_active,manual_override,verification_status,
  source_registry_id,source_snapshot_id,region_code)
 SELECT s.external_id,s.land_area_class_id,s.admin_area_id,
  s.geom::geometry(MultiPolygon,4326),s.centroid,s.area_m2,s.confidence_score,
  s.detail_level,s.source_tags,s.source_refs||jsonb_build_object('external_id',s.external_id,
   'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.landuse'),
  s.normalized_data||jsonb_build_object('local_staging_id',s.local_staging_id,
   'import_class',s.classification),true,false,'unverified',
  p.source_registry_id,p.source_snapshot_id,p.region_code
 FROM direct_landuse_plan s CROSS JOIN direct_landuse_params p
 WHERE s.classification='safe_new'AND s.target_id IS NULL RETURNING id,external_id
)
INSERT INTO direct_landuse_changes(action,entity_id,external_id,before_data,after_data)
SELECT 'insert',i.id,i.external_id,NULL,NULL FROM ins i;
WITH upd AS(
 UPDATE core.core_land_areas c SET land_area_class_id=s.land_area_class_id,admin_area_id=s.admin_area_id,
  geom=s.geom::geometry(MultiPolygon,4326),centroid=s.centroid,area_m2=s.area_m2,
  confidence_score=s.confidence_score,detail_level=s.detail_level,source_tags=s.source_tags,
  source_refs=c.source_refs||s.source_refs||jsonb_build_object('external_id',s.external_id,
   'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.landuse'),
  normalized_data=c.normalized_data||s.normalized_data||jsonb_build_object(
   'local_staging_id',s.local_staging_id,'import_class',s.classification),updated_at=now()
 FROM direct_landuse_plan s CROSS JOIN direct_landuse_params p
 WHERE c.id=s.target_id AND s.classification='safe_update'
  AND(c.land_area_class_id,c.admin_area_id,c.geom,c.centroid,c.area_m2,
   c.confidence_score,c.detail_level,c.source_tags,c.source_refs,c.normalized_data)
  IS DISTINCT FROM(s.land_area_class_id,s.admin_area_id,s.geom,
   s.centroid,s.area_m2,s.confidence_score,s.detail_level,s.source_tags,
   c.source_refs||s.source_refs||jsonb_build_object('external_id',s.external_id,
    'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,'loader','direct_core.landuse'),
   c.normalized_data||s.normalized_data||jsonb_build_object(
    'local_staging_id',s.local_staging_id,'import_class',s.classification))
 RETURNING c.id,c.external_id
)
INSERT INTO direct_landuse_changes SELECT 'update',u.id,u.external_id,to_jsonb(b),to_jsonb(a)
FROM upd u JOIN direct_landuse_core b ON b.id=u.id JOIN core.core_land_areas a ON a.id=u.id;

CREATE TEMP TABLE direct_landuse_name_source AS
SELECT coalesce(c.entity_id,s.target_id)land_area_id,s.name_my,s.name_en,s.name_und
FROM direct_landuse_plan s LEFT JOIN direct_landuse_changes c ON c.external_id=s.external_id
WHERE coalesce(c.entity_id,s.target_id) IS NOT NULL;
INSERT INTO core.core_land_area_names(
 land_area_id,name,language_code,script_code,name_type,is_primary,search_weight)
SELECT land_area_id,name,lang,script,'official',true,100
FROM direct_landuse_name_source s CROSS JOIN LATERAL(VALUES
 (s.name_my,'my','Mymr'),(s.name_en,'en','Latn'),(s.name_und,'und',NULL)
)n(name,lang,script)WHERE nullif(btrim(name),'')IS NOT NULL
ON CONFLICT(land_area_id,language_code,name_type)WHERE is_primary IS TRUE
DO UPDATE SET name=EXCLUDED.name,script_code=EXCLUDED.script_code,
 search_weight=100,updated_at=now()
WHERE (core_land_area_names.name,core_land_area_names.script_code,
       core_land_area_names.search_weight)
 IS DISTINCT FROM(EXCLUDED.name,EXCLUDED.script_code,100);

CREATE TEMP TABLE direct_landuse_audit(import_batch_id bigint,publish_batch_id bigint)ON COMMIT DROP;
WITH ib AS(
 INSERT INTO system.system_import_batches(source_registry_id,batch_name,trigger_type,status,finished_at,note)
 SELECT source_registry_id,format('direct_core_landuse:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'manual','completed',now(),
  'Regional direct-Core landuse bulk import'FROM direct_landuse_params RETURNING id
),pb AS(
 INSERT INTO system.system_publish_batches(batch_name,status,note,source_snapshot_version,region_code,
  total_item_count,success_count,failed_count,skipped_count,summary,published_at,promoted_at)
 SELECT format('direct_core_landuse:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'promoted','Regional direct-Core landuse bulk import',
  snapshot_version,region_code,(SELECT count(*)FROM direct_landuse_plan),
  (SELECT count(*)FROM direct_landuse_changes),0,
  (SELECT count(*)FROM direct_landuse_plan)-(SELECT count(*)FROM direct_landuse_changes),
  jsonb_build_object('loader','direct_core.landuse','transaction_scope','region',
   'inserted',(SELECT count(*)FROM direct_landuse_changes WHERE action='insert'),
   'updated',(SELECT count(*)FROM direct_landuse_changes WHERE action='update')),now(),now()
 FROM direct_landuse_params RETURNING id
)INSERT INTO direct_landuse_audit SELECT ib.id,pb.id FROM ib CROSS JOIN pb;
INSERT INTO system.system_publish_items(publish_batch_id,entity_family,entity_id,publish_action,
 publish_status,external_id,target_schema,target_table,target_id,before_data,after_data,
 validation_result,published_at,source_snapshot_version)
SELECT a.publish_batch_id,'landuse',c.entity_id,c.action,'success',c.external_id,'core',
 'core_land_areas',c.entity_id,c.before_data,c.after_data,
 '{"validated":true,"source":"local_pipeline"}'::jsonb,now(),p.snapshot_version
FROM direct_landuse_changes c CROSS JOIN direct_landuse_audit a CROSS JOIN direct_landuse_params p;
DO $$
DECLARE staged bigint;resolved bigint;
BEGIN
 SELECT count(*)INTO staged FROM direct_landuse_plan;
 SELECT count(*)INTO resolved FROM direct_landuse_plan s WHERE EXISTS(
  SELECT 1 FROM core.core_land_areas c WHERE c.deleted_at IS NULL
   AND system.pipeline_osm_identity_key(c.external_id)=s.identity_key);
 IF staged<>resolved THEN RAISE EXCEPTION 'landuse verification: staged=% resolved=%',staged,resolved;END IF;
END $$;
SELECT 'direct_core_landuse'section,(SELECT count(*)FROM direct_landuse_plan)staged,
 count(*)FILTER(WHERE action='insert')inserted,count(*)FILTER(WHERE action='update')updated,
 (SELECT publish_batch_id FROM direct_landuse_audit)publish_batch_id,
 (SELECT dry_run FROM direct_landuse_params)dry_run FROM direct_landuse_changes;
\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
