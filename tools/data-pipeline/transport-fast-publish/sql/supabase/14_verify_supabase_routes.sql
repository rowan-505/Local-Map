-- =============================================================================
-- transport-fast-publish — step 14: verify published route metadata + finalize.
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route publish session,
-- AFTER step 13. Verifies only rows belonging to :import_batch_id (resolved via
-- transport.source_links.import_batch_id).
--
-- Hard fail  -> set import_batches.status='failed' then RAISE EXCEPTION.
-- All clear  -> set import_batches.status='completed', finished_at=now().
-- Warnings never block. No path / stop logic exists yet, so "route without
-- path" and "route without stops" are expected warnings in this phase.
--
-- Runs in autocommit (no BEGIN/COMMIT) so the status update persists even when a
-- hard fail aborts the session.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?import_batch_id}
\else
  \echo '!!! import_batch_id is not set'
  \set import_batch_id 0
\endif

DROP TABLE IF EXISTS _vc;
CREATE TEMP TABLE _vc (check_name text, severity text, cnt bigint);

INSERT INTO _vc VALUES
    -- HARD ---------------------------------------------------------------------
    ('route_variant_without_route', 'HARD', (
        SELECT count(*) FROM transport.route_variants v
        JOIN transport.source_links sl ON sl.entity_type = 'route_variant' AND sl.entity_id = v.id AND sl.import_batch_id = :import_batch_id
        WHERE v.route_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM transport.routes r WHERE r.id = v.route_id))),
    ('source_links_duplicate_identity', 'HARD', (
        SELECT count(*) FROM (
            SELECT 1 FROM transport.source_links
            WHERE import_batch_id = :import_batch_id AND external_id IS NOT NULL
            GROUP BY entity_type, source_name, source_kind, external_id
            HAVING count(*) > 1) d)),
    ('confidence_out_of_range', 'HARD', (
        SELECT count(*) FROM (
            SELECT r.confidence_score FROM transport.routes r
              JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
            UNION ALL
            SELECT v.confidence_score FROM transport.route_variants v
              JOIN transport.source_links sl ON sl.entity_type = 'route_variant' AND sl.entity_id = v.id AND sl.import_batch_id = :import_batch_id
        ) q WHERE confidence_score < 0 OR confidence_score > 100)),
    ('route_invalid_mode', 'HARD', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE r.mode IS NULL OR NOT (r.mode = ANY (ARRAY['bus','express_bus','train','ferry','air','other'])))),
    -- WARN ---------------------------------------------------------------------
    ('route_missing_name_mm', 'WARN', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE NOT EXISTS (SELECT 1 FROM transport.route_names rn WHERE rn.route_id = r.id AND rn.language_code = 'my'))),
    ('route_missing_name_en', 'WARN', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE NOT EXISTS (SELECT 1 FROM transport.route_names rn WHERE rn.route_id = r.id AND rn.language_code = 'en'))),
    ('route_missing_origin_destination', 'WARN', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE r.origin_name IS NULL OR r.destination_name IS NULL)),
    ('route_without_path', 'WARN', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE NOT EXISTS (
            SELECT 1 FROM transport.route_variants v
            JOIN transport.route_paths p ON p.route_variant_id = v.id
            WHERE v.route_id = r.id))),
    ('route_without_stops', 'WARN', (
        SELECT count(*) FROM transport.routes r
        JOIN transport.source_links sl ON sl.entity_type = 'route' AND sl.entity_id = r.id AND sl.import_batch_id = :import_batch_id
        WHERE NOT EXISTS (
            SELECT 1 FROM transport.route_variants v
            JOIN transport.route_stops s ON s.route_variant_id = v.id
            WHERE v.route_id = r.id)));

-- Summary (prints before any hard-fail abort).
SELECT severity, check_name, cnt
FROM _vc
ORDER BY (severity = 'HARD') DESC, severity, check_name;

-- Finalize batch status FIRST, in its own autocommit statement, so the result
-- (completed/failed) persists even when the hard-fail RAISE below aborts the
-- session.
UPDATE transport.import_batches b
SET status = CASE WHEN (SELECT count(*) FROM _vc WHERE severity = 'HARD' AND cnt > 0) > 0
                  THEN 'failed' ELSE 'completed' END,
    finished_at = now()
WHERE b.id = :import_batch_id;

-- Report warnings and raise on hard failures (touches no row state).
DO $verify$
DECLARE
    v_hard   bigint;
    v_warn   text;
    v_detail text;
BEGIN
    SELECT count(*) FILTER (WHERE severity = 'HARD' AND cnt > 0) INTO v_hard FROM _vc;

    SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
    INTO v_warn FROM _vc WHERE severity = 'WARN' AND cnt > 0;
    RAISE NOTICE 'supabase route verification: warnings [%]', coalesce(v_warn, 'none');

    IF v_hard > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_detail FROM _vc WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'supabase route verification FAILED (% hard check(s)): % [import_batches.status set to failed]', v_hard, v_detail;
    END IF;

    RAISE NOTICE 'supabase route verification PASSED; import_batch marked completed';
END
$verify$;
