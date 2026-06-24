-- =============================================================================
-- transport-fast-publish — step 15: upsert local route paths into transport.*
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route-path publish
-- session, AFTER:
--   * step 10 set :import_batch_id (a fresh batch for this route-path publish)
--   * _session_temp_tables_route_paths.sql created the _pub_* session temp tables
--   * the runner \copy-loaded the exported local rows into the _pub_* tables
--   * route metadata (routes + variants + their source_links) was already
--     published in an earlier session, so route_variant source_links exist.
--
-- Identity is transport.source_links (entity_type='route_path', source_name,
-- source_kind='osm_relation', external_id='osm:R:<id>:path'). The owning
-- route_variant is resolved through its source_links
-- (entity_type='route_variant', external_id='osm:R:<id>:variant:default').
-- A path whose variant cannot be resolved is skipped (never orphaned).
-- Rows missing from the latest OSM are never deleted.
--
-- Requires migration 100 (partial unique index
-- transport_source_links_unique_source_entity) on Supabase.
--
-- Protection by target route_path.review_status:
--   manual_protected                 -> content not overwritten at all
--   verified / reviewed              -> only source_refs + normalized_data updated
--   imported_unreviewed/needs_review -> geom/path_kind/distance/variant + refs updated
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?import_batch_id}
\else
  \echo '!!! import_batch_id is not set; run 10_create_supabase_import_batch.sql first'
  \set import_batch_id 0
\endif

BEGIN;

-- external_id -> resolved transport entity id, with is_new flag for counts.
CREATE TEMP TABLE _idmap (
    entity_type text,
    external_id text,
    entity_id   bigint,
    is_new      boolean
) ON COMMIT DROP;

-- route_variant external_id -> transport.route_variants.id (via its source link).
CREATE TEMP TABLE _variant_map ON COMMIT DROP AS
SELECT DISTINCT p.route_variant_external_id AS variant_external_id, sl.entity_id AS variant_id
FROM _pub_route_paths p
JOIN transport.source_links sl
  ON sl.entity_type = 'route_variant'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.route_variant_external_id;

-- =============================================================================
-- 1) ROUTE_PATHS
-- =============================================================================
-- Map already-linked paths.
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route_path', p.external_id, sl.entity_id, false
FROM _pub_route_paths p
JOIN transport.source_links sl
  ON sl.entity_type = 'route_path'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

-- Update existing paths (protection-aware; manual_protected untouched).
UPDATE transport.route_paths rp SET
    route_variant_id = CASE WHEN rp.review_status IN ('imported_unreviewed','needs_review')
                            THEN coalesce((SELECT vm.variant_id FROM _variant_map vm WHERE vm.variant_external_id = p.route_variant_external_id), rp.route_variant_id)
                            ELSE rp.route_variant_id END,
    path_kind        = CASE WHEN rp.review_status IN ('imported_unreviewed','needs_review') THEN p.path_kind ELSE rp.path_kind END,
    geom             = CASE WHEN rp.review_status IN ('imported_unreviewed','needs_review') THEN p.geom_hex::geometry ELSE rp.geom END,
    distance_m       = CASE WHEN rp.review_status IN ('imported_unreviewed','needs_review') THEN p.distance_m ELSE rp.distance_m END,
    confidence_score = CASE WHEN rp.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE rp.confidence_score END,
    source_refs      = p.source_refs,
    normalized_data  = p.normalized_data
FROM _pub_route_paths p
JOIN _idmap m ON m.entity_type = 'route_path' AND m.external_id = p.external_id AND m.is_new = false
WHERE rp.id = m.entity_id
  AND rp.review_status <> 'manual_protected';

-- Insert new paths whose owning route_variant resolved. route_paths has no
-- public_id, so map new ids back via the (unique-per-batch) route_variant_id.
CREATE TEMP TABLE _new_paths ON COMMIT DROP AS
SELECT p.*, vm.variant_id AS route_variant_id
FROM _pub_route_paths p
JOIN _variant_map vm ON vm.variant_external_id = p.route_variant_external_id
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'route_path' AND m.external_id = p.external_id);

WITH ins AS (
    INSERT INTO transport.route_paths (
        route_variant_id, path_kind, geom, distance_m,
        source_refs, normalized_data, confidence_score, review_status
    )
    SELECT route_variant_id, path_kind, geom_hex::geometry, distance_m,
           source_refs, normalized_data, confidence_score, 'imported_unreviewed'
    FROM _new_paths
    RETURNING id, route_variant_id
)
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route_path', np.external_id, ins.id, true
FROM ins
JOIN _new_paths np ON np.route_variant_id = ins.route_variant_id;

-- =============================================================================
-- 2) SOURCE_LINKS (route_path identity rows; entity_id resolved via _idmap)
-- =============================================================================
INSERT INTO transport.source_links (
    entity_type, entity_id, source_name, source_kind, external_id,
    source_url, source_payload, import_batch_id, confidence_score, is_primary
)
SELECT psl.entity_type, m.entity_id, psl.source_name, psl.source_kind, psl.external_id,
       psl.source_url, psl.source_payload, :import_batch_id, psl.confidence_score,
       coalesce(psl.is_primary, true)
FROM _pub_source_links psl
JOIN _idmap m ON m.entity_type = psl.entity_type AND m.external_id = psl.entity_external_id
WHERE psl.external_id IS NOT NULL
ON CONFLICT (entity_type, source_name, source_kind, external_id) WHERE external_id IS NOT NULL
DO UPDATE SET
    entity_id        = EXCLUDED.entity_id,
    source_url       = EXCLUDED.source_url,
    source_payload   = EXCLUDED.source_payload,
    import_batch_id  = EXCLUDED.import_batch_id,
    confidence_score = EXCLUDED.confidence_score,
    is_primary       = EXCLUDED.is_primary;

-- =============================================================================
-- 3) IMPORT_ERRORS (skip/warning audit rows, tagged to this batch)
-- =============================================================================
INSERT INTO transport.import_errors (
    import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
)
SELECT :import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
FROM _pub_import_errors;

-- =============================================================================
-- 4) Batch counts
-- =============================================================================
UPDATE transport.import_batches b SET
    inserted_count = (SELECT count(*) FROM _idmap WHERE is_new),
    updated_count  = (SELECT count(*) FROM _idmap WHERE NOT is_new),
    error_count    = (SELECT count(*) FROM _pub_import_errors WHERE error_code NOT LIKE 'WARN_%'),
    skipped_count  = (SELECT count(*) FROM _pub_import_errors WHERE error_code LIKE 'WARN_%')
WHERE b.id = :import_batch_id;

COMMIT;

\echo '>>> step 15 route path publish complete for import_batch_id =' :import_batch_id
