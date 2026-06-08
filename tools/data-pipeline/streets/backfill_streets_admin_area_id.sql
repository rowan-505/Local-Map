-- =============================================================================
-- backfill_streets_admin_area_id.sql
-- =============================================================================
-- Roads/streets ONLY: assign township-level core.core_streets.admin_area_id.
-- Does not touch places, buildings, or other entities.
--
-- One chunk per psql invocation (avoids cumulative statement_timeout on Supabase).
-- Re-run with advancing -v last_id=<previous last_id> until done=true.
--
-- Matching: core.find_admin_area_for_line(geom, 'township')
--   → largest line–township overlap (core.pick_admin_area_for_line_overlap),
--     then representative-point township fallback.
--
-- Candidates: admin_area_id IS NULL OR points to missing/inactive/non-township.
-- Protected rows (manual_override / verified) are skipped unless forced.
--
-- Prerequisite: tools/data-pipeline/admin-hierarchy-repair/03_create_admin_assignment_functions.sql
-- =============================================================================

\set ON_ERROR_STOP on
\ir ../admin-hierarchy-repair/_pipeline_session_config.sql

DO $$
BEGIN
    IF to_regprocedure('core.find_admin_area_for_line(geometry,text)') IS NULL THEN
        RAISE EXCEPTION 'Run admin-hierarchy-repair/03_create_admin_assignment_functions.sql first';
    END IF;
    IF to_regprocedure('core.admin_area_row_matches_target(bigint,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Run admin-hierarchy-repair/03_create_admin_assignment_functions.sql first (level helpers)';
    END IF;
END $$;

\echo '=== Streets admin_area_id backfill (township overlap, chunked) ==='

DROP TABLE IF EXISTS _streets_admin_backfill_chunk_result;
CREATE TEMP TABLE _streets_admin_backfill_chunk_result (
    last_id bigint NOT NULL,
    scanned bigint NOT NULL,
    updated bigint NOT NULL,
    unchanged bigint NOT NULL,
    no_match bigint NOT NULL,
    invalid_existing bigint NOT NULL,
    would_clear_invalid bigint NOT NULL,
    elapsed_ms numeric NOT NULL,
    done boolean NOT NULL
);

DO $backfill$
DECLARE
    v_has_deleted_at boolean;
    v_has_manual_override boolean;
    v_has_verification_status boolean;
    v_dry_run boolean;
    v_chunk_limit integer;
    v_last_id bigint;
    v_chunk_max_id bigint;
    v_scanned bigint;
    v_updated bigint;
    v_unchanged bigint;
    v_no_match bigint;
    v_invalid_existing bigint;
    v_would_clear_invalid bigint;
    v_chunk_started timestamptz;
    v_chunk_elapsed_ms numeric;
    v_target_level constant text := 'township';
    v_repair_method constant text := 'township_line_overlap';
BEGIN
    v_dry_run := core.pipeline_dry_run_enabled();
    v_last_id := coalesce(
        nullif(current_setting('coremap.last_id', true), '')::bigint,
        0
    );
    v_chunk_limit := greatest(
        1,
        least(
            coalesce(nullif(current_setting('coremap.limit_rows', true), '')::integer, 5000),
            10000
        )
    );

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'deleted_at'
    )
    INTO v_has_deleted_at;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'manual_override'
    )
    INTO v_has_manual_override;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    RAISE NOTICE
        'streets admin backfill session: dry_run=%, chunk_limit=%, last_id=%, target_level=%, repair_method=%',
        v_dry_run, v_chunk_limit, v_last_id, v_target_level, v_repair_method;

    v_chunk_started := clock_timestamp();

    DROP TABLE IF EXISTS _streets_admin_chunk;

    CREATE TEMP TABLE _streets_admin_chunk ON COMMIT DROP AS
    SELECT
        s.id,
        s.admin_area_id AS old_admin_area_id,
        s.geom,
        CASE
            WHEN s.admin_area_id IS NULL THEN 'null'
            WHEN NOT EXISTS (
                SELECT 1
                FROM core.core_admin_areas AS aa
                WHERE aa.id = s.admin_area_id
                  AND aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
            ) THEN 'invalid_fk'
            ELSE 'non_township'
        END AS existing_kind
    FROM core.core_streets AS s
    WHERE coalesce(s.is_active, true) IS TRUE
      AND (NOT v_has_deleted_at OR s.deleted_at IS NULL)
      AND s.geom IS NOT NULL
      AND NOT st_isempty(s.geom)
      AND st_isvalid(s.geom)
      AND s.id > v_last_id
      AND (
          s.admin_area_id IS NULL
          OR NOT EXISTS (
              SELECT 1
              FROM core.core_admin_areas AS aa
              INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
              WHERE aa.id = s.admin_area_id
                AND aa.is_active IS TRUE
                AND aa.deleted_at IS NULL
                AND core.admin_area_row_matches_target(
                    aa.admin_level_id,
                    al.code,
                    al.name,
                    v_target_level
                )
          )
      )
      AND NOT core.entity_admin_assignment_is_protected(
          CASE WHEN v_has_manual_override THEN coalesce(s.manual_override, false) ELSE false END,
          s.is_verified,
          CASE
              WHEN v_has_verification_status THEN s.verification_status
              ELSE NULL::text
          END
      )
    ORDER BY s.id
    LIMIT v_chunk_limit;

    SELECT count(*)::bigint, max(c.id)
    INTO v_scanned, v_chunk_max_id
    FROM _streets_admin_chunk AS c;

    ALTER TABLE _streets_admin_chunk
        ADD COLUMN new_admin_area_id bigint,
        ADD COLUMN outcome text;

    UPDATE _streets_admin_chunk AS c
    SET new_admin_area_id = core.find_admin_area_for_line(c.geom, v_target_level);

    UPDATE _streets_admin_chunk AS c
    SET outcome = CASE
        WHEN c.new_admin_area_id IS NOT NULL
             AND c.old_admin_area_id IS DISTINCT FROM c.new_admin_area_id
            THEN 'updated'
        WHEN c.new_admin_area_id IS NOT NULL
             AND c.old_admin_area_id IS NOT DISTINCT FROM c.new_admin_area_id
            THEN 'unchanged'
        WHEN c.new_admin_area_id IS NULL
             AND c.existing_kind = 'null'
            THEN 'no_match'
        WHEN c.new_admin_area_id IS NULL
             AND c.existing_kind IN ('invalid_fk', 'non_township')
            THEN 'invalid_existing'
        ELSE 'unchanged'
    END;

    SELECT
        count(*) FILTER (WHERE c.outcome = 'updated')::bigint,
        count(*) FILTER (WHERE c.outcome = 'unchanged')::bigint,
        count(*) FILTER (WHERE c.outcome = 'no_match')::bigint,
        count(*) FILTER (WHERE c.outcome = 'invalid_existing')::bigint
    INTO v_updated, v_unchanged, v_no_match, v_invalid_existing
    FROM _streets_admin_chunk AS c;

    v_would_clear_invalid := v_invalid_existing;

    v_chunk_elapsed_ms := round(
        extract(epoch from (clock_timestamp() - v_chunk_started)) * 1000,
        2
    );

    IF v_scanned > 0 THEN
        v_last_id := v_chunk_max_id;
    END IF;

    IF NOT v_dry_run AND v_updated > 0 THEN
        UPDATE core.core_streets AS s
        SET
            admin_area_id = c.new_admin_area_id,
            updated_at = now()
        FROM _streets_admin_chunk AS c
        WHERE s.id = c.id
          AND c.outcome = 'updated'
          AND c.new_admin_area_id IS NOT NULL
          AND s.admin_area_id IS DISTINCT FROM c.new_admin_area_id;

        GET DIAGNOSTICS v_updated = ROW_COUNT;
    END IF;

    RAISE NOTICE
        'streets admin backfill chunk: scanned=%, updated=%, unchanged=%, no_match=%, invalid_existing=%, would_clear_invalid=%, last_id=%, elapsed_ms=%, done=%',
        v_scanned,
        v_updated,
        v_unchanged,
        v_no_match,
        v_invalid_existing,
        v_would_clear_invalid,
        v_last_id,
        v_chunk_elapsed_ms,
        (v_scanned = 0);

    DELETE FROM _streets_admin_backfill_chunk_result;

    INSERT INTO _streets_admin_backfill_chunk_result (
        last_id,
        scanned,
        updated,
        unchanged,
        no_match,
        invalid_existing,
        would_clear_invalid,
        elapsed_ms,
        done
    )
    VALUES (
        v_last_id,
        v_scanned,
        v_updated,
        v_unchanged,
        v_no_match,
        v_invalid_existing,
        v_would_clear_invalid,
        v_chunk_elapsed_ms,
        v_scanned = 0
    );

    DROP TABLE IF EXISTS _streets_admin_chunk;
END $backfill$;

\echo '--- chunk_result (pass last_id to next run until done=true) ---'

SELECT
    last_id,
    scanned,
    updated,
    unchanged,
    no_match,
    invalid_existing,
    would_clear_invalid,
    elapsed_ms,
    done
FROM _streets_admin_backfill_chunk_result;
