\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
CREATE TEMP TABLE direct_export_context AS
SELECT id source_snapshot_id FROM system.system_source_snapshots WHERE snapshot_version=:'snapshot_version';
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM direct_export_context)THEN 1 ELSE 0 END snapshot_found;
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM :"staging_schema".staging_road_candidates s,direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN('safe_new','safe_update')
   AND(coalesce(s.validation_status,'valid')IN('invalid','blocked','failed')
    OR system.pipeline_osm_identity_key(s.external_id)IS NULL))
 THEN 0 ELSE 1 END safe_rows_valid;
\copy (
 SELECT s.import_class classification,s.id local_staging_id,
  system.pipeline_osm_identity_key(s.external_id)external_id,s.canonical_name,
  (SELECT n.name FROM :"staging_schema".staging_road_name_candidates n
   WHERE n.road_candidate_id=s.id AND lower(n.language_code)IN('my','mm')
   ORDER BY n.is_primary DESC,n.id LIMIT 1)name_my,
  (SELECT n.name FROM :"staging_schema".staging_road_name_candidates n
   WHERE n.road_candidate_id=s.id AND lower(n.language_code)='en'
   ORDER BY n.is_primary DESC,n.id LIMIT 1)name_en,
  s.road_class_id,
  coalesce((s.normalized_data->>'admin_area_id')::bigint,
           (to_jsonb(s)->>'admin_area_id')::bigint)admin_area_id,
  ST_AsEWKT(line.geom)geom_ewkt,
  coalesce(s.is_oneway,false)is_oneway,
  coalesce((s.normalized_data->>'bridge')::boolean,false)bridge,
  coalesce((s.normalized_data->>'tunnel')::boolean,false)tunnel,
  coalesce((s.normalized_data->>'layer')::integer,0)layer,
  nullif(btrim(s.normalized_data->>'surface'),'')surface,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_road_candidates s
 CROSS JOIN direct_export_context x
 CROSS JOIN LATERAL(
  SELECT d.geom::geometry(LineString,4326)geom
  FROM ST_Dump(ST_CollectionExtract(ST_MakeValid(s.geom),2))d
  ORDER BY ST_Length(d.geom::geography)DESC LIMIT 1
 )line
 WHERE s.source_snapshot_id=x.source_snapshot_id
  AND s.import_class IN('safe_new','safe_update')
 ORDER BY s.id
) TO :'output_path' WITH(FORMAT csv,HEADER true)
\copy (
 SELECT 'roads'entity_family,s.id local_staging_id,s.external_id,s.import_class,
  s.validation_status,coalesce(s.import_class_reason,'{}'::jsonb)rejection_reason,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_road_candidates s,direct_export_context x
 WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class='invalid' ORDER BY s.id
) TO :'rejection_path' WITH(FORMAT csv,HEADER true)
SELECT import_class,count(*)n FROM :"staging_schema".staging_road_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id GROUP BY import_class ORDER BY import_class;
