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
  SELECT 1 FROM :"staging_schema".staging_settlement_candidates s,direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN('safe_new','safe_update')
   AND(coalesce(s.validation_status,'valid')IN('invalid','blocked','failed')
    OR system.pipeline_osm_identity_key(s.external_id)IS NULL
    OR s.point_geom IS NULL
    OR ST_IsEmpty(s.point_geom)
    OR NOT ST_IsValid(s.point_geom)
    OR GeometryType(s.point_geom)<>'POINT'
    OR nullif(btrim(coalesce(s.canonical_name,'')),'') IS NULL
    OR lower(btrim(coalesce(s.class_code,''))) NOT IN ('city','town','village','local_area')
    OR nullif(s.normalized_data->>'admin_area_id','') IS NULL)
) THEN 0 ELSE 1 END AS safe_rows_valid;

CREATE TEMP TABLE direct_settlements_safe AS
SELECT s.import_class AS classification,
       s.id AS local_staging_id,
       system.pipeline_osm_identity_key(s.external_id) AS external_id,
       s.canonical_name,
       s.name_mm,
       s.name_en,
       lower(s.class_code) AS class_code,
       (s.normalized_data->>'admin_area_id')::bigint AS township_id,
       s.population,
       ST_AsEWKT(s.point_geom) AS point_ewkt,
       s.source_refs,
       s.normalized_data
FROM :"staging_schema".staging_settlement_candidates s, direct_export_context x
WHERE s.source_snapshot_id = x.source_snapshot_id
  AND s.import_class IN ('safe_new', 'safe_update')
ORDER BY s.id;

CREATE TEMP TABLE direct_settlements_rejected AS
SELECT 'settlements'::text AS entity_family,
       s.id AS local_staging_id,
       s.external_id,
       s.import_class,
       s.validation_status,
       coalesce(s.import_class_reason, '{}'::jsonb) AS rejection_reason,
       s.source_refs,
       s.normalized_data
FROM :"staging_schema".staging_settlement_candidates s, direct_export_context x
WHERE s.source_snapshot_id = x.source_snapshot_id
  AND s.import_class = 'invalid'
ORDER BY s.id;

\o :output_path
COPY direct_settlements_safe TO STDOUT WITH (FORMAT csv, HEADER true);
\o

\o :rejection_path
COPY direct_settlements_rejected TO STDOUT WITH (FORMAT csv, HEADER true);
\o

SELECT import_class,count(*) n
FROM :"staging_schema".staging_settlement_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id
GROUP BY import_class ORDER BY import_class;
