-- =============================================================================
-- transport-fast-publish — Phase 5 / step 12: verify published rows + finalize.
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the publish session, AFTER
-- step 11. Verifies only the rows belonging to :import_batch_id (resolved via
-- transport.source_links.import_batch_id).
--
-- Hard fail  -> set import_batches.status='failed' then RAISE EXCEPTION.
-- All clear  -> set import_batches.status='completed', finished_at=now().
-- Warnings never block.
--
-- Runs in autocommit (no BEGIN/COMMIT) so the status update persists even when
-- a hard fail aborts the session.
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
    ('stops_invalid_geometry', 'HARD', (
        SELECT count(*) FROM transport.stops s
        JOIN transport.source_links sl ON sl.entity_type = 'stop' AND sl.entity_id = s.id AND sl.import_batch_id = :import_batch_id
        WHERE s.geom IS NULL OR ST_IsEmpty(s.geom) OR NOT ST_IsValid(s.geom) OR ST_SRID(s.geom) <> 4326)),
    ('terminals_invalid_geometry', 'HARD', (
        SELECT count(*) FROM transport.terminals t
        JOIN transport.source_links sl ON sl.entity_type = 'terminal' AND sl.entity_id = t.id AND sl.import_batch_id = :import_batch_id
        WHERE t.geom IS NULL OR ST_IsEmpty(t.geom) OR NOT ST_IsValid(t.geom) OR ST_SRID(t.geom) <> 4326)),
    ('lines_invalid_geometry', 'HARD', (
        SELECT count(*) FROM transport.infrastructure_lines il
        JOIN transport.source_links sl ON sl.entity_type = 'infrastructure_line' AND sl.entity_id = il.id AND sl.import_batch_id = :import_batch_id
        WHERE il.geom IS NULL OR ST_IsEmpty(il.geom) OR NOT ST_IsValid(il.geom) OR ST_SRID(il.geom) <> 4326)),
    ('source_links_duplicate_identity', 'HARD', (
        SELECT count(*) FROM (
            SELECT 1 FROM transport.source_links
            WHERE import_batch_id = :import_batch_id AND external_id IS NOT NULL
            GROUP BY entity_type, source_name, source_kind, external_id
            HAVING count(*) > 1) d)),
    ('source_links_missing_entity', 'HARD', (
        SELECT count(*) FROM transport.source_links sl
        WHERE sl.import_batch_id = :import_batch_id
          AND sl.entity_type IN ('stop','terminal','infrastructure_line')
          AND (
              (sl.entity_type = 'stop' AND NOT EXISTS (SELECT 1 FROM transport.stops s WHERE s.id = sl.entity_id))
           OR (sl.entity_type = 'terminal' AND NOT EXISTS (SELECT 1 FROM transport.terminals t WHERE t.id = sl.entity_id))
           OR (sl.entity_type = 'infrastructure_line' AND NOT EXISTS (SELECT 1 FROM transport.infrastructure_lines il WHERE il.id = sl.entity_id))
          ))),
    ('confidence_out_of_range', 'HARD', (
        SELECT count(*) FROM (
            SELECT s.confidence_score FROM transport.stops s
              JOIN transport.source_links sl ON sl.entity_type = 'stop' AND sl.entity_id = s.id AND sl.import_batch_id = :import_batch_id
            UNION ALL
            SELECT t.confidence_score FROM transport.terminals t
              JOIN transport.source_links sl ON sl.entity_type = 'terminal' AND sl.entity_id = t.id AND sl.import_batch_id = :import_batch_id
            UNION ALL
            SELECT il.confidence_score FROM transport.infrastructure_lines il
              JOIN transport.source_links sl ON sl.entity_type = 'infrastructure_line' AND sl.entity_id = il.id AND sl.import_batch_id = :import_batch_id
        ) q WHERE confidence_score < 0 OR confidence_score > 100)),
    -- WARN ---------------------------------------------------------------------
    ('missing_name_mm', 'WARN', (
        SELECT count(*) FROM transport.stops s
        JOIN transport.source_links sl ON sl.entity_type = 'stop' AND sl.entity_id = s.id AND sl.import_batch_id = :import_batch_id
        WHERE s.name_mm IS NULL)),
    ('missing_name_en', 'WARN', (
        SELECT count(*) FROM transport.stops s
        JOIN transport.source_links sl ON sl.entity_type = 'stop' AND sl.entity_id = s.id AND sl.import_batch_id = :import_batch_id
        WHERE s.name_en IS NULL)),
    ('low_confidence', 'WARN', (
        SELECT count(*) FROM (
            SELECT s.confidence_score FROM transport.stops s
              JOIN transport.source_links sl ON sl.entity_type = 'stop' AND sl.entity_id = s.id AND sl.import_batch_id = :import_batch_id
            UNION ALL
            SELECT t.confidence_score FROM transport.terminals t
              JOIN transport.source_links sl ON sl.entity_type = 'terminal' AND sl.entity_id = t.id AND sl.import_batch_id = :import_batch_id
            UNION ALL
            SELECT il.confidence_score FROM transport.infrastructure_lines il
              JOIN transport.source_links sl ON sl.entity_type = 'infrastructure_line' AND sl.entity_id = il.id AND sl.import_batch_id = :import_batch_id
        ) q WHERE confidence_score < 50)),
    ('terminals_without_linked_stop', 'WARN', (
        SELECT count(*) FROM transport.terminals t
        JOIN transport.source_links sl ON sl.entity_type = 'terminal' AND sl.entity_id = t.id AND sl.import_batch_id = :import_batch_id
        WHERE t.linked_stop_id IS NULL));

-- Summary (prints before any hard-fail abort).
SELECT severity, check_name, cnt
FROM _vc
ORDER BY (severity = 'HARD') DESC, severity, check_name;

-- Finalize batch status FIRST, in its own autocommit statement, so the result
-- (completed/failed) persists even when the hard-fail RAISE below aborts the
-- session. Doing the UPDATE and RAISE in one DO block would roll back the
-- status change together with the exception.
UPDATE transport.import_batches b
SET status = CASE WHEN (SELECT count(*) FROM _vc WHERE severity = 'HARD' AND cnt > 0) > 0
                  THEN 'failed' ELSE 'completed' END,
    finished_at = now()
WHERE b.id = :import_batch_id;

-- Report warnings and raise on hard failures (this block touches no row state,
-- so a rollback here loses nothing).
DO $verify$
DECLARE
    v_hard   bigint;
    v_warn   text;
    v_detail text;
BEGIN
    SELECT count(*) FILTER (WHERE severity = 'HARD' AND cnt > 0) INTO v_hard FROM _vc;

    SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
    INTO v_warn FROM _vc WHERE severity = 'WARN' AND cnt > 0;
    RAISE NOTICE 'supabase publish verification: warnings [%]', coalesce(v_warn, 'none');

    IF v_hard > 0 THEN
        SELECT string_agg(format('%s=%s', check_name, cnt), ', ' ORDER BY check_name)
        INTO v_detail FROM _vc WHERE severity = 'HARD' AND cnt > 0;
        RAISE EXCEPTION 'supabase publish verification FAILED (% hard check(s)): % [import_batches.status set to failed]', v_hard, v_detail;
    END IF;

    RAISE NOTICE 'supabase publish verification PASSED; import_batch marked completed';
END
$verify$;
