\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30min';
SET LOCAL work_mem='256MB';
SET LOCAL maintenance_work_mem='512MB';

CREATE TEMP TABLE direct_buildings_params(
  source_registry_id bigint NOT NULL,source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,region_code text NOT NULL,dry_run boolean NOT NULL
) ON COMMIT DROP;
INSERT INTO direct_buildings_params
SELECT r.id,s.id,s.snapshot_version,:'region_code',:'dry_run'::boolean
FROM system.system_source_registry r JOIN system.system_source_snapshots s
  ON s.source_registry_id=r.id AND s.snapshot_version=:'snapshot_version'
WHERE r.source_code='osm_myanmar' AND r.is_active;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM direct_buildings_params) THEN
    RAISE EXCEPTION 'buildings: active source/snapshot not found';
  END IF;
  IF to_regclass('core.core_map_buildings') IS NULL THEN
    RAISE EXCEPTION 'buildings: core.core_map_buildings missing';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_map_buildings'
      AND column_name='source_feature_id'
  ) THEN
    RAISE EXCEPTION 'buildings: migration 149 columns missing (source_feature_id)';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_map_buildings'
      AND column_name='is_geometry_manually_edited'
  ) THEN
    RAISE EXCEPTION 'buildings: migration 149 columns missing (is_geometry_manually_edited)';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'direct_core:buildings:'||(SELECT region_code FROM direct_buildings_params),0));
END $$;

CREATE TEMP TABLE direct_buildings_raw(
  classification text,local_staging_id text,external_id text,name_und text,
  name_my text,name_en text,building_type_id text,admin_area_id text,
  geom_ewkt text,levels text,height_m text,confidence_score text,
  source_refs text,normalized_data text
) ON COMMIT DROP;
\copy direct_buildings_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE OR REPLACE FUNCTION pg_temp.direct_try_bigint(v text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::bigint; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_integer(v text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::integer; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_numeric(v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN nullif(btrim(v),'')::numeric; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_jsonb(v text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN coalesce(nullif(btrim(v),'')::jsonb,'{}'::jsonb); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION pg_temp.direct_try_geometry(v text) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN ST_GeomFromEWKT(nullif(btrim(v),'')); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

CREATE TEMP TABLE direct_buildings_stage AS
SELECT row_number() OVER()::bigint row_no,
  lower(nullif(btrim(classification),'')) classification,
  pg_temp.direct_try_bigint(local_staging_id) local_staging_id,
  system.pipeline_osm_identity_key(external_id) identity_key,
  system.pipeline_osm_identity_key(external_id) external_id,
  split_part(system.pipeline_osm_identity_key(external_id),':',2) source_feature_type,
  pg_temp.direct_try_bigint(
    split_part(system.pipeline_osm_identity_key(external_id),':',3)
  ) source_feature_id,
  nullif(btrim(name_und),'') name_und,nullif(btrim(name_my),'') name_my,
  nullif(btrim(name_en),'') name_en,
  pg_temp.direct_try_bigint(building_type_id) building_type_id,
  pg_temp.direct_try_bigint(admin_area_id) admin_area_id,
  pg_temp.direct_try_geometry(geom_ewkt) geom,
  pg_temp.direct_try_integer(levels) levels,
  pg_temp.direct_try_numeric(height_m) height_m,
  pg_temp.direct_try_numeric(confidence_score) confidence_score,
  pg_temp.direct_try_jsonb(source_refs) source_refs,
  pg_temp.direct_try_jsonb(normalized_data) normalized_data,
  count(*) OVER(PARTITION BY system.pipeline_osm_identity_key(external_id)) identity_count
FROM direct_buildings_raw;
CREATE INDEX ON direct_buildings_stage(identity_key);
CREATE INDEX ON direct_buildings_stage(source_feature_type, source_feature_id);
CREATE INDEX ON direct_buildings_stage(building_type_id);
CREATE INDEX ON direct_buildings_stage(admin_area_id);

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM direct_buildings_stage
  WHERE classification IN ('duplicate','pmtiles_only')
     OR classification NOT IN ('safe_new','safe_update');
  IF n > 0 THEN
    RAISE EXCEPTION 'buildings: CSV includes % out-of-scope classification row(s)', n;
  END IF;
END $$;

-- Precompute Core identity keys once (avoid O(n*m) OR joins).
CREATE TEMP TABLE direct_buildings_core_keys AS
SELECT
  c.id,
  c.deleted_at,
  c.is_verified,
  c.verification_status,
  c.is_geometry_manually_edited,
  c.is_attributes_manually_edited,
  c.source_refs,
  c.building_type_id,
  c.admin_area_id,
  c.geom,
  c.centroid,
  c.area_m2,
  c.levels,
  c.height_m,
  c.confidence_score,
  c.normalized_data,
  c.source_registry_id,
  c.source_feature_type,
  c.source_feature_id,
  system.pipeline_osm_identity_key(c.external_id) AS identity_key
FROM core.core_map_buildings c;
CREATE INDEX ON direct_buildings_core_keys(identity_key);
CREATE INDEX ON direct_buildings_core_keys(source_registry_id, source_feature_type, source_feature_id);
CREATE INDEX ON direct_buildings_core_keys(id);

CREATE TEMP TABLE direct_buildings_match_raw AS
SELECT s.row_no, c.id AS target_id, c.deleted_at AS target_deleted_at,
  c.is_verified, c.verification_status, c.is_geometry_manually_edited,
  c.is_attributes_manually_edited, c.source_refs AS target_source_refs,
  c.building_type_id AS target_building_type_id,
  c.admin_area_id AS target_admin_area_id,
  c.geom AS target_geom, c.centroid AS target_centroid, c.area_m2 AS target_area_m2,
  c.levels AS target_levels, c.height_m AS target_height_m,
  c.confidence_score AS target_confidence_score
FROM direct_buildings_stage s
CROSS JOIN direct_buildings_params p
JOIN direct_buildings_core_keys c
  ON c.source_registry_id = p.source_registry_id
 AND c.source_feature_type = s.source_feature_type
 AND c.source_feature_id = s.source_feature_id
UNION
SELECT s.row_no, c.id, c.deleted_at,
  c.is_verified, c.verification_status, c.is_geometry_manually_edited,
  c.is_attributes_manually_edited, c.source_refs,
  c.building_type_id, c.admin_area_id, c.geom, c.centroid, c.area_m2,
  c.levels, c.height_m, c.confidence_score
FROM direct_buildings_stage s
JOIN direct_buildings_core_keys c
  ON c.identity_key = s.identity_key
WHERE s.identity_key IS NOT NULL;

CREATE TEMP TABLE direct_buildings_matches AS
SELECT DISTINCT ON (row_no)
  row_no, target_id, target_deleted_at, is_verified, verification_status,
  is_geometry_manually_edited, is_attributes_manually_edited, target_source_refs,
  target_building_type_id, target_admin_area_id, target_geom, target_centroid,
  target_area_m2, target_levels, target_height_m, target_confidence_score
FROM direct_buildings_match_raw
ORDER BY row_no, target_id;
CREATE INDEX ON direct_buildings_matches(row_no);
CREATE INDEX ON direct_buildings_matches(target_id);

CREATE TEMP TABLE direct_buildings_core AS
SELECT c.*
FROM core.core_map_buildings c
WHERE c.id IN (SELECT target_id FROM direct_buildings_matches);
CREATE INDEX ON direct_buildings_core(id);

CREATE TEMP TABLE direct_buildings_plan AS
SELECT s.*,
  m.target_id,
  m.target_deleted_at,
  coalesce((
    SELECT count(*)::bigint
    FROM direct_buildings_match_raw r
    WHERE r.row_no = s.row_no AND r.target_deleted_at IS NULL
  ), 0) AS active_target_count,
  coalesce((
    SELECT count(*)::bigint
    FROM direct_buildings_match_raw r
    WHERE r.row_no = s.row_no
  ), 0) AS target_count,
  coalesce(s.name_my,s.name_en,s.name_und) resolved_name,
  CASE
    WHEN s.classification='safe_update' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NULL AND (
      m.is_verified OR lower(m.verification_status)='verified'
    ) THEN 'skipped_protected:verified'
    WHEN s.classification='safe_update' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NULL AND (
      m.is_geometry_manually_edited OR m.is_attributes_manually_edited
    ) THEN 'skipped_protected:manual_edits'
    WHEN s.classification='safe_update' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NULL AND (
      coalesce((m.target_source_refs->>'manual_override') IN('true','t','1'),false)
      OR m.target_source_refs @> '{"source":"dashboard"}'::jsonb
      OR m.target_source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'skipped_protected:manual_source'
    ELSE NULL
  END AS protection_result,
  array_remove(ARRAY[
    CASE WHEN s.classification NOT IN('safe_new','safe_update') THEN 'unsupported classification' END,
    CASE WHEN s.local_staging_id IS NULL OR s.local_staging_id<=0 THEN 'missing/invalid local_staging_id' END,
    CASE WHEN s.identity_key IS NULL THEN 'missing/invalid OSM identity' END,
    CASE WHEN s.source_feature_type NOT IN('way','relation')
      OR s.source_feature_id IS NULL OR s.source_feature_id<=0
      THEN 'unsupported building source identity' END,
    CASE WHEN s.identity_count>1 THEN 'duplicate identity in file' END,
    CASE WHEN coalesce((
      SELECT count(*)::bigint FROM direct_buildings_match_raw r
      WHERE r.row_no = s.row_no AND r.target_deleted_at IS NULL
    ),0)>1 THEN 'identity resolves to multiple active Core rows' END,
    CASE WHEN s.building_type_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM ref.ref_building_types x
      WHERE x.id=s.building_type_id AND coalesce(x.is_active,true)
    ) THEN 'invalid building_type_id' END,
    CASE WHEN s.admin_area_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM core.core_admin_areas x
      WHERE x.id=s.admin_area_id AND x.deleted_at IS NULL
    ) THEN 'invalid admin_area_id' END,
    CASE WHEN s.geom IS NULL OR ST_SRID(s.geom)<>4326
      OR GeometryType(s.geom)<>'MULTIPOLYGON' OR ST_IsEmpty(s.geom)
      OR NOT ST_IsValid(s.geom) THEN 'invalid MultiPolygon geometry' END,
    CASE WHEN s.levels IS NOT NULL AND s.levels<0 THEN 'levels must be nonnegative' END,
    CASE WHEN s.height_m IS NOT NULL AND s.height_m<0 THEN 'height_m must be nonnegative' END,
    CASE WHEN s.confidence_score IS NULL OR s.confidence_score NOT BETWEEN 0 AND 100
      THEN 'confidence_score outside 0..100' END,
    CASE WHEN s.source_refs IS NULL OR s.normalized_data IS NULL THEN 'invalid JSON' END,
    CASE WHEN s.classification='safe_update' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NOT NULL
      THEN 'safe_update target is soft-deleted/demolished' END,
    CASE WHEN s.classification='safe_update' AND m.target_id IS NULL THEN 'safe_update target missing' END,
    CASE WHEN s.classification='safe_new' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NULL
      THEN 'safe_new identity already exists in Core' END,
    CASE WHEN s.classification='safe_new' AND m.target_id IS NOT NULL AND m.target_deleted_at IS NOT NULL
      THEN 'safe_new identity belongs to soft-deleted Core row' END
  ],NULL)::text[] AS errors
FROM direct_buildings_stage s
LEFT JOIN direct_buildings_matches m ON m.row_no = s.row_no;

DO $$
DECLARE n bigint; sample text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM direct_buildings_plan) THEN
    RAISE EXCEPTION 'buildings: CSV contains zero rows';
  END IF;
  SELECT count(*), min(array_to_string(errors,'; '))
  INTO n, sample
  FROM direct_buildings_plan
  WHERE cardinality(errors)>0;
  IF n>0 THEN
    RAISE EXCEPTION 'buildings: % rejected row(s): %', n, sample;
  END IF;
END $$;

CREATE TEMP TABLE direct_buildings_ready AS
SELECT
  s.*,
  ST_PointOnSurface(s.geom)::geometry(Point,4326) AS centroid,
  ST_Area(s.geom::geography)::numeric AS area_m2
FROM direct_buildings_plan s
WHERE s.protection_result IS NULL;

CREATE INDEX ON direct_buildings_ready(row_no) WHERE classification='safe_new' AND target_id IS NULL;
CREATE INDEX ON direct_buildings_ready(target_id) WHERE classification='safe_update';

DO $$
DECLARE
  n_new bigint;
  n_upd bigint;
BEGIN
  SELECT count(*) INTO n_new FROM direct_buildings_ready
  WHERE classification='safe_new' AND target_id IS NULL;
  SELECT count(*) INTO n_upd FROM direct_buildings_ready
  WHERE classification='safe_update' AND target_id IS NOT NULL;
  RAISE NOTICE 'buildings ready: safe_new=% safe_update=%', n_new, n_upd;
  IF n_new = 0 AND n_upd = 0 THEN
    RAISE EXCEPTION 'buildings: ready set has zero writable rows';
  END IF;
END $$;

CREATE TEMP TABLE direct_buildings_changes(
  action text NOT NULL,entity_id bigint NOT NULL,external_id text NOT NULL,
  before_data jsonb,after_data jsonb
) ON COMMIT DROP;

-- Batched inserts (1000 rows). Centroid/area come from final geometry above.
DO $$
DECLARE
  batch_size int := 1000;
  lo bigint := 0;
  hi bigint;
  max_row bigint;
  batch_n bigint;
BEGIN
  SELECT coalesce(max(row_no), 0) INTO max_row
  FROM direct_buildings_ready
  WHERE classification='safe_new' AND target_id IS NULL;

  IF max_row = 0 THEN
    RAISE NOTICE 'buildings: no safe_new rows to insert';
    RETURN;
  END IF;

  lo := 1;
  WHILE lo <= max_row LOOP
    hi := lo + batch_size - 1;
    WITH ins AS (
      INSERT INTO core.core_map_buildings(
        external_id,name,building_type_id,admin_area_id,geom,centroid,area_m2,
        levels,height_m,confidence_score,normalized_data,source_refs,is_active,
        is_verified,verification_status,source_registry_id,source_snapshot_id,
        source_feature_type,source_feature_id,region_code)
      SELECT s.external_id,NULL,s.building_type_id,s.admin_area_id,
        s.geom::geometry(MultiPolygon,4326),
        s.centroid,
        s.area_m2,
        s.levels,s.height_m,
        s.confidence_score,s.normalized_data||jsonb_build_object(
          'local_staging_id',s.local_staging_id,'import_class',s.classification),
        s.source_refs||jsonb_build_object('external_id',s.external_id,
          'source_snapshot_version',p.snapshot_version,'region_code',p.region_code,
          'loader','direct_core.buildings'),true,false,'unverified',
        p.source_registry_id,p.source_snapshot_id,s.source_feature_type,
        s.source_feature_id,p.region_code
      FROM direct_buildings_ready s
      CROSS JOIN direct_buildings_params p
      WHERE s.classification='safe_new'
        AND s.target_id IS NULL
        AND s.row_no BETWEEN lo AND hi
      RETURNING id, external_id, building_type_id, admin_area_id, levels, height_m, confidence_score
    )
    INSERT INTO direct_buildings_changes(action, entity_id, external_id, before_data, after_data)
    SELECT
      'insert',
      i.id,
      i.external_id,
      NULL,
      jsonb_build_object(
        'id', i.id,
        'external_id', i.external_id,
        'building_type_id', i.building_type_id,
        'admin_area_id', i.admin_area_id,
        'levels', i.levels,
        'height_m', i.height_m,
        'confidence_score', i.confidence_score,
        'loader', 'direct_core.buildings'
      )
    FROM ins i;
    GET DIAGNOSTICS batch_n = ROW_COUNT;
    RAISE NOTICE 'buildings insert batch rows %-% inserted=%', lo, hi, batch_n;
    lo := hi + 1;
  END LOOP;
END $$;

WITH upd AS(
 UPDATE core.core_map_buildings c SET
  building_type_id=s.building_type_id,admin_area_id=s.admin_area_id,
  geom=s.geom::geometry(MultiPolygon,4326),
  centroid=s.centroid,
  area_m2=s.area_m2,
  levels=s.levels,height_m=s.height_m,confidence_score=s.confidence_score,
  normalized_data=c.normalized_data||s.normalized_data||jsonb_build_object(
    'local_staging_id',s.local_staging_id,'import_class',s.classification),
  source_refs=(
    (c.source_refs - ARRAY['source','manual_override'])
    || (s.source_refs - ARRAY['source','manual_override'])
    || jsonb_build_object(
      'external_id',s.external_id,
      'source_snapshot_version',p.snapshot_version,
      'region_code',p.region_code,
      'loader','direct_core.buildings'
    )
    || CASE
         WHEN c.source_refs ? 'source' THEN jsonb_build_object('source', c.source_refs->>'source')
         ELSE '{}'::jsonb
       END
    || CASE
         WHEN c.source_refs ? 'manual_override'
           THEN jsonb_build_object('manual_override', c.source_refs->>'manual_override')
         ELSE '{}'::jsonb
       END
  ),
  source_registry_id=p.source_registry_id,source_snapshot_id=p.source_snapshot_id,
  source_feature_type=s.source_feature_type,source_feature_id=s.source_feature_id,
  region_code=p.region_code,updated_at=now()
 FROM direct_buildings_ready s CROSS JOIN direct_buildings_params p
 WHERE c.id=s.target_id AND s.classification='safe_update'
  AND(c.building_type_id,c.admin_area_id,c.geom,c.levels,c.height_m,c.confidence_score)
  IS DISTINCT FROM(s.building_type_id,s.admin_area_id,s.geom,s.levels,s.height_m,s.confidence_score)
 RETURNING c.id,s.external_id
)
INSERT INTO direct_buildings_changes
SELECT
  'update',
  u.id,
  u.external_id,
  jsonb_build_object(
    'id', b.id,
    'external_id', b.external_id,
    'building_type_id', b.building_type_id,
    'admin_area_id', b.admin_area_id,
    'levels', b.levels,
    'height_m', b.height_m,
    'confidence_score', b.confidence_score
  ),
  jsonb_build_object(
    'id', a.id,
    'external_id', a.external_id,
    'building_type_id', a.building_type_id,
    'admin_area_id', a.admin_area_id,
    'levels', a.levels,
    'height_m', a.height_m,
    'confidence_score', a.confidence_score
  )
FROM upd u
JOIN direct_buildings_core b ON b.id=u.id
JOIN core.core_map_buildings a ON a.id=u.id;

-- Canonical names live in core_map_building_names (imported only; never overwrite
-- official/local/alternate). Legacy core_map_buildings.name is not written.
-- Skip name writes for protected/skipped rows.
CREATE TEMP TABLE direct_buildings_name_source AS
SELECT coalesce(c.entity_id,s.target_id) building_id,s.name_my,s.name_en,s.name_und
FROM direct_buildings_ready s
LEFT JOIN direct_buildings_changes c ON c.external_id=s.external_id
WHERE coalesce(c.entity_id,s.target_id) IS NOT NULL;
INSERT INTO core.core_map_building_names(
 building_id,name,language_code,script_code,name_type,is_primary,search_weight)
SELECT s.building_id,n.name,n.lang,n.script,'imported',
 NOT EXISTS (
  SELECT 1 FROM core.core_map_building_names existing
  WHERE existing.building_id=s.building_id
    AND existing.language_code=n.lang
    AND existing.is_primary IS TRUE
 ),
 100
FROM direct_buildings_name_source s CROSS JOIN LATERAL(VALUES
 (s.name_my,'my','Mymr'),(s.name_en,'en','Latn'),(s.name_und,'und',NULL)
)n(name,lang,script)
WHERE nullif(btrim(n.name),'') IS NOT NULL
ON CONFLICT (building_id, language_code, name_type, (lower(btrim(name)))) DO NOTHING;

CREATE TEMP TABLE direct_buildings_audit(import_batch_id bigint,publish_batch_id bigint)ON COMMIT DROP;
WITH ib AS(
 INSERT INTO system.system_import_batches(source_registry_id,batch_name,trigger_type,status,finished_at,note)
 SELECT source_registry_id,format('direct_core_buildings:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'manual','completed',now(),
  'Regional direct-Core buildings bulk import' FROM direct_buildings_params RETURNING id
),pb AS(
 INSERT INTO system.system_publish_batches(batch_name,status,note,source_snapshot_version,
  region_code,total_item_count,success_count,failed_count,skipped_count,summary,published_at,promoted_at)
 SELECT format('direct_core_buildings:%s:%s:%s',region_code,snapshot_version,
  to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')),'promoted',
  'Regional direct-Core buildings bulk import',snapshot_version,region_code,
  (SELECT count(*) FROM direct_buildings_plan),
  (SELECT count(*) FROM direct_buildings_changes),0,
  (SELECT count(*) FROM direct_buildings_plan WHERE protection_result IS NOT NULL)
   + ((SELECT count(*) FROM direct_buildings_ready)
      - (SELECT count(*) FROM direct_buildings_changes)),
  jsonb_build_object('loader','direct_core.buildings','transaction_scope','region',
   'inserted',(SELECT count(*) FROM direct_buildings_changes WHERE action='insert'),
   'updated',(SELECT count(*) FROM direct_buildings_changes WHERE action='update'),
   'skipped_protected',(SELECT count(*) FROM direct_buildings_plan WHERE protection_result IS NOT NULL),
   'unchanged_ready',(SELECT count(*) FROM direct_buildings_ready)
      -(SELECT count(*) FROM direct_buildings_changes)),now(),now()
 FROM direct_buildings_params RETURNING id
)
INSERT INTO direct_buildings_audit SELECT ib.id,pb.id FROM ib CROSS JOIN pb;
INSERT INTO system.system_publish_items(publish_batch_id,entity_family,entity_id,
 publish_action,publish_status,external_id,target_schema,target_table,target_id,
 before_data,after_data,validation_result,published_at,source_snapshot_version)
SELECT a.publish_batch_id,'buildings',c.entity_id,c.action,'success',c.external_id,
 'core','core_map_buildings',c.entity_id,c.before_data,c.after_data,
 '{"validated":true,"source":"local_pipeline"}'::jsonb,now(),p.snapshot_version
FROM direct_buildings_changes c CROSS JOIN direct_buildings_audit a CROSS JOIN direct_buildings_params p;

DO $$
DECLARE
  staged bigint;
  protected_n bigint;
  inserted_n bigint;
  updated_n bigint;
  expected_new bigint;
  expected_upd bigint;
BEGIN
  SELECT count(*) INTO staged FROM direct_buildings_ready;
  SELECT count(*) INTO protected_n FROM direct_buildings_plan WHERE protection_result IS NOT NULL;
  SELECT count(*) INTO inserted_n FROM direct_buildings_changes WHERE action='insert';
  SELECT count(*) INTO updated_n FROM direct_buildings_changes WHERE action='update';
  SELECT count(*) INTO expected_new
  FROM direct_buildings_ready WHERE classification='safe_new' AND target_id IS NULL;
  SELECT count(*) INTO expected_upd
  FROM direct_buildings_ready WHERE classification='safe_update';

  IF inserted_n <> expected_new THEN
    RAISE EXCEPTION 'buildings verification: inserted=% expected_new=%', inserted_n, expected_new;
  END IF;
  IF updated_n > expected_upd THEN
    RAISE EXCEPTION 'buildings verification: updated=% expected_upd=%', updated_n, expected_upd;
  END IF;
  IF staged <> expected_new + expected_upd THEN
    RAISE EXCEPTION 'buildings verification: ready_staged=% new+upd=%',
      staged, expected_new + expected_upd;
  END IF;

  -- Confirm inserted identities exist via typed source columns (indexed).
  IF EXISTS (
    SELECT 1
    FROM direct_buildings_ready s
    CROSS JOIN direct_buildings_params p
    WHERE s.classification='safe_new'
      AND s.target_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM core.core_map_buildings c
        WHERE c.deleted_at IS NULL
          AND c.source_registry_id = p.source_registry_id
          AND c.source_feature_type = s.source_feature_type
          AND c.source_feature_id = s.source_feature_id
      )
  ) THEN
    RAISE EXCEPTION 'buildings verification: some safe_new identities missing after insert';
  END IF;

  RAISE NOTICE 'buildings verification OK: staged=% inserted=% updated=% protected=%',
    staged, inserted_n, updated_n, protected_n;
END $$;

SELECT 'direct_core_buildings' AS section,
 (SELECT count(*) FROM direct_buildings_plan) AS staged_total,
 (SELECT count(*) FROM direct_buildings_ready) AS ready_total,
 (SELECT count(*) FROM direct_buildings_plan WHERE protection_result IS NOT NULL) AS skipped_protected,
 (SELECT count(*) FROM direct_buildings_plan WHERE classification='safe_new' AND protection_result IS NULL) AS ready_safe_new,
 (SELECT count(*) FROM direct_buildings_plan WHERE classification='safe_update' AND protection_result IS NULL) AS ready_safe_update,
 (SELECT count(*) FROM direct_buildings_changes WHERE action='insert') AS inserted,
 (SELECT count(*) FROM direct_buildings_changes WHERE action='update') AS updated,
 (SELECT count(*) FROM direct_buildings_name_source s CROSS JOIN LATERAL (VALUES
    (s.name_my),(s.name_en),(s.name_und)
  ) n(name) WHERE nullif(btrim(n.name),'') IS NOT NULL) AS name_rows_attempted,
 (SELECT count(*) FROM system.system_publish_items i
   WHERE i.publish_batch_id=(SELECT publish_batch_id FROM direct_buildings_audit)) AS publish_items,
 (SELECT publish_batch_id FROM direct_buildings_audit) AS publish_batch_id,
 (SELECT dry_run FROM direct_buildings_params) AS dry_run;

\if :dry_run
ROLLBACK;
\else
COMMIT;
\endif
