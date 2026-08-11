\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
CREATE TEMP TABLE direct_export_context AS
SELECT id source_snapshot_id FROM system.system_source_snapshots WHERE snapshot_version=:'snapshot_version';
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM direct_export_context)THEN 1 ELSE 0 END snapshot_found;
SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM :"staging_schema".staging_building_candidates s,direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN('safe_new','safe_update')
   AND(coalesce(s.validation_status,'valid')IN('invalid','blocked','failed')
    OR system.pipeline_osm_identity_key(s.external_id)IS NULL))
 THEN 0 ELSE 1 END safe_rows_valid;

CREATE TEMP TABLE direct_buildings_export AS
SELECT s.import_class AS classification,
  s.id AS local_staging_id,
  system.pipeline_osm_identity_key(s.external_id) AS external_id,
  coalesce(
    (SELECT nullif(btrim(n->>'name'),'')
     FROM jsonb_array_elements(coalesce(s.normalized_data->'names','[]'::jsonb)) n
     WHERE lower(coalesce(n->>'language_code',''))='und'
     ORDER BY CASE WHEN coalesce((n->>'is_primary')::boolean,false) THEN 0 ELSE 1 END
     LIMIT 1),
    nullif(btrim(s.normalized_data->'tags'->>'name'),''),
    CASE
      WHEN s.canonical_name IS NOT NULL
       AND nullif(btrim(s.normalized_data->'tags'->>'name:my'),'') IS NULL
       AND nullif(btrim(s.normalized_data->'tags'->>'name:mm'),'') IS NULL
       AND nullif(btrim(s.normalized_data->'tags'->>'name:en'),'') IS NULL
       AND s.canonical_name !~ '[က-႟]'
       AND s.canonical_name !~ '[A-Za-z]'
      THEN s.canonical_name
      ELSE NULL
    END
  ) AS name_und,
  coalesce(
    (SELECT nullif(btrim(n->>'name'),'')
     FROM jsonb_array_elements(coalesce(s.normalized_data->'names','[]'::jsonb)) n
     WHERE lower(coalesce(n->>'language_code','')) IN ('my','mm')
     ORDER BY CASE WHEN coalesce((n->>'is_primary')::boolean,false) THEN 0 ELSE 1 END
     LIMIT 1),
    nullif(btrim(s.normalized_data->'tags'->>'name:my'),''),
    nullif(btrim(s.normalized_data->'tags'->>'name:mm'),''),
    nullif(btrim(s.normalized_data->'tags'->>'name:my-MM'),''),
    nullif(btrim(s.normalized_data->>'name_my'),''),
    CASE WHEN s.canonical_name ~ '[က-႟]' THEN s.canonical_name ELSE NULL END
  ) AS name_my,
  coalesce(
    (SELECT nullif(btrim(n->>'name'),'')
     FROM jsonb_array_elements(coalesce(s.normalized_data->'names','[]'::jsonb)) n
     WHERE lower(coalesce(n->>'language_code',''))='en'
     ORDER BY CASE WHEN coalesce((n->>'is_primary')::boolean,false) THEN 0 ELSE 1 END
     LIMIT 1),
    nullif(btrim(s.normalized_data->'tags'->>'name:en'),''),
    nullif(btrim(s.normalized_data->>'name_en'),''),
    CASE
      WHEN s.canonical_name ~ '[A-Za-z]' AND s.canonical_name !~ '[က-႟]'
      THEN s.canonical_name
      ELSE NULL
    END
  ) AS name_en,
  coalesce(
    (to_jsonb(s)->>'building_type_id')::bigint,
    (s.normalized_data->>'building_type_id')::bigint,
    (SELECT t.id FROM prod_mirror.ref_building_types t
      WHERE t.code = s.class_code
      LIMIT 1),
    (SELECT t.id FROM prod_mirror.ref_building_types t
      WHERE t.code = 'unknown'
      LIMIT 1)
  ) AS building_type_id,
  coalesce((s.normalized_data->>'admin_area_id')::bigint,
           (to_jsonb(s)->>'admin_area_id')::bigint) AS admin_area_id,
  ST_AsEWKT(ST_Multi(ST_CollectionExtract(ST_MakeValid(s.geom),3))) AS geom_ewkt,
  CASE
    WHEN coalesce(
      nullif(btrim(s.normalized_data->>'levels'),''),
      nullif(btrim(s.normalized_data->'building'->>'levels'),''),
      nullif(btrim(s.normalized_data->'tags'->>'building:levels'),'')
    ) ~ '^[0-9]+$'
    THEN coalesce(
      nullif(btrim(s.normalized_data->>'levels'),''),
      nullif(btrim(s.normalized_data->'building'->>'levels'),''),
      nullif(btrim(s.normalized_data->'tags'->>'building:levels'),'')
    )::integer
    ELSE NULL
  END AS levels,
  CASE
    WHEN coalesce(
      nullif(btrim(s.normalized_data->>'height_m'),''),
      nullif(btrim(s.normalized_data->'building'->>'height_m'),''),
      nullif(btrim(s.normalized_data->'tags'->>'height'),'')
    ) ~ '^[0-9]+(\.[0-9]+)?$'
    THEN coalesce(
      nullif(btrim(s.normalized_data->>'height_m'),''),
      nullif(btrim(s.normalized_data->'building'->>'height_m'),''),
      nullif(btrim(s.normalized_data->'tags'->>'height'),'')
    )::numeric
    ELSE NULL
  END AS height_m,
  least(100,greatest(0,coalesce(s.confidence_score,80))) AS confidence_score,
  s.source_refs || jsonb_build_object(
    'external_id', system.pipeline_osm_identity_key(s.external_id),
    'source_snapshot_id_local', s.source_snapshot_id,
    'import_class', s.import_class
  ) AS source_refs,
  s.normalized_data || jsonb_build_object(
    'class_code', s.class_code,
    'canonical_name', s.canonical_name,
    'eligible_for_core', s.eligible_for_core,
    'core_selection_reason', s.core_selection_reason
  ) AS normalized_data
FROM :"staging_schema".staging_building_candidates s
JOIN direct_export_context x ON x.source_snapshot_id = s.source_snapshot_id
WHERE s.import_class IN ('safe_new','safe_update')
ORDER BY s.id;

SELECT 1/CASE WHEN EXISTS(
  SELECT 1 FROM direct_buildings_export WHERE building_type_id IS NULL
) THEN 0 ELSE 1 END AS building_types_resolved;
SELECT 1/CASE WHEN (
  SELECT count(*) FROM direct_buildings_export
) = (
  SELECT count(*) FROM :"staging_schema".staging_building_candidates s, direct_export_context x
  WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class IN ('safe_new','safe_update')
) THEN 1 ELSE 0 END AS export_count_matches_source;

\o :output_path
COPY direct_buildings_export TO STDOUT WITH (FORMAT csv, HEADER true);
\o

CREATE TEMP TABLE direct_buildings_invalid_export AS
SELECT 'buildings'::text AS entity_family,s.id AS local_staging_id,s.external_id,s.import_class,
  s.validation_status,coalesce(s.import_class_reason,'{}'::jsonb) AS rejection_reason,
  s.source_refs,s.normalized_data
FROM :"staging_schema".staging_building_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id AND s.import_class='invalid'
ORDER BY s.id;
\o :rejection_path
COPY direct_buildings_invalid_export TO STDOUT WITH (FORMAT csv, HEADER true);
\o

SELECT import_class,count(*) n
FROM :"staging_schema".staging_building_candidates s,direct_export_context x
WHERE s.source_snapshot_id=x.source_snapshot_id
GROUP BY import_class ORDER BY import_class;
SELECT count(*) AS exported_safe_rows FROM direct_buildings_export;
SELECT classification, count(*) FROM direct_buildings_export GROUP BY 1 ORDER BY 1;
