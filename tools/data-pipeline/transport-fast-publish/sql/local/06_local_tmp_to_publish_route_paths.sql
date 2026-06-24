-- =============================================================================
-- transport-fast-publish — Phase 8: best-effort local route path build (LOCAL ONLY)
--
-- Reads:
--   tmp_transport_import.osm_transport_relations         (relation_type='route')
--   tmp_transport_import.osm_transport_relation_members  (ordered way members)
--   tmp_transport_import.osm_transport_lines             (member way geometry,
--                                                         incl. route_member_way)
--
-- Writes clean, export-ready rows into the local-only buffer:
--   local_transport_publish.route_paths    (one LineString path per relation)
--   local_transport_publish.source_links   (entity_type='route_path')
--   local_transport_publish.import_errors  (skip/warning audit rows)
--
-- Strategy: for each route relation, order its way members and merge their
-- geometry with PostGIS (ST_LineMerge over ST_Collect). Only a single clean
-- LineString is published. If the merge yields a MultiLineString (the line is
-- broken/branching), the path is SKIPPED and logged as
-- ROUTE_PATH_NOT_SINGLE_LINESTRING — this never fails the import. NEVER writes
-- to Supabase. Route_master relations carry no way members and are ignored here.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, pbf_sha256, snapshot_version, import_batch_key, import_route_paths
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif
\if :{?pbf_sha256}
\else
  \set pbf_sha256 'unknown'
\endif
\if :{?snapshot_version}
\else
  \set snapshot_version 'unknown'
\endif
\if :{?import_batch_key}
\else
  \set import_batch_key 'openstreetmap:osm_pbf:unknown'
\endif
\if :{?import_route_paths}
\else
  \set import_route_paths true
\endif

\if :import_route_paths

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotent cleanup: scoped to the entities this stage owns.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.route_paths  WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.source_links  WHERE entity_type = 'route_path';
DELETE FROM local_transport_publish.import_errors
 WHERE entity_type = 'route_path'
   AND error_code IN ('ROUTE_PATH_NOT_SINGLE_LINESTRING', 'WARN_RELATION_NO_WAY_MEMBERS', 'WARN_ROUTE_PATH_UNMERGEABLE');

-- -----------------------------------------------------------------------------
-- Build one merged geometry per route relation from its ordered way members.
-- (Session-scoped, not ON COMMIT DROP, so the post-COMMIT report can read it.)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS _paths;
CREATE TEMP TABLE _paths AS
WITH rels AS (
    SELECT external_id, osm_id, tags
    FROM tmp_transport_import.osm_transport_relations
    WHERE relation_type = 'route'
),
way_members AS (
    SELECT m.relation_external_id, m.member_sequence, m.member_external_id
    FROM tmp_transport_import.osm_transport_relation_members m
    WHERE m.member_type = 'way'
),
member_counts AS (
    SELECT relation_external_id, count(*) AS way_member_count
    FROM way_members
    GROUP BY relation_external_id
),
merged AS (
    SELECT
        wm.relation_external_id,
        count(l.geom)                                                       AS geom_member_count,
        ST_LineMerge(ST_Collect(l.geom ORDER BY wm.member_sequence))        AS merged_geom
    FROM way_members wm
    JOIN tmp_transport_import.osm_transport_lines l
      ON l.external_id = wm.member_external_id
    GROUP BY wm.relation_external_id
)
SELECT
    r.external_id                                   AS relation_external_id,
    r.osm_id                                        AS relation_osm_id,
    r.tags                                          AS tags,
    coalesce(mc.way_member_count, 0)                AS way_member_count,
    coalesce(mg.geom_member_count, 0)               AS geom_member_count,
    CASE WHEN mg.merged_geom IS NOT NULL
         THEN ST_SetSRID(ST_Force2D(mg.merged_geom), 4326) END AS merged_geom,
    CASE
        WHEN coalesce(mc.way_member_count, 0) = 0 THEN 'no_way_members'
        WHEN mg.merged_geom IS NULL OR ST_IsEmpty(mg.merged_geom)
             OR coalesce(mg.geom_member_count, 0) = 0 THEN 'unmergeable'
        WHEN ST_GeometryType(mg.merged_geom) = 'ST_LineString' THEN 'ok'
        ELSE 'multilinestring'
    END                                             AS outcome
FROM rels r
LEFT JOIN member_counts mc ON mc.relation_external_id = r.external_id
LEFT JOIN merged       mg ON mg.relation_external_id = r.external_id;

-- -----------------------------------------------------------------------------
-- ROUTE_PATHS: only clean single LineStrings are published.
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_paths (
    external_id, route_variant_external_id, source_kind, source_name, import_batch_key,
    path_kind, distance_m, source_refs, normalized_data, confidence_score, review_status, geom
)
SELECT
    relation_external_id || ':path',
    relation_external_id || ':variant:default',
    'osm_relation', :'source_name', :'import_batch_key',
    'osm_relation',
    ST_Length(merged_geom::geography),
    jsonb_build_object(
        'osm_id', relation_osm_id,
        'external_id', relation_external_id || ':path',
        'relation_external_id', relation_external_id,
        'way_member_count', way_member_count,
        'merged_way_count', geom_member_count,
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ),
    jsonb_build_object(
        'path_kind', 'osm_relation',
        'geometry_type', 'LineString',
        'source', 'osm',
        'source_name', :'source_name',
        'source_kind', 'osm_relation',
        'import_batch_key', :'import_batch_key'
    ),
    60, 'imported_unreviewed',
    merged_geom
FROM _paths
WHERE outcome = 'ok';

-- -----------------------------------------------------------------------------
-- SOURCE_LINKS (one per published route_path).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    relation_external_id || ':path', 'route_path', relation_external_id || ':path',
    'osm_relation', :'source_name', :'import_batch_key',
    'https://www.openstreetmap.org/relation/' || relation_osm_id,
    jsonb_build_object(
        'relation_external_id', relation_external_id,
        'way_member_count', way_member_count,
        'merged_way_count', geom_member_count
    ),
    true,
    jsonb_build_object(
        'osm_id', relation_osm_id,
        'external_id', relation_external_id || ':path',
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ),
    jsonb_build_object(
        'path_kind', 'osm_relation',
        'source_name', :'source_name',
        'source_kind', 'osm_relation',
        'import_batch_key', :'import_batch_key'
    ),
    60, 'imported_unreviewed'
FROM _paths
WHERE outcome = 'ok';

-- -----------------------------------------------------------------------------
-- IMPORT_ERRORS: log skips/warnings (best-effort; never blocks the import).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.import_errors (
    external_id, entity_type, source_kind, source_name, import_batch_key,
    error_code, error_message, raw_payload, confidence_score, review_status
)
SELECT
    relation_external_id || ':path', 'route_path', 'osm_relation', :'source_name', :'import_batch_key',
    CASE outcome
        WHEN 'multilinestring' THEN 'ROUTE_PATH_NOT_SINGLE_LINESTRING'
        WHEN 'no_way_members'  THEN 'WARN_RELATION_NO_WAY_MEMBERS'
        ELSE                        'WARN_ROUTE_PATH_UNMERGEABLE'
    END,
    CASE outcome
        WHEN 'multilinestring' THEN 'route path skipped: merged geometry is MultiLineString (not a single LineString)'
        WHEN 'no_way_members'  THEN 'route relation has no way members; no path produced'
        ELSE                        'route relation path could not be merged from available member geometry'
    END,
    jsonb_build_object(
        'relation_external_id', relation_external_id,
        'osm_id', relation_osm_id,
        'way_member_count', way_member_count,
        'merged_way_count', geom_member_count,
        'outcome', outcome
    ),
    60, 'imported_unreviewed'
FROM _paths
WHERE outcome <> 'ok';

COMMIT;

-- -----------------------------------------------------------------------------
-- Report.
-- -----------------------------------------------------------------------------
SELECT 'route_paths_published'        AS metric, count(*) AS value FROM local_transport_publish.route_paths WHERE source_name = :'source_name'
UNION ALL
SELECT 'skipped_multilinestring',     count(*) FROM _paths WHERE outcome = 'multilinestring'
UNION ALL
SELECT 'warn_no_way_members',         count(*) FROM _paths WHERE outcome = 'no_way_members'
UNION ALL
SELECT 'warn_unmergeable',            count(*) FROM _paths WHERE outcome = 'unmergeable'
ORDER BY metric;

\else
\echo '>>> 06 skipped: import_route_paths is not true (route path import disabled)'
\endif
