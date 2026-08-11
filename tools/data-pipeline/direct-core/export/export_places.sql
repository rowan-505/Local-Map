\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

CREATE TEMP TABLE direct_export_context AS
SELECT id source_snapshot_id,snapshot_version
FROM system.system_source_snapshots WHERE snapshot_version=:'snapshot_version';
SELECT 1/CASE WHEN EXISTS(
  SELECT 1 FROM direct_export_context
) THEN 1 ELSE 0 END AS snapshot_found;
SELECT 1/CASE WHEN EXISTS(
  SELECT 1 FROM :"staging_schema".staging_place_candidates s,direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN('safe_new','safe_update')
   AND(coalesce(s.validation_status,'valid')IN('invalid','blocked','failed')
    OR system.pipeline_osm_identity_key(s.external_id)IS NULL)
) THEN 0 ELSE 1 END AS safe_rows_valid;

\copy (
 SELECT s.import_class classification,s.id local_staging_id,
  system.pipeline_osm_identity_key(s.external_id)external_id,
  s.canonical_name primary_name,
  (SELECT n.name FROM :"staging_schema".staging_place_name_candidates n
   WHERE n.place_candidate_id=s.id AND lower(coalesce(n.language_code,''))IN('my','mm')
   ORDER BY n.is_primary DESC,n.id LIMIT 1)name_my,
  (SELECT n.name FROM :"staging_schema".staging_place_name_candidates n
   WHERE n.place_candidate_id=s.id AND lower(coalesce(n.language_code,''))='en'
   ORDER BY n.is_primary DESC,n.id LIMIT 1)name_en,
  coalesce((to_jsonb(s)->>'poi_category_id')::bigint,
           (to_jsonb(s)->>'category_id')::bigint)category_id,
  coalesce((s.normalized_data->>'admin_area_id')::bigint,
           (to_jsonb(s)->>'admin_area_id')::bigint)admin_area_id,
  ST_AsEWKT(s.point_geom)point_ewkt,
  least(100,greatest(0,coalesce(s.confidence_score,50)))importance_score,
  least(100,greatest(0,coalesce(s.confidence_score,50)))popularity_score,
  least(100,greatest(0,coalesce(s.confidence_score,50)))confidence_score,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_place_candidates s,direct_export_context x
 WHERE s.source_snapshot_id=x.source_snapshot_id
  AND s.import_class IN('safe_new','safe_update')
 ORDER BY s.id
) TO :'output_path' WITH(FORMAT csv,HEADER true)

\copy (
 SELECT 'places'entity_family,s.id local_staging_id,s.external_id,s.import_class,
  s.validation_status,coalesce(s.import_class_reason,'{}'::jsonb)rejection_reason,
  s.source_refs,s.normalized_data
 FROM :"staging_schema".staging_place_candidates s,direct_export_context x
 WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class='invalid'
 ORDER BY s.id
) TO :'rejection_path' WITH(FORMAT csv,HEADER true)

SELECT import_class,count(*) n
FROM :"staging_schema".staging_place_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id
GROUP BY import_class ORDER BY import_class;
