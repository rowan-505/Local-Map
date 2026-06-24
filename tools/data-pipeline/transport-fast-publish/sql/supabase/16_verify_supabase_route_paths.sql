-- =============================================================================
-- transport-fast-publish — step 16: verify published route paths + finalize.
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the route-path publish
-- session, AFTER step 15. Verifies only rows belonging to :import_batch_id
-- (resolved via transport.source_links.import_batch_id / import_errors).
--
-- Hard fail  -> set import_batches.status='failed' then RAISE EXCEPTION.
-- All clear  -> set import_batches.status='completed', finished_at=now().
-- Warnings never block; unmergeable / MultiLineString paths are logged only.
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
    ('route_path_invalid_geometry', 'HARD', (
        SELECT count(*) FROM transport.route_paths rp
        JOIN transport.source_links sl ON sl.entity_type = 'route_path' AND sl.entity_id = rp.id AND sl.import_batch_id = :import_batch_id
        WHERE rp.geom IS NULL
           OR NOT ST_IsValid(rp.geom)
           OR ST_IsEmpty(rp.geom)
           OR ST_SRID(rp.geom) <> 4326
           OR ST_GeometryType(rp.geom) <> 'ST_LineString')),
    ('route_path_orphaned_from_variant', 'HARD', (
        SELECT count(*) FROM transport.route_paths rp
        JOIN transport.source_links sl ON sl.entity_type = 'route_path' AND sl.entity_id = rp.id AND sl.import_batch_id = :import_batch_id
        WHERE rp.route_variant_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM transport.route_variants v WHERE v.id = rp.route_variant_id))),
    -- WARN (logged-only outcomes, surfaced from this batch's import_errors) ------
    ('relation_no_way_members', 'WARN', (
        SELECT count(*) FROM transport.import_errors
        WHERE import_batch_id = :import_batch_id AND error_code = 'WARN_RELATION_NO_WAY_MEMBERS')),
    ('relation_path_unmergeable', 'WARN', (
        SELECT count(*) FROM transport.import_errors
        WHERE import_batch_id = :import_batch_id AND error_code = 'WARN_ROUTE_PATH_UNMERGEABLE')),
    ('route_path_skipped_multilinestring', 'WARN', (
        SELECT count(*) FROM transport.import_errors
        WHERE import_batch_id = :import_batch_id AND error_code = 'ROUTE_PATH_NOT_SINGLE_LINESTRING'));

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
    RAISE NOTICE 'supabase route-path verification: warnings [%]', coalesce(v_warn, 'none');

    IF v_hard > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_detail FROM _vc WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'supabase route-path verification FAILED (% hard check(s)): % [import_batches.status set to failed]', v_hard, v_detail;
    END IF;

    RAISE NOTICE 'supabase route-path verification PASSED; import_batch marked completed';
END
$verify$;
