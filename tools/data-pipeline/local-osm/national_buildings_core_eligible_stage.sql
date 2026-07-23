-- National dry-run: stage only core-eligible buildings (named/important).
-- Avoids inserting ~5.55M PMTiles-only footprints.
-- Local only. Does not write Supabase.
\set ON_ERROR_STOP on
\i pipeline_core_pmtiles_selection.sql

\if :{?snapshot_version}
\else
\set snapshot_version 'osm_myanmar_2026_07_21_national_dry_run_v1'
\endif

CREATE TEMP TABLE national_buildings_dry_run_ctx AS
SELECT id AS source_snapshot_id, snapshot_version
FROM system.system_source_snapshots
WHERE snapshot_version = :'snapshot_version';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM national_buildings_dry_run_ctx) THEN
    RAISE EXCEPTION 'snapshot not found';
  END IF;
END $$;

DELETE FROM staging.staging_building_candidates b
USING national_buildings_dry_run_ctx c
WHERE b.source_snapshot_id = c.source_snapshot_id;

INSERT INTO staging.staging_building_candidates (
  source_snapshot_id,
  raw_id,
  external_id,
  geom,
  canonical_name,
  class_code,
  normalized_data,
  source_refs,
  validation_status,
  eligible_for_core,
  core_selection_reason,
  pmtiles_only_reason
)
SELECT
  c.source_snapshot_id,
  r.id,
  'osm:' || CASE lower(coalesce(r.osm_feature_type, 'way'))
      WHEN 'node' THEN 'N'
      WHEN 'relation' THEN 'R'
      ELSE 'W'
    END || ':' || r.osm_id::text,
  ST_Multi(ST_CollectionExtract(ST_MakeValid(r.geom), 3))::geometry(MultiPolygon, 4326),
  coalesce(
    nullif(btrim(r.tags->>'name'), ''),
    nullif(btrim(r.tags->>'name:en'), ''),
    nullif(btrim(r.tags->>'name:my'), '')
  ),
  lower(btrim(coalesce(nullif(r.tags->>'building', ''), 'yes'))),
  jsonb_build_object('tags', r.tags, 'dry_run_core_eligible_only', true),
  jsonb_build_object(
    'source_snapshot_id', c.source_snapshot_id,
    'raw_table', 'raw_osm_polygons',
    'raw_id', r.id,
    'osm_id', r.osm_id,
    'osm_feature_type', r.osm_feature_type
  ),
  'valid',
  true,
  sel.core_selection_reason,
  NULL
FROM raw.raw_osm_polygons r
CROSS JOIN national_buildings_dry_run_ctx c
CROSS JOIN LATERAL (
  SELECT system.pipeline_select_core_vs_pmtiles(
      'buildings',
      coalesce(
        nullif(btrim(r.tags->>'name'), ''),
        nullif(btrim(r.tags->>'name:en'), ''),
        nullif(btrim(r.tags->>'name:my'), '')
      ),
      lower(btrim(coalesce(nullif(r.tags->>'building', ''), 'yes'))),
      jsonb_build_object('tags', r.tags),
      false
    ) AS j
) s
CROSS JOIN LATERAL (
  SELECT
    (s.j->>'eligible_for_core')::boolean AS eligible_for_core,
    s.j->>'core_selection_reason' AS core_selection_reason
) sel
WHERE r.source_snapshot_id = c.source_snapshot_id
  AND r.tags ? 'building'
  AND r.geom IS NOT NULL
  AND sel.eligible_for_core
  AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(r.geom), 3));

SELECT count(*) AS staged_core_eligible_buildings
FROM staging.staging_building_candidates b
JOIN national_buildings_dry_run_ctx c ON c.source_snapshot_id = b.source_snapshot_id;
