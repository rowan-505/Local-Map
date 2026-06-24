-- =============================================================================
-- transport-fast-publish — step 13: upsert local route metadata into transport.*
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route publish session,
-- AFTER:
--   * step 10 set :import_batch_id (a fresh batch for this route publish)
--   * _session_temp_tables_routes.sql created the _pub_* session temp tables
--   * the runner \copy-loaded the exported local rows into the _pub_* tables
--
-- Identity is transport.source_links (entity_type, source_name, source_kind,
-- external_id). Existing entities are UPDATED (respecting review_status
-- protection); new entities are INSERTED then linked. Rows missing from the
-- latest OSM are never deleted. NO route paths / route stops are created here.
--
-- Requires migration 100 (partial unique index
-- transport_source_links_unique_source_entity) on Supabase for the source_links
-- ON CONFLICT upsert.
--
-- Protection by target review_status:
--   manual_protected                 -> content not overwritten at all
--   verified / reviewed              -> only source_refs + normalized_data updated
--   imported_unreviewed/needs_review -> content + source_refs + normalized_data updated
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

-- =============================================================================
-- 1) ROUTES
-- =============================================================================
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route', p.external_id, sl.entity_id, false
FROM _pub_routes p
JOIN transport.source_links sl
  ON sl.entity_type = 'route'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

UPDATE transport.routes r SET
    route_code       = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.route_code ELSE r.route_code END,
    public_name      = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.public_name ELSE r.public_name END,
    mode             = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.mode ELSE r.mode END,
    route_kind       = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.route_kind ELSE r.route_kind END,
    origin_name      = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.origin_name ELSE r.origin_name END,
    destination_name = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.destination_name ELSE r.destination_name END,
    description      = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.description ELSE r.description END,
    confidence_score = CASE WHEN r.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE r.confidence_score END,
    source_refs      = p.source_refs,
    normalized_data  = p.normalized_data
FROM _pub_routes p
JOIN _idmap m ON m.entity_type = 'route' AND m.external_id = p.external_id AND m.is_new = false
WHERE r.id = m.entity_id
  AND r.review_status <> 'manual_protected';

CREATE TEMP TABLE _new_routes ON COMMIT DROP AS
SELECT p.*, gen_random_uuid() AS pub
FROM _pub_routes p
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'route' AND m.external_id = p.external_id);

INSERT INTO transport.routes (
    public_id, route_code, public_name, mode, route_kind, origin_name, destination_name,
    description, source_refs, normalized_data, confidence_score, review_status
)
SELECT pub, route_code, public_name, mode, route_kind, origin_name, destination_name,
       description, source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _new_routes;

INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route', n.external_id, r.id, true
FROM _new_routes n
JOIN transport.routes r ON r.public_id = n.pub;

-- =============================================================================
-- 2) ROUTE_NAMES (add my/en/und if present; NOT EXISTS avoids duplicates)
-- =============================================================================
INSERT INTO transport.route_names (
    route_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT m.entity_id, prn.name, prn.language_code, prn.script_code,
       prn.name_type, prn.is_primary, prn.search_weight
FROM _pub_route_names prn
JOIN _idmap m ON m.entity_type = 'route' AND m.external_id = prn.route_external_id
WHERE prn.name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM transport.route_names rn
      WHERE rn.route_id = m.entity_id
        AND rn.name = prn.name
        AND rn.language_code = prn.language_code
  );

-- =============================================================================
-- 3) ROUTE_VARIANTS (route_id resolved from the route source link via _idmap)
-- =============================================================================
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route_variant', p.external_id, sl.entity_id, false
FROM _pub_route_variants p
JOIN transport.source_links sl
  ON sl.entity_type = 'route_variant'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

UPDATE transport.route_variants v SET
    route_id               = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review')
                                  THEN coalesce((SELECT m2.entity_id FROM _idmap m2 WHERE m2.entity_type = 'route' AND m2.external_id = p.route_external_id), v.route_id)
                                  ELSE v.route_id END,
    variant_code           = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.variant_code ELSE v.variant_code END,
    direction_name         = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.direction_name ELSE v.direction_name END,
    direction_id           = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.direction_id ELSE v.direction_id END,
    headsign               = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.headsign ELSE v.headsign END,
    origin_name            = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.origin_name ELSE v.origin_name END,
    destination_name       = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.destination_name ELSE v.destination_name END,
    distance_m             = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.distance_m ELSE v.distance_m END,
    estimated_duration_min = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.estimated_duration_min ELSE v.estimated_duration_min END,
    confidence_score       = CASE WHEN v.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE v.confidence_score END,
    source_refs            = p.source_refs,
    normalized_data        = p.normalized_data
FROM _pub_route_variants p
JOIN _idmap m ON m.entity_type = 'route_variant' AND m.external_id = p.external_id AND m.is_new = false
WHERE v.id = m.entity_id
  AND v.review_status <> 'manual_protected';

-- Only insert variants whose parent route resolved (avoids orphan/NULL route_id).
CREATE TEMP TABLE _new_variants ON COMMIT DROP AS
SELECT p.*,
       gen_random_uuid() AS pub,
       (SELECT m2.entity_id FROM _idmap m2 WHERE m2.entity_type = 'route' AND m2.external_id = p.route_external_id) AS route_id
FROM _pub_route_variants p
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'route_variant' AND m.external_id = p.external_id);

INSERT INTO transport.route_variants (
    public_id, route_id, variant_code, direction_name, direction_id, headsign,
    origin_name, destination_name, distance_m, estimated_duration_min,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT pub, route_id, variant_code, direction_name, direction_id, headsign,
       origin_name, destination_name, distance_m, estimated_duration_min,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _new_variants
WHERE route_id IS NOT NULL;

INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'route_variant', n.external_id, v.id, true
FROM _new_variants n
JOIN transport.route_variants v ON v.public_id = n.pub;

-- =============================================================================
-- 4) SOURCE_LINKS (route + route_variant identity rows; entity_id via _idmap)
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
-- 5) IMPORT_ERRORS (audit rows + WARN_* warnings, tagged to this batch)
-- =============================================================================
INSERT INTO transport.import_errors (
    import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
)
SELECT :import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
FROM _pub_import_errors;

-- =============================================================================
-- 6) Batch counts
-- =============================================================================
UPDATE transport.import_batches b SET
    inserted_count = (SELECT count(*) FROM _idmap WHERE is_new),
    updated_count  = (SELECT count(*) FROM _idmap WHERE NOT is_new),
    error_count    = (SELECT count(*) FROM _pub_import_errors WHERE error_code NOT LIKE 'WARN_%'),
    skipped_count  = (SELECT count(*) FROM _pub_import_errors WHERE error_code LIKE 'WARN_%')
WHERE b.id = :import_batch_id;

COMMIT;

\echo '>>> step 13 route publish complete for import_batch_id =' :import_batch_id
