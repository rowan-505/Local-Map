-- =============================================================================
-- transport-fast-publish — Phase 9: best-effort local route stop sequence (LOCAL ONLY)
--
-- Reads:
--   tmp_transport_import.osm_transport_relations         (relation_type='route')
--   tmp_transport_import.osm_transport_relation_members  (ordered members + role)
--   local_transport_publish.stops                        (already-normalized stops)
--
-- Writes clean, export-ready rows into the local-only buffer:
--   local_transport_publish.route_stops    (dense stop sequence per variant)
--   local_transport_publish.import_errors  (ROUTE_STOP_MEMBER_NOT_IMPORTED warnings)
--
-- Strategy: walk each route relation's members in order, keep only members with a
-- stop-like role that match an already-published local stop (by external_id), and
-- assign a DENSE stop_sequence (1..N) over the matched members only. Unmatched
-- stop-role members are skipped and logged (never fail the import). Pickup/drop-off
-- come from entry_only / exit_only role variants. NEVER writes to Supabase.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, pbf_sha256, snapshot_version, import_batch_key, import_route_stops
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
\if :{?import_route_stops}
\else
  \set import_route_stops true
\endif

\if :import_route_stops

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotent cleanup: scoped to the entities this stage owns.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.route_stops   WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.import_errors
 WHERE entity_type = 'route_stop' AND error_code = 'ROUTE_STOP_MEMBER_NOT_IMPORTED';

-- -----------------------------------------------------------------------------
-- Stop-role members of route relations, with local-stop match flag.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS _stop_members;
CREATE TEMP TABLE _stop_members AS
SELECT
    m.relation_external_id,
    m.relation_osm_id,
    m.member_sequence,
    m.member_type,
    m.member_ref,
    m.member_external_id      AS stop_external_id,
    m.member_role,
    (s.external_id IS NOT NULL) AS matched
FROM tmp_transport_import.osm_transport_relation_members m
JOIN tmp_transport_import.osm_transport_relations r
  ON r.external_id = m.relation_external_id
 AND r.relation_type = 'route'
LEFT JOIN local_transport_publish.stops s
  ON s.external_id = m.member_external_id
 AND s.source_name = :'source_name'
WHERE m.member_type IN ('node', 'way')
  AND m.member_role IN (
      'stop', 'stop_entry_only', 'stop_exit_only',
      'platform', 'platform_entry_only', 'platform_exit_only',
      'station', 'halt'
  );

-- Dense 1..N sequence over MATCHED members only, preserving relation member order.
DROP TABLE IF EXISTS _matched;
CREATE TEMP TABLE _matched AS
SELECT
    sm.*,
    row_number() OVER (PARTITION BY sm.relation_external_id ORDER BY sm.member_sequence) AS stop_sequence,
    CASE
        WHEN sm.member_role IN ('stop_entry_only', 'platform_entry_only') THEN 'entry_only'
        WHEN sm.member_role IN ('stop_exit_only',  'platform_exit_only')  THEN 'exit_only'
        ELSE 'normal'
    END AS boarding_kind
FROM _stop_members sm
WHERE sm.matched;

-- -----------------------------------------------------------------------------
-- ROUTE_STOPS (one per matched member; dense per-variant sequence).
-- pickup/drop_off: normal=0/0, entry_only=0/1, exit_only=1/0.
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_stops (
    external_id, route_variant_external_id, stop_external_id,
    source_kind, source_name, import_batch_key,
    stop_sequence, pickup_type, drop_off_type,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    relation_external_id || ':stop:' || stop_sequence,
    relation_external_id || ':variant:default',
    stop_external_id,
    'osm_relation', :'source_name', :'import_batch_key',
    stop_sequence,
    CASE boarding_kind WHEN 'exit_only' THEN 1 ELSE 0 END,
    CASE boarding_kind WHEN 'entry_only' THEN 1 ELSE 0 END,
    jsonb_build_object(
        'relation_external_id', relation_external_id,
        'relation_osm_id', relation_osm_id,
        'member_ref', member_ref,
        'member_type', member_type,
        'original_role', member_role,
        'original_member_sequence', member_sequence,
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ),
    jsonb_build_object(
        'source', 'osm',
        'source_name', :'source_name',
        'source_kind', 'osm_relation',
        'import_batch_key', :'import_batch_key',
        'boarding_kind', boarding_kind,
        'original_role', member_role,
        'stop_external_id', stop_external_id
    ),
    60, 'imported_unreviewed'
FROM _matched;

-- -----------------------------------------------------------------------------
-- IMPORT_ERRORS: stop-role members that did not match a published stop.
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.import_errors (
    external_id, entity_type, source_kind, source_name, import_batch_key,
    error_code, error_message, raw_payload, confidence_score, review_status
)
SELECT
    stop_external_id, 'route_stop', 'osm_relation', :'source_name', :'import_batch_key',
    'ROUTE_STOP_MEMBER_NOT_IMPORTED',
    'route relation stop member did not match a published stop; skipped from stop sequence',
    jsonb_build_object(
        'relation_external_id', relation_external_id,
        'relation_osm_id', relation_osm_id,
        'member_ref', member_ref,
        'member_type', member_type,
        'original_role', member_role,
        'original_member_sequence', member_sequence,
        'stop_external_id', stop_external_id
    ),
    60, 'imported_unreviewed'
FROM _stop_members
WHERE NOT matched;

COMMIT;

-- -----------------------------------------------------------------------------
-- Report.
-- -----------------------------------------------------------------------------
SELECT 'route_stops_published'      AS metric, count(*) AS value FROM local_transport_publish.route_stops WHERE source_name = :'source_name'
UNION ALL
SELECT 'variants_with_stops',       count(DISTINCT route_variant_external_id) FROM local_transport_publish.route_stops WHERE source_name = :'source_name'
UNION ALL
SELECT 'unmatched_stop_members',    count(*) FROM _stop_members WHERE NOT matched
ORDER BY metric;

\else
\echo '>>> 07 skipped: import_route_stops is not true (route stop import disabled)'
\endif
