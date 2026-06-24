-- =============================================================================
-- transport-fast-publish — Phase 5 / step 11: upsert local rows into transport.*
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the publish session, AFTER:
--   * step 10 set :import_batch_id
--   * _session_temp_tables.sql created the _pub_* session temp tables
--   * the runner \copy-loaded the exported local rows into the _pub_* tables
--
-- Identity is transport.source_links (entity_type, source_name, source_kind,
-- external_id). Existing entities are UPDATED (respecting review_status
-- protection); new entities are INSERTED then linked. Rows missing from the
-- latest OSM are never deleted.
--
-- Requires migration 100 (partial unique index
-- transport_source_links_unique_source_entity) to be applied on Supabase for
-- the source_links ON CONFLICT upsert.
--
-- Protection by target review_status:
--   manual_protected            -> content not overwritten at all
--   verified / reviewed         -> only source_refs + normalized_data updated
--   imported_unreviewed/needs_review -> name/type/geom/confidence/source_refs/normalized_data updated
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
-- 1) STOPS
-- =============================================================================
-- Map already-linked stops.
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'stop', p.external_id, sl.entity_id, false
FROM _pub_stops p
JOIN transport.source_links sl
  ON sl.entity_type = 'stop'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

-- Update existing stops (protection-aware; manual_protected untouched).
UPDATE transport.stops s SET
    name             = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.name ELSE s.name END,
    name_mm          = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.name_mm ELSE s.name_mm END,
    name_en          = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.name_en ELSE s.name_en END,
    stop_code        = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.stop_code ELSE s.stop_code END,
    mode             = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.mode ELSE s.mode END,
    stop_type        = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.stop_type ELSE s.stop_type END,
    geom             = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.geom_hex::geometry ELSE s.geom END,
    confidence_score = CASE WHEN s.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE s.confidence_score END,
    source_refs      = p.source_refs,
    normalized_data  = p.normalized_data
FROM _pub_stops p
JOIN _idmap m ON m.entity_type = 'stop' AND m.external_id = p.external_id AND m.is_new = false
WHERE s.id = m.entity_id
  AND s.review_status <> 'manual_protected';

-- Insert new stops (explicit public_id lets us map back to the new id).
CREATE TEMP TABLE _new_stops ON COMMIT DROP AS
SELECT p.*, gen_random_uuid() AS pub
FROM _pub_stops p
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'stop' AND m.external_id = p.external_id);

INSERT INTO transport.stops (
    public_id, stop_code, name, name_mm, name_en, mode, stop_type, geom,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT pub, stop_code, name, name_mm, name_en, mode, stop_type, geom_hex::geometry,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _new_stops;

INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'stop', n.external_id, s.id, true
FROM _new_stops n
JOIN transport.stops s ON s.public_id = n.pub;

-- =============================================================================
-- 2) STOP_NAMES (add my/en/und if present; NOT EXISTS avoids duplicates)
-- =============================================================================
INSERT INTO transport.stop_names (
    stop_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT m.entity_id, psn.name, psn.language_code, psn.script_code,
       psn.name_type, psn.is_primary, psn.search_weight
FROM _pub_stop_names psn
JOIN _idmap m ON m.entity_type = 'stop' AND m.external_id = psn.stop_external_id
WHERE psn.name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM transport.stop_names sn
      WHERE sn.stop_id = m.entity_id
        AND sn.name = psn.name
        AND sn.language_code = psn.language_code
  );

-- =============================================================================
-- 3) TERMINALS (linked_stop_id resolved from the stop _idmap)
-- =============================================================================
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'terminal', p.external_id, sl.entity_id, false
FROM _pub_terminals p
JOIN transport.source_links sl
  ON sl.entity_type = 'terminal'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

UPDATE transport.terminals t SET
    name             = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.name ELSE t.name END,
    name_mm          = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.name_mm ELSE t.name_mm END,
    name_en          = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.name_en ELSE t.name_en END,
    terminal_code    = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.terminal_code ELSE t.terminal_code END,
    mode             = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.mode ELSE t.mode END,
    terminal_role    = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.terminal_role ELSE t.terminal_role END,
    linked_stop_id   = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review')
                            THEN (SELECT m2.entity_id FROM _idmap m2 WHERE m2.entity_type = 'stop' AND m2.external_id = p.linked_stop_external_id)
                            ELSE t.linked_stop_id END,
    geom             = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.geom_hex::geometry ELSE t.geom END,
    confidence_score = CASE WHEN t.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE t.confidence_score END,
    source_refs      = p.source_refs,
    normalized_data  = p.normalized_data
FROM _pub_terminals p
JOIN _idmap m ON m.entity_type = 'terminal' AND m.external_id = p.external_id AND m.is_new = false
WHERE t.id = m.entity_id
  AND t.review_status <> 'manual_protected';

CREATE TEMP TABLE _new_terminals ON COMMIT DROP AS
SELECT p.*, gen_random_uuid() AS pub
FROM _pub_terminals p
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'terminal' AND m.external_id = p.external_id);

INSERT INTO transport.terminals (
    public_id, linked_stop_id, terminal_code, name, name_mm, name_en, mode, terminal_role,
    geom, source_refs, normalized_data, confidence_score, review_status
)
SELECT n.pub,
       (SELECT m.entity_id FROM _idmap m WHERE m.entity_type = 'stop' AND m.external_id = n.linked_stop_external_id),
       n.terminal_code, n.name, n.name_mm, n.name_en, n.mode, n.terminal_role,
       n.geom_hex::geometry, n.source_refs, n.normalized_data, n.confidence_score, 'imported_unreviewed'
FROM _new_terminals n;

INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'terminal', n.external_id, t.id, true
FROM _new_terminals n
JOIN transport.terminals t ON t.public_id = n.pub;

-- =============================================================================
-- 4) INFRASTRUCTURE_LINES
-- =============================================================================
INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'infrastructure_line', p.external_id, sl.entity_id, false
FROM _pub_infrastructure_lines p
JOIN transport.source_links sl
  ON sl.entity_type = 'infrastructure_line'
 AND sl.source_name = p.source_name
 AND sl.source_kind = p.source_kind
 AND sl.external_id = p.external_id;

UPDATE transport.infrastructure_lines il SET
    name             = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.name ELSE il.name END,
    name_mm          = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.name_mm ELSE il.name_mm END,
    name_en          = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.name_en ELSE il.name_en END,
    mode             = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.mode ELSE il.mode END,
    line_type        = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.line_type ELSE il.line_type END,
    geom             = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.geom_hex::geometry ELSE il.geom END,
    confidence_score = CASE WHEN il.review_status IN ('imported_unreviewed','needs_review') THEN p.confidence_score ELSE il.confidence_score END,
    source_refs      = p.source_refs,
    normalized_data  = p.normalized_data
FROM _pub_infrastructure_lines p
JOIN _idmap m ON m.entity_type = 'infrastructure_line' AND m.external_id = p.external_id AND m.is_new = false
WHERE il.id = m.entity_id
  AND il.review_status <> 'manual_protected';

CREATE TEMP TABLE _new_lines ON COMMIT DROP AS
SELECT p.*, gen_random_uuid() AS pub
FROM _pub_infrastructure_lines p
WHERE NOT EXISTS (SELECT 1 FROM _idmap m WHERE m.entity_type = 'infrastructure_line' AND m.external_id = p.external_id);

INSERT INTO transport.infrastructure_lines (
    public_id, mode, line_type, name, name_mm, name_en, geom,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT pub, mode, line_type, name, name_mm, name_en, geom_hex::geometry,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _new_lines;

INSERT INTO _idmap (entity_type, external_id, entity_id, is_new)
SELECT 'infrastructure_line', n.external_id, il.id, true
FROM _new_lines n
JOIN transport.infrastructure_lines il ON il.public_id = n.pub;

-- =============================================================================
-- 5) SOURCE_LINKS (identity rows; entity_id resolved via _idmap)
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
    entity_id       = EXCLUDED.entity_id,
    source_url      = EXCLUDED.source_url,
    source_payload  = EXCLUDED.source_payload,
    import_batch_id = EXCLUDED.import_batch_id,
    confidence_score = EXCLUDED.confidence_score,
    is_primary      = EXCLUDED.is_primary;

-- =============================================================================
-- 6) IMPORT_ERRORS (audit rows + WARN_* warnings, tagged to this batch)
-- =============================================================================
INSERT INTO transport.import_errors (
    import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
)
SELECT :import_batch_id, entity_type, external_id, error_code, error_message, raw_payload
FROM _pub_import_errors;

-- =============================================================================
-- 7) Batch counts
-- =============================================================================
UPDATE transport.import_batches b SET
    inserted_count = (SELECT count(*) FROM _idmap WHERE is_new),
    updated_count  = (SELECT count(*) FROM _idmap WHERE NOT is_new),
    error_count    = (SELECT count(*) FROM _pub_import_errors WHERE error_code NOT LIKE 'WARN_%'),
    skipped_count  = (SELECT count(*) FROM _pub_import_errors WHERE error_code LIKE 'WARN_%')
WHERE b.id = :import_batch_id;

COMMIT;

\echo '>>> step 11 publish complete for import_batch_id =' :import_batch_id
