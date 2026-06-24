-- =============================================================================
-- transport-fast-publish — step 18: verify published route stops + finalize.
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route-stop publish
-- session, AFTER step 17. route_stops have no source_links, so this batch's rows
-- are scoped via normalized_data->>'import_batch_key' = :import_batch_key.
--
-- Hard fail  -> set import_batches.status='failed' then RAISE EXCEPTION.
-- All clear  -> set import_batches.status='completed', finished_at=now().
-- Warnings never block; incomplete OSM stop sequences are logged only.
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
\if :{?import_batch_key}
\else
  \set import_batch_key 'unknown'
\endif
\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif

DROP TABLE IF EXISTS _vc;
CREATE TEMP TABLE _vc (check_name text, severity text, cnt bigint);

INSERT INTO _vc VALUES
    -- HARD ---------------------------------------------------------------------
    ('route_stop_orphan', 'HARD', (
        SELECT count(*) FROM transport.route_stops rs
        WHERE rs.normalized_data->>'import_batch_key' = :'import_batch_key'
          AND (rs.route_variant_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM transport.route_variants v WHERE v.id = rs.route_variant_id)
               OR rs.stop_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM transport.stops s WHERE s.id = rs.stop_id)))),
    ('route_stop_duplicate_sequence', 'HARD', (
        SELECT count(*) FROM (
            SELECT 1 FROM transport.route_stops
            WHERE normalized_data->>'import_batch_key' = :'import_batch_key'
            GROUP BY route_variant_id, stop_sequence
            HAVING count(*) > 1) d)),
    ('route_stop_sequence_not_positive', 'HARD', (
        SELECT count(*) FROM transport.route_stops
        WHERE normalized_data->>'import_batch_key' = :'import_batch_key'
          AND (stop_sequence IS NULL OR stop_sequence <= 0))),
    -- WARN ---------------------------------------------------------------------
    ('variant_with_fewer_than_2_stops', 'WARN', (
        SELECT count(*) FROM (
            SELECT route_variant_id FROM transport.route_stops
            WHERE normalized_data->>'import_batch_key' = :'import_batch_key'
            GROUP BY route_variant_id HAVING count(*) < 2) q)),
    ('unmatched_stop_members', 'WARN', (
        SELECT count(*) FROM transport.import_errors
        WHERE import_batch_id = :import_batch_id AND error_code = 'ROUTE_STOP_MEMBER_NOT_IMPORTED')),
    ('osm_variant_with_path_but_no_stops', 'WARN', (
        SELECT count(*) FROM transport.route_variants v
        JOIN transport.source_links sl
          ON sl.entity_type = 'route_variant' AND sl.entity_id = v.id
         AND sl.source_name = :'source_name' AND sl.source_kind = 'osm_relation'
        WHERE EXISTS (SELECT 1 FROM transport.route_paths p WHERE p.route_variant_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM transport.route_stops s WHERE s.route_variant_id = v.id)));

-- Summary (prints before any hard-fail abort).
SELECT severity, check_name, cnt
FROM _vc
ORDER BY (severity = 'HARD') DESC, severity, check_name;

-- Finalize batch status FIRST, in its own autocommit statement, so the result
-- persists even when the hard-fail RAISE below aborts the session.
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
    RAISE NOTICE 'supabase route-stop verification: warnings [%]', coalesce(v_warn, 'none');

    IF v_hard > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_detail FROM _vc WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'supabase route-stop verification FAILED (% hard check(s)): % [import_batches.status set to failed]', v_hard, v_detail;
    END IF;

    RAISE NOTICE 'supabase route-stop verification PASSED; import_batch marked completed';
END
$verify$;
