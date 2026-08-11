\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
CREATE TEMP TABLE direct_export_context AS
SELECT id source_snapshot_id FROM system.system_source_snapshots WHERE snapshot_version=:'snapshot_version';
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM direct_export_context)THEN 1 ELSE 0 END snapshot_found;
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM :"staging_schema".staging_water_polygon_candidates s,direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN('safe_new','safe_update')
   AND(coalesce(s.validation_status,'valid')IN('invalid','blocked','failed')
    OR system.pipeline_osm_identity_key(s.external_id)IS NULL))
 THEN 0 ELSE 1 END safe_rows_valid;
\copy (
 SELECT s.import_class classification,s.id local_staging_id,
  system.pipeline_osm_identity_key(s.external_id)external_id,s.canonical_name name_und,
  coalesce(s.normalized_data->>'name_my',s.normalized_data->>'name:mm')name_my,
  coalesce(s.normalized_data->>'name_en',s.normalized_data->>'name:en')name_en,
  lower(s.class_code)class_code,
  ST_AsEWKT(ST_Multi(ST_CollectionExtract(ST_MakeValid(s.geom),3)))geom_ewkt,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_water_polygon_candidates s,direct_export_context x
 WHERE s.source_snapshot_id=x.source_snapshot_id
  AND s.import_class IN('safe_new','safe_update') ORDER BY s.id
) TO :'output_path' WITH(FORMAT csv,HEADER true)
\copy (
 SELECT 'water_polygons'entity_family,s.id local_staging_id,s.external_id,s.import_class,
  s.validation_status,coalesce(s.import_class_reason,'{}'::jsonb)rejection_reason,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_water_polygon_candidates s,direct_export_context x
 WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class='invalid' ORDER BY s.id
) TO :'rejection_path' WITH(FORMAT csv,HEADER true)
SELECT import_class,count(*)n FROM :"staging_schema".staging_water_polygon_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id GROUP BY import_class ORDER BY import_class;
