-- =============================================================================
-- transport-fast-publish — step 17: upsert local route stops into transport.*
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route-stop publish
-- session, AFTER:
--   * step 10 set :import_batch_id (a fresh batch for this route-stop publish)
--   * _session_temp_tables_route_stops.sql created the _pub_* session temp tables
--   * the runner \copy-loaded the exported local rows into the _pub_* tables
--   * route metadata (variants + their source_links) and stops (+ source_links)
--     were already published, so both can be resolved here.
--
-- transport.route_stops has no source_links and no public_id; identity is
-- (route_variant_id, stop_sequence). Idempotency + clean re-sequencing are
-- achieved by replacing this source's stops per non-protected variant:
--   delete OSM-origin route_stops for the variant, then insert the fresh dense
--   sequence. Variants are resolved through route_variant source_links and stops
--   through stop source_links; rows that cannot resolve both are skipped.
--
-- Protection: a route_variant with review_status='manual_protected' keeps its
-- route_stops untouched (no delete, no insert).
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?import_batch_id}
\else
  \echo '!!! import_batch_id is not set; run 10_create_supabase_import_batch.sql first'
  \set import_batch_id 0
\endif

BEGIN;

-- route_variant external_id -> variant id + parent review_status (for protection).
CREATE TEMP TABLE _variant_map ON COMMIT DROP AS
SELECT DISTINCT p.route_variant_external_id AS variant_external_id,
       sl.entity_id AS variant_id,
       v.review_status AS variant_review_status
FROM _pub_route_stops p
JOIN transport.source_links sl
  ON sl.entity_type = 'route_variant'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.route_variant_external_id
JOIN transport.route_variants v ON v.id = sl.entity_id;

-- stop external_id -> stop id (via stop source_links).
CREATE TEMP TABLE _stop_map ON COMMIT DROP AS
SELECT DISTINCT p.stop_external_id AS stop_external_id, sl.entity_id AS stop_id
FROM _pub_route_stops p
JOIN transport.source_links sl
  ON sl.entity_type = 'stop'
 AND sl.source_name = p.source_name
 AND sl.external_id = p.stop_external_id;

-- Rows ready to land: variant + stop both resolved, parent not manual_protected.
CREATE TEMP TABLE _ins ON COMMIT DROP AS
SELECT
    vm.variant_id                                AS route_variant_id,
    sm.stop_id                                   AS stop_id,
    p.stop_sequence,
    p.pickup_type,
    p.drop_off_type,
    p.source_refs,
    p.normalized_data
FROM _pub_route_stops p
JOIN _variant_map vm ON vm.variant_external_id = p.route_variant_external_id
JOIN _stop_map    sm ON sm.stop_external_id   = p.stop_external_id
WHERE vm.variant_review_status <> 'manual_protected';

-- =============================================================================
-- 1) Replace OSM-origin route_stops for the (non-protected) target variants.
-- =============================================================================
DELETE FROM transport.route_stops rs
USING _variant_map vm
WHERE rs.route_variant_id = vm.variant_id
  AND vm.variant_review_status <> 'manual_protected'
  AND rs.normalized_data->>'source' = 'osm';

INSERT INTO transport.route_stops (
    route_variant_id, stop_id, stop_sequence, pickup_type, drop_off_type,
    source_refs, normalized_data
)
SELECT route_variant_id, stop_id, stop_sequence, pickup_type, drop_off_type,
       source_refs, normalized_data
FROM _ins;

-- =============================================================================
-- 2) IMPORT_ERRORS (unmatched stop members, tagged to this batch)
-- =============================================================================
INSERT INTO transport.import_errors (
    import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
)
SELECT :import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
FROM _pub_import_errors;

-- =============================================================================
-- 3) Batch counts
-- =============================================================================
UPDATE transport.import_batches b SET
    inserted_count = (SELECT count(*) FROM _ins),
    updated_count  = 0,
    error_count    = (SELECT count(*) FROM _pub_import_errors WHERE error_code NOT LIKE 'WARN_%'),
    skipped_count  = (SELECT count(*) FROM _pub_route_stops) - (SELECT count(*) FROM _ins)
WHERE b.id = :import_batch_id;

COMMIT;

\echo '>>> step 17 route stop publish complete for import_batch_id =' :import_batch_id
