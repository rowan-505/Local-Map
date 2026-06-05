-- =============================================================================
-- 05_backfill_roads_admin_area.sql
-- Single-chunk backfill per invocation: assign township admin_area_id to NULL roads.
-- Does not overwrite existing admin_area_id, normalized_data, or updated_at.
--
-- Run repeatedly with advancing -v last_id=<previous last_id> until done=true.
-- One psql invocation = one chunk (avoids Supabase cumulative statement_timeout).
--
-- Matching strategy (production Supabase):
-- Overlap-based line assignment is too expensive (ST_Intersection/ST_Length).
-- core.find_admin_area_for_point() omits geom && and can seq-scan admin polygons.
-- This script uses a township-only temp cache + index-friendly LATERAL lookup
-- (geom && rep_point, then ST_Intersects) on the road representative point.
-- Roads crossing township boundaries may not get the overlap-optimal township,
-- but that is acceptable for initial routing/admin filtering foundation.
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

DO $$
BEGIN
    IF to_regprocedure('core.entity_rep_point_for_admin_lookup(geometry)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before street backfill (rep point helper)';
    END IF;
    IF to_regprocedure('core.admin_area_matches_assignment_target(bigint,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before street backfill (level filter helper)';
    END IF;
END $$;

\echo '=== Streets (roads) admin_area backfill (township, NULL-only, one chunk per run) ==='

DROP TABLE IF EXISTS _roads_backfill_chunk_result;
CREATE TEMP TABLE _roads_backfill_chunk_result (
    last_id bigint NOT NULL,
    inspected_count bigint NOT NULL,
    matched_count bigint NOT NULL,
    updated_count bigint NOT NULL,
    elapsed_ms numeric NOT NULL,
    done boolean NOT NULL
);

DO $backfill$
DECLARE
    v_has_verification_status boolean;
    v_dry_run boolean;
    v_chunk_limit integer;
    v_last_id bigint;
    v_chunk_max_id bigint;
    v_inspected bigint;
    v_matched bigint;
    v_updated bigint;
    v_chunk_started timestamptz;
    v_chunk_elapsed_ms numeric;
    v_target_level constant text := 'township';
BEGIN
    v_dry_run := core.pipeline_dry_run_enabled();
    v_last_id := coalesce(
        nullif(current_setting('coremap.last_id', true), '')::bigint,
        0
    );
    v_chunk_limit := greatest(
        1,
        least(
            500,
            coalesce(nullif(current_setting('coremap.limit_rows', true), '')::integer, 200)
        )
    );

    RAISE NOTICE 'streets backfill session: dry_run=%, chunk_limit=%, last_id=%, target_level=%, match_method=indexed_point_township',
        v_dry_run, v_chunk_limit, v_last_id, v_target_level;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    DROP TABLE IF EXISTS _roads_township_areas;
    CREATE TEMP TABLE _roads_township_areas ON COMMIT DROP AS
    SELECT
        aa.id,
        aa.geom,
        st_area(aa.geom::geography) AS area_m2
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND core.admin_area_matches_assignment_target(
          aa.admin_level_id, al.code, al.name, v_target_level
      );

    CREATE INDEX _roads_township_areas_geom_gix
        ON _roads_township_areas
        USING gist (geom);

    v_chunk_started := clock_timestamp();

    DROP TABLE IF EXISTS _roads_chunk;

    CREATE TEMP TABLE _roads_chunk ON COMMIT DROP AS
    WITH candidate AS (
        SELECT
            s.id,
            core.entity_rep_point_for_admin_lookup(s.geom) AS rep_point
        FROM core.core_streets AS s
        WHERE s.deleted_at IS NULL
          AND coalesce(s.is_active, true) IS TRUE
          AND s.geom IS NOT NULL
          AND NOT st_isempty(s.geom)
          AND st_isvalid(s.geom)
          AND s.admin_area_id IS NULL
          AND s.id > v_last_id
          AND NOT core.entity_admin_assignment_is_protected(
              coalesce(s.manual_override, false),
              s.is_verified,
              CASE
                  WHEN v_has_verification_status THEN s.verification_status
                  ELSE NULL::text
              END
          )
        ORDER BY s.id
        LIMIT v_chunk_limit
    ),
    matched AS (
        SELECT
            c.id,
            hit.new_admin_area_id
        FROM candidate AS c
        LEFT JOIN LATERAL (
            SELECT ta.id AS new_admin_area_id
            FROM _roads_township_areas AS ta
            WHERE c.rep_point IS NOT NULL
              AND NOT st_isempty(c.rep_point)
              AND st_isvalid(c.rep_point)
              AND ta.geom && c.rep_point
              AND st_intersects(ta.geom, c.rep_point)
            ORDER BY ta.area_m2 ASC NULLS LAST, ta.id ASC
            LIMIT 1
        ) AS hit ON true
    )
    SELECT
        m.id,
        m.new_admin_area_id
    FROM matched AS m;

    SELECT
        count(*)::bigint,
        count(*) FILTER (WHERE c.new_admin_area_id IS NOT NULL)::bigint,
        max(c.id)
    INTO v_inspected, v_matched, v_chunk_max_id
    FROM _roads_chunk AS c;

    v_chunk_elapsed_ms := round(
        extract(epoch from (clock_timestamp() - v_chunk_started)) * 1000,
        2
    );

    IF v_inspected > 0 THEN
        v_last_id := v_chunk_max_id;
    END IF;

    IF NOT v_dry_run AND v_matched > 0 THEN
        UPDATE core.core_streets AS s
        SET admin_area_id = c.new_admin_area_id
        FROM _roads_chunk AS c
        WHERE s.id = c.id
          AND s.admin_area_id IS NULL
          AND c.new_admin_area_id IS NOT NULL;

        GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSE
        v_updated := v_matched;
    END IF;

    RAISE NOTICE 'streets backfill chunk: inspected_count=%, matched_count=%, updated_count=%, last_id=%, elapsed_ms=%, done=%',
        v_inspected, v_matched, v_updated, v_last_id, v_chunk_elapsed_ms, (v_inspected = 0);

    DELETE FROM _roads_backfill_chunk_result;

    INSERT INTO _roads_backfill_chunk_result (
        last_id,
        inspected_count,
        matched_count,
        updated_count,
        elapsed_ms,
        done
    )
    VALUES (
        v_last_id,
        v_inspected,
        v_matched,
        v_updated,
        v_chunk_elapsed_ms,
        v_inspected = 0
    );

    DROP TABLE IF EXISTS _roads_chunk;
    DROP TABLE IF EXISTS _roads_township_areas;
END $backfill$;

\echo '--- chunk_result (pass last_id to next run until done=true) ---'

SELECT
    last_id,
    inspected_count,
    matched_count,
    updated_count,
    elapsed_ms,
    done
FROM _roads_backfill_chunk_result;
