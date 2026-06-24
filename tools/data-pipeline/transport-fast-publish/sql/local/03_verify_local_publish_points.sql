-- =============================================================================
-- transport-fast-publish — Phase 3.5: local light validation (LOCAL ONLY)
--
-- Reads local_transport_publish.* and gates the buffer BEFORE any Supabase
-- publish. Bad geometry / structural problems hard-fail (RAISE EXCEPTION, which
-- aborts the pipeline via ON_ERROR_STOP). Soft issues are recorded as WARN_*
-- rows in local_transport_publish.import_errors and never block.
--
-- This stage NEVER writes to Supabase. It is intentionally light: a set of
-- fast set-based checks, no promotion workflow.
--
-- Runs in psql autocommit (no BEGIN/COMMIT): warning rows persist even when a
-- later hard-fail aborts the run.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, import_batch_key
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif
\if :{?import_batch_key}
\else
  \set import_batch_key 'openstreetmap:osm_pbf:unknown'
\endif

-- -----------------------------------------------------------------------------
-- Unified view of the geometry-bearing entities for this source.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS _ent;
CREATE TEMP TABLE _ent AS
SELECT 'stop'::text AS entity_type, external_id, source_kind, source_name, import_batch_key,
       name, name_mm, name_en, mode, confidence_score, normalized_data, source_refs,
       geom::geometry AS geom, NULL::text AS linked_stop_external_id
FROM local_transport_publish.stops
WHERE source_name = :'source_name'
UNION ALL
SELECT 'terminal', external_id, source_kind, source_name, import_batch_key,
       name, name_mm, name_en, mode, confidence_score, normalized_data, source_refs,
       geom::geometry, linked_stop_external_id
FROM local_transport_publish.terminals
WHERE source_name = :'source_name'
UNION ALL
SELECT 'infrastructure_line', external_id, source_kind, source_name, import_batch_key,
       name, name_mm, name_en, mode, confidence_score, normalized_data, source_refs,
       geom::geometry, NULL
FROM local_transport_publish.infrastructure_lines
WHERE source_name = :'source_name';

CREATE INDEX ON _ent (entity_type, external_id);

-- -----------------------------------------------------------------------------
-- Check results table (severity + count), computed once.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS _v;
CREATE TEMP TABLE _v (check_name text, severity text, cnt bigint);

INSERT INTO _v VALUES
    -- HARD ---------------------------------------------------------------------
    ('invalid_or_null_geometry', 'HARD',
        (SELECT count(*) FROM _ent WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom))),
    ('srid_not_4326', 'HARD',
        (SELECT count(*) FROM _ent WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)),
    ('confidence_out_of_range', 'HARD',
        (SELECT count(*) FROM _ent WHERE confidence_score < 0 OR confidence_score > 100)),
    ('invalid_mode', 'HARD',
        (SELECT count(*) FROM _ent
         WHERE mode IS NULL
            OR NOT (mode = ANY (ARRAY['bus','express_bus','train','ferry','air','other'])))),
    ('duplicate_source_identity', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM local_transport_publish.source_links
            WHERE source_name = :'source_name' AND external_id IS NOT NULL
            GROUP BY entity_type, source_name, source_kind, external_id
            HAVING count(*) > 1) d)),
    ('duplicate_stop_external_id', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM _ent WHERE entity_type = 'stop'
            GROUP BY external_id HAVING count(*) > 1) d)),
    ('duplicate_terminal_external_id', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM _ent WHERE entity_type = 'terminal'
            GROUP BY external_id HAVING count(*) > 1) d)),
    ('duplicate_line_external_id', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM _ent WHERE entity_type = 'infrastructure_line'
            GROUP BY external_id HAVING count(*) > 1) d)),
    -- WARN ---------------------------------------------------------------------
    ('missing_name_mm', 'WARN',
        (SELECT count(*) FROM _ent WHERE name_mm IS NULL)),
    ('missing_name_en', 'WARN',
        (SELECT count(*) FROM _ent WHERE name_en IS NULL)),
    ('fallback_generated_name', 'WARN',
        (SELECT count(*) FROM _ent
         WHERE name = coalesce(normalized_data->>'transport_kind', '') || ' ' || external_id)),
    ('low_confidence', 'WARN',
        (SELECT count(*) FROM _ent WHERE confidence_score < 50)),
    ('terminal_without_matching_stop', 'WARN',
        (SELECT count(*) FROM _ent t
         WHERE t.entity_type = 'terminal'
           AND NOT EXISTS (SELECT 1 FROM _ent s
                           WHERE s.entity_type = 'stop'
                             AND s.external_id = t.linked_stop_external_id)));

-- -----------------------------------------------------------------------------
-- Record warnings into import_errors (WARN_* error_code; no severity column).
-- Idempotent: clear this source's prior WARN_* rows first.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.import_errors
WHERE source_name = :'source_name' AND error_code LIKE 'WARN_%';

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, entity_type, source_kind, source_name, import_batch_key,
       'WARN_MISSING_NAME_MM', 'missing name_mm (Burmese name)', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _ent WHERE name_mm IS NULL;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, entity_type, source_kind, source_name, import_batch_key,
       'WARN_MISSING_NAME_EN', 'missing name_en (English name)', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _ent WHERE name_en IS NULL;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, entity_type, source_kind, source_name, import_batch_key,
       'WARN_FALLBACK_NAME', 'name is a generated fallback (no OSM name tag)', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _ent
WHERE name = coalesce(normalized_data->>'transport_kind', '') || ' ' || external_id;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, entity_type, source_kind, source_name, import_batch_key,
       'WARN_LOW_CONFIDENCE', format('low confidence_score (%s < 50)', confidence_score), '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM _ent WHERE confidence_score < 50;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT t.external_id, t.entity_type, t.source_kind, t.source_name, t.import_batch_key,
       'WARN_TERMINAL_NO_STOP', 'terminal has no matching stop external_id in buffer', '{}'::jsonb,
       t.source_refs, t.normalized_data, t.confidence_score, 'imported_unreviewed'
FROM _ent t
WHERE t.entity_type = 'terminal'
  AND NOT EXISTS (SELECT 1 FROM _ent s
                  WHERE s.entity_type = 'stop' AND s.external_id = t.linked_stop_external_id);

-- -----------------------------------------------------------------------------
-- Summary (prints to the log before any hard-fail abort below).
-- -----------------------------------------------------------------------------
SELECT severity, check_name, cnt
FROM _v
ORDER BY (severity = 'HARD') DESC, severity, check_name;

-- -----------------------------------------------------------------------------
-- Hard-fail gate.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
    v_hard_checks bigint;
    v_hard_rows   bigint;
    v_warn_rows   bigint;
    v_hard_detail text;
    v_warn_detail text;
BEGIN
    SELECT count(*) FILTER (WHERE severity = 'HARD' AND cnt > 0),
           coalesce(sum(cnt) FILTER (WHERE severity = 'HARD'), 0),
           coalesce(sum(cnt) FILTER (WHERE severity = 'WARN'), 0)
    INTO v_hard_checks, v_hard_rows, v_warn_rows
    FROM _v;

    SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
    INTO v_warn_detail FROM _v WHERE severity = 'WARN' AND cnt > 0;

    RAISE NOTICE 'transport local validation: % warning row(s) recorded [%]',
        v_warn_rows, coalesce(v_warn_detail, 'none');

    IF v_hard_checks > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_hard_detail FROM _v WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'transport local validation FAILED (% hard check(s)): %',
            v_hard_checks, v_hard_detail;
    END IF;

    RAISE NOTICE 'transport local validation PASSED (no hard failures)';
END
$verify$;
