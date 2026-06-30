-- =============================================================================
-- transport-fast-publish — Phase 6.5: local route validation (LOCAL ONLY)
--
-- Reads local_transport_publish.routes / route_variants / source_links and gates
-- the route buffer BEFORE any Supabase publish. Structural problems hard-fail
-- (RAISE EXCEPTION, aborting via ON_ERROR_STOP). Soft issues are recorded as
-- WARN_* rows in local_transport_publish.import_errors and never block.
--
-- This stage NEVER writes to Supabase and runs AFTER 04 (route normalization).
-- It runs in psql autocommit (no BEGIN/COMMIT) so warning rows persist even if a
-- later hard-fail aborts the run.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, import_route_metadata
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif
\if :{?import_route_metadata}
\else
  \set import_route_metadata true
\endif

\if :import_route_metadata

-- -----------------------------------------------------------------------------
-- Check results table (severity + count), computed once.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS _vr;
CREATE TEMP TABLE _vr (check_name text, severity text, cnt bigint);

INSERT INTO _vr VALUES
    -- HARD ---------------------------------------------------------------------
    ('duplicate_route_external_id', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM local_transport_publish.routes
            WHERE source_name = :'source_name'
            GROUP BY external_id HAVING count(*) > 1) d)),
    ('duplicate_route_variant_external_id', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM local_transport_publish.route_variants
            WHERE source_name = :'source_name'
            GROUP BY external_id HAVING count(*) > 1) d)),
    ('duplicate_route_source_identity', 'HARD',
        (SELECT count(*) FROM (
            SELECT 1 FROM local_transport_publish.source_links
            WHERE entity_type IN ('route','route_variant') AND external_id IS NOT NULL
            GROUP BY entity_type, source_name, source_kind, external_id
            HAVING count(*) > 1) d)),
    ('route_invalid_mode', 'HARD',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name'
           AND (mode IS NULL
                OR NOT (mode = ANY (ARRAY['bus','express_bus','train','ferry','air','other']))))),
    ('route_confidence_out_of_range', 'HARD',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name'
           AND (confidence_score < 0 OR confidence_score > 100))),
    -- WARN ---------------------------------------------------------------------
    ('route_missing_name_mm', 'WARN',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name'
           AND NOT EXISTS (SELECT 1 FROM local_transport_publish.route_names rn
                           WHERE rn.route_external_id = routes.external_id AND rn.language_code = 'my'))),
    ('route_missing_name_en', 'WARN',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name'
           AND NOT EXISTS (SELECT 1 FROM local_transport_publish.route_names rn
                           WHERE rn.route_external_id = routes.external_id AND rn.language_code = 'en'))),
    ('route_fallback_name', 'WARN',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name' AND public_name = external_id)),
    ('route_low_confidence', 'WARN',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name' AND confidence_score < 50)),
    ('variant_without_route', 'WARN',
        (SELECT count(*) FROM local_transport_publish.route_variants v
         WHERE v.source_name = :'source_name'
           AND NOT EXISTS (SELECT 1 FROM local_transport_publish.routes r
                           WHERE r.external_id = v.route_external_id))),
    -- Routes that share a canonical key with another route but were NOT
    -- auto-merged (possible branch). These are the duplicate-review list.
    ('route_possible_duplicate', 'WARN',
        (SELECT count(*) FROM local_transport_publish.routes
         WHERE source_name = :'source_name'
           AND normalized_data->>'route_group_kind' = 'possible_duplicate'));

-- -----------------------------------------------------------------------------
-- Record warnings into import_errors (WARN_* error_code). Idempotent: clear this
-- stage's own prior WARN_* rows (route/route_variant) first — NOT the point warns.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.import_errors
WHERE source_name = :'source_name'
  AND error_code LIKE 'WARN_%'
  AND entity_type IN ('route', 'route_variant');

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, 'route', source_kind, source_name, import_batch_key,
       'WARN_MISSING_NAME_MM', 'route has no Burmese (my) name', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM local_transport_publish.routes routes
WHERE source_name = :'source_name'
  AND NOT EXISTS (SELECT 1 FROM local_transport_publish.route_names rn
                  WHERE rn.route_external_id = routes.external_id AND rn.language_code = 'my');

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, 'route', source_kind, source_name, import_batch_key,
       'WARN_MISSING_NAME_EN', 'route has no English (en) name', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM local_transport_publish.routes routes
WHERE source_name = :'source_name'
  AND NOT EXISTS (SELECT 1 FROM local_transport_publish.route_names rn
                  WHERE rn.route_external_id = routes.external_id AND rn.language_code = 'en');

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, 'route', source_kind, source_name, import_batch_key,
       'WARN_FALLBACK_NAME', 'route public_name is a generated fallback (external_id)', '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM local_transport_publish.routes
WHERE source_name = :'source_name' AND public_name = external_id;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, 'route', source_kind, source_name, import_batch_key,
       'WARN_LOW_CONFIDENCE', format('low confidence_score (%s < 50)', confidence_score), '{}'::jsonb,
       source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM local_transport_publish.routes
WHERE source_name = :'source_name' AND confidence_score < 50;

INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT v.external_id, 'route_variant', v.source_kind, v.source_name, v.import_batch_key,
       'WARN_VARIANT_NO_ROUTE', 'route_variant has no matching route external_id in buffer', '{}'::jsonb,
       v.source_refs, v.normalized_data, v.confidence_score, 'imported_unreviewed'
FROM local_transport_publish.route_variants v
WHERE v.source_name = :'source_name'
  AND NOT EXISTS (SELECT 1 FROM local_transport_publish.routes r
                  WHERE r.external_id = v.route_external_id);

-- Duplicate-review list: routes sharing a canonical key but not safely merged
-- (possible branches). Surfaced to transport.import_errors for manual review;
-- never auto-merged.
INSERT INTO local_transport_publish.import_errors
    (external_id, entity_type, source_kind, source_name, import_batch_key,
     error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status)
SELECT external_id, 'route', source_kind, source_name, import_batch_key,
       'WARN_POSSIBLE_DUPLICATE_ROUTE',
       format('route shares canonical key "%s" with another route but was not auto-merged (possible branch); review for duplicate/direction',
              normalized_data->>'route_group_key'),
       '{}'::jsonb, source_refs, normalized_data, confidence_score, 'imported_unreviewed'
FROM local_transport_publish.routes
WHERE source_name = :'source_name'
  AND normalized_data->>'route_group_kind' = 'possible_duplicate';

-- -----------------------------------------------------------------------------
-- Summary (prints to the log before any hard-fail abort below).
-- -----------------------------------------------------------------------------
SELECT severity, check_name, cnt
FROM _vr
ORDER BY (severity = 'HARD') DESC, severity, check_name;

-- -----------------------------------------------------------------------------
-- Hard-fail gate.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
    v_hard_checks bigint;
    v_warn_rows   bigint;
    v_hard_detail text;
    v_warn_detail text;
BEGIN
    SELECT count(*) FILTER (WHERE severity = 'HARD' AND cnt > 0),
           coalesce(sum(cnt) FILTER (WHERE severity = 'WARN'), 0)
    INTO v_hard_checks, v_warn_rows
    FROM _vr;

    SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
    INTO v_warn_detail FROM _vr WHERE severity = 'WARN' AND cnt > 0;

    RAISE NOTICE 'transport route validation: % warning row(s) recorded [%]',
        v_warn_rows, coalesce(v_warn_detail, 'none');

    IF v_hard_checks > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_hard_detail FROM _vr WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'transport route validation FAILED (% hard check(s)): %',
            v_hard_checks, v_hard_detail;
    END IF;

    RAISE NOTICE 'transport route validation PASSED (no hard failures)';
END
$verify$;

\else
\echo '>>> 05 skipped: import_route_metadata is not true (route metadata import disabled)'
\endif
