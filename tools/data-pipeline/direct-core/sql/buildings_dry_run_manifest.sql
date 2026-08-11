-- One-time dry-run manifest for national buildings direct-Core prep.
-- Local geo_core only. Uses supabase_fdw for live Core matching.
\set ON_ERROR_STOP on
\pset pager off

CREATE TEMP TABLE manifest_ctx AS
SELECT id AS source_snapshot_id
FROM system.system_source_snapshots
WHERE snapshot_version = :'snapshot_version';

CREATE TEMP TABLE buildings_manifest AS
SELECT
  s.id AS local_candidate_id,
  s.external_id AS staging_external_id,
  system.pipeline_osm_identity_key(s.external_id) AS normalized_identity,
  split_part(system.pipeline_osm_identity_key(s.external_id), ':', 2) AS source_feature_type,
  split_part(system.pipeline_osm_identity_key(s.external_id), ':', 3)::bigint AS source_feature_id,
  s.import_class,
  CASE
    WHEN s.import_class = 'safe_new' THEN 'insert'
    WHEN s.import_class = 'safe_update' THEN 'update'
    ELSE 'reject'
  END AS intended_action,
  c.id AS matched_core_id,
  coalesce(
    (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = s.class_code LIMIT 1),
    (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = 'unknown' LIMIT 1)
  ) AS building_type_id,
  (s.normalized_data->>'admin_area_id')::bigint AS admin_area_id,
  (s.geom IS NOT NULL AND ST_SRID(s.geom)=4326 AND GeometryType(s.geom)='MULTIPOLYGON'
    AND NOT ST_IsEmpty(s.geom) AND ST_IsValid(s.geom)) AS geometry_valid,
  CASE WHEN s.canonical_name ~ '[က-႟]' THEN s.canonical_name
       ELSE nullif(btrim(s.normalized_data->'tags'->>'name:my'),'') END AS name_my,
  CASE WHEN s.canonical_name ~ '[A-Za-z]' AND s.canonical_name !~ '[က-႟]' THEN s.canonical_name
       ELSE nullif(btrim(s.normalized_data->'tags'->>'name:en'),'') END AS name_en,
  coalesce(nullif(btrim(s.normalized_data->'tags'->>'name'),''), s.canonical_name) AS name_und,
  CASE
    WHEN s.import_class='safe_update' AND c.id IS NOT NULL AND c.deleted_at IS NULL AND (
      c.is_verified OR lower(c.verification_status)='verified'
      OR coalesce((c.source_refs->>'manual_override') IN ('true','t','1'), false)
      OR c.source_refs @> '{"source":"dashboard"}'::jsonb
      OR c.source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'skipped_protected'
    ELSE 'none'
  END AS manual_protection_result,
  CASE
    WHEN s.import_class NOT IN ('safe_new','safe_update') THEN 'out_of_scope_class'
    WHEN system.pipeline_osm_identity_key(s.external_id) IS NULL THEN 'invalid_identity'
    WHEN s.import_class='safe_new' AND c.id IS NOT NULL AND c.deleted_at IS NULL THEN 'safe_new_collision'
    WHEN s.import_class='safe_new' AND c.id IS NOT NULL AND c.deleted_at IS NOT NULL THEN 'safe_new_deleted_collision'
    WHEN s.import_class='safe_update' AND c.id IS NULL THEN 'safe_update_missing_target'
    WHEN s.import_class='safe_update' AND c.deleted_at IS NOT NULL THEN 'safe_update_deleted_target'
    WHEN NOT (s.geom IS NOT NULL AND ST_SRID(s.geom)=4326 AND GeometryType(s.geom)='MULTIPOLYGON'
      AND NOT ST_IsEmpty(s.geom) AND ST_IsValid(s.geom)) THEN 'invalid_geometry'
    WHEN coalesce(
      (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = s.class_code LIMIT 1),
      (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = 'unknown' LIMIT 1)
    ) IS NULL THEN 'missing_building_type'
    WHEN (s.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
      AND NOT EXISTS (
        SELECT 1 FROM supabase_fdw.core_admin_areas a
        WHERE a.id = (s.normalized_data->>'admin_area_id')::bigint AND a.deleted_at IS NULL
      ) THEN 'invalid_admin_area_id'
    WHEN s.import_class='safe_update' AND c.id IS NOT NULL AND c.deleted_at IS NULL AND (
      c.is_verified OR lower(c.verification_status)='verified'
      OR coalesce((c.source_refs->>'manual_override') IN ('true','t','1'), false)
      OR c.source_refs @> '{"source":"dashboard"}'::jsonb
      OR c.source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'skipped_protected'
    ELSE 'ready'
  END AS final_readiness,
  CASE
    WHEN s.import_class NOT IN ('safe_new','safe_update') THEN 'out_of_scope_class'
    WHEN system.pipeline_osm_identity_key(s.external_id) IS NULL THEN 'invalid_identity'
    WHEN s.import_class='safe_new' AND c.id IS NOT NULL AND c.deleted_at IS NULL THEN 'safe_new_collision'
    WHEN s.import_class='safe_new' AND c.id IS NOT NULL AND c.deleted_at IS NOT NULL THEN 'safe_new_deleted_collision'
    WHEN s.import_class='safe_update' AND c.id IS NULL THEN 'safe_update_missing_target'
    WHEN s.import_class='safe_update' AND c.deleted_at IS NOT NULL THEN 'safe_update_deleted_target'
    WHEN NOT (s.geom IS NOT NULL AND ST_SRID(s.geom)=4326 AND GeometryType(s.geom)='MULTIPOLYGON'
      AND NOT ST_IsEmpty(s.geom) AND ST_IsValid(s.geom)) THEN 'invalid_geometry'
    WHEN coalesce(
      (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = s.class_code LIMIT 1),
      (SELECT t.id FROM prod_mirror.ref_building_types t WHERE t.code = 'unknown' LIMIT 1)
    ) IS NULL THEN 'missing_building_type'
    WHEN (s.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
      AND NOT EXISTS (
        SELECT 1 FROM supabase_fdw.core_admin_areas a
        WHERE a.id = (s.normalized_data->>'admin_area_id')::bigint AND a.deleted_at IS NULL
      ) THEN 'invalid_admin_area_id'
    WHEN s.import_class='safe_update' AND c.id IS NOT NULL AND c.deleted_at IS NULL AND (
      c.is_verified OR lower(c.verification_status)='verified'
      OR coalesce((c.source_refs->>'manual_override') IN ('true','t','1'), false)
      OR c.source_refs @> '{"source":"dashboard"}'::jsonb
      OR c.source_refs @> '{"source":"manual"}'::jsonb
    ) THEN 'skipped_protected'
    ELSE NULL
  END AS rejection_or_skip_reason
FROM staging.staging_building_candidates s
JOIN manifest_ctx x ON x.source_snapshot_id = s.source_snapshot_id
LEFT JOIN supabase_fdw.core_map_buildings c
  ON system.pipeline_osm_identity_key(c.external_id) = system.pipeline_osm_identity_key(s.external_id)
WHERE s.import_class IN ('safe_new','safe_update');

SELECT final_readiness, count(*) FROM buildings_manifest GROUP BY 1 ORDER BY 2 DESC;
SELECT import_class, final_readiness, count(*) FROM buildings_manifest GROUP BY 1,2 ORDER BY 1,2;

\o :manifest_path
COPY buildings_manifest TO STDOUT WITH (FORMAT csv, HEADER true);
\o
