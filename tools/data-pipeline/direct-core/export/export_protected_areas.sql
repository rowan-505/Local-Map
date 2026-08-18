\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

CREATE TEMP TABLE direct_export_context AS
SELECT id AS source_snapshot_id
FROM system.system_source_snapshots
WHERE snapshot_version = :'snapshot_version';

SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM direct_export_context) THEN 1 ELSE 0 END AS snapshot_found;

CREATE TEMP TABLE direct_protected_areas_export_safe AS
SELECT
  s.import_class AS classification,
  s.id AS local_staging_id,
  system.pipeline_osm_identity_key(s.external_id) AS external_id,
  nullif(btrim(coalesce(s.normalized_data->>'name_und', s.canonical_name)), '') AS name_und,
  nullif(btrim(coalesce(
    s.normalized_data->>'name_mm',
    s.normalized_data->>'name_my',
    s.normalized_data->>'name:my',
    s.normalized_data->>'name:mm'
  )), '') AS name_my,
  nullif(btrim(coalesce(s.normalized_data->>'name_en', s.normalized_data->>'name:en')), '') AS name_en,
  lower(s.class_code) AS class_code,
  ST_AsEWKT(ST_Multi(ST_CollectionExtract(ST_MakeValid(s.geom), 3))) AS geom_ewkt,
  least(100, greatest(0, coalesce(s.confidence_score, 70))) AS confidence_score,
  coalesce(s.normalized_data->'tags', '{}'::jsonb) AS source_tags,
  s.source_refs,
  s.normalized_data
FROM :"staging_schema".staging_protected_area_candidates s
JOIN direct_export_context x ON s.source_snapshot_id = x.source_snapshot_id
WHERE s.import_class IN ('safe_new', 'safe_update')
ORDER BY s.id;

CREATE TEMP TABLE direct_protected_areas_export_review AS
SELECT
  s.import_class AS classification,
  s.id AS local_staging_id,
  system.pipeline_osm_identity_key(s.external_id) AS external_id,
  nullif(btrim(coalesce(s.normalized_data->>'name_und', s.canonical_name)), '') AS name_und,
  nullif(btrim(coalesce(
    s.normalized_data->>'name_mm',
    s.normalized_data->>'name_my',
    s.normalized_data->>'name:my',
    s.normalized_data->>'name:mm'
  )), '') AS name_my,
  nullif(btrim(coalesce(s.normalized_data->>'name_en', s.normalized_data->>'name:en')), '') AS name_en,
  lower(s.class_code) AS class_code,
  ST_AsEWKT(ST_Multi(ST_CollectionExtract(ST_MakeValid(s.geom), 3))) AS geom_ewkt,
  least(100, greatest(0, coalesce(s.confidence_score, 70))) AS confidence_score,
  coalesce(s.normalized_data->'tags', '{}'::jsonb) AS source_tags,
  s.source_refs,
  s.normalized_data,
  s.validation_status,
  coalesce(s.import_class_reason, '{}'::jsonb) AS rejection_reason
FROM :"staging_schema".staging_protected_area_candidates s
JOIN direct_export_context x ON s.source_snapshot_id = x.source_snapshot_id
WHERE s.import_class IN (
  'duplicate', 'conflict', 'manual_protected', 'verified_conflict', 'possible_delete'
)
ORDER BY s.id;

\copy direct_protected_areas_export_safe TO :'output_path' WITH (FORMAT csv, HEADER true)
\copy direct_protected_areas_export_review TO :'review_path' WITH (FORMAT csv, HEADER true)

SELECT import_class, count(*) AS n
FROM :"staging_schema".staging_protected_area_candidates s
JOIN direct_export_context x ON s.source_snapshot_id = x.source_snapshot_id
GROUP BY import_class
ORDER BY import_class;

SELECT 'export_safe_rows' AS section, count(*)::bigint AS n FROM direct_protected_areas_export_safe;
SELECT 'export_review_rows' AS section, count(*)::bigint AS n FROM direct_protected_areas_export_review;
