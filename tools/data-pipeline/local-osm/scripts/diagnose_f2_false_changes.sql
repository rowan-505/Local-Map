-- Diagnostic: field-level F2 false-change analysis for Kyauktan sample.
-- Local only. No Supabase writes.
\set ON_ERROR_STOP on
\pset pager off

\ir ../pipeline_source_identity.sql
\ir ../pipeline_f2_stable_compare.sql

\if :{?snapshot_id}
\else
\set snapshot_id 4
\endif

SELECT 'roads_sample_stable_diffs' AS section;
WITH sample AS (
    SELECT s.external_id,
           system.pipeline_f2_roads_staging_payload(
               s.canonical_name,
               coalesce(s.class_code, s.normalized_data->'tags'->>'highway'),
               s.road_class_id,
               s.geom,
               NULL,
               s.is_oneway,
               s.normalized_data->'tags'->>'surface',
               s.normalized_data->'tags'->>'bridge',
               s.normalized_data->'tags'->>'tunnel',
               s.normalized_data->'tags'->>'layer',
               false
           ) AS s_payload,
           system.pipeline_f2_roads_prod_payload(
               p.canonical_name,
               p.road_class,
               p.road_class_id,
               p.geom,
               p.admin_area_id,
               NULL, NULL, NULL, NULL, NULL,
               p.deleted_at,
               false,
               false
           ) AS p_payload
    FROM staging.staging_road_candidates AS s
    JOIN prod_mirror.core_streets AS p
      ON system.pipeline_osm_identity_key(p.external_id)
       = system.pipeline_osm_identity_key(s.external_id)
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND s.import_class = 'safe_update'
    ORDER BY s.id
    LIMIT 20
)
SELECT
    external_id,
    system.pipeline_f2_roads_changed(s_payload, p_payload) AS still_changed,
    system.pipeline_f2_payload_field_diffs(s_payload, p_payload) AS field_diffs
FROM sample;

SELECT 'places_sample_stable_diffs' AS section;
WITH sample AS (
    SELECT s.external_id,
           system.pipeline_f2_places_staging_payload(
               s.canonical_name, s.poi_category_id, s.point_geom, NULL
           ) AS s_payload,
           system.pipeline_f2_places_prod_payload(
               p.primary_name, p.display_name, p.category_id, p.point_geom,
               p.admin_area_id, p.deleted_at,
               (s.poi_category_id IS NOT NULL),
               false
           ) AS p_payload
    FROM staging.staging_place_candidates AS s
    JOIN prod_mirror.core_places AS p
      ON system.pipeline_osm_identity_key(p.external_id)
       = system.pipeline_osm_identity_key(s.external_id)
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND s.import_class = 'safe_update'
    ORDER BY s.id
    LIMIT 20
)
SELECT
    external_id,
    system.pipeline_f2_places_changed(s_payload, p_payload) AS still_changed,
    system.pipeline_f2_payload_field_diffs(s_payload, p_payload) AS field_diffs
FROM sample;

SELECT 'roads_aggregate_preview' AS section,
       count(*) AS matched,
       count(*) FILTER (
           WHERE system.pipeline_f2_roads_changed(
               system.pipeline_f2_roads_staging_payload(
                   s.canonical_name,
                   coalesce(s.class_code, s.normalized_data->'tags'->>'highway'),
                   s.road_class_id, s.geom, NULL, s.is_oneway,
                   NULL, NULL, NULL, NULL, false
               ),
               system.pipeline_f2_roads_prod_payload(
                   p.canonical_name, p.road_class, p.road_class_id, p.geom,
                   p.admin_area_id, NULL, NULL, NULL, NULL, NULL, p.deleted_at, false, false
               )
           )
       ) AS would_change,
       count(*) FILTER (
           WHERE NOT system.pipeline_f2_roads_changed(
               system.pipeline_f2_roads_staging_payload(
                   s.canonical_name,
                   coalesce(s.class_code, s.normalized_data->'tags'->>'highway'),
                   s.road_class_id, s.geom, NULL, s.is_oneway,
                   NULL, NULL, NULL, NULL, false
               ),
               system.pipeline_f2_roads_prod_payload(
                   p.canonical_name, p.road_class, p.road_class_id, p.geom,
                   p.admin_area_id, NULL, NULL, NULL, NULL, NULL, p.deleted_at, false, false
               )
           )
       ) AS would_unchanged
FROM staging.staging_road_candidates AS s
JOIN prod_mirror.core_streets AS p
  ON system.pipeline_osm_identity_key(p.external_id)
   = system.pipeline_osm_identity_key(s.external_id)
WHERE s.source_snapshot_id = :'snapshot_id'::bigint;
