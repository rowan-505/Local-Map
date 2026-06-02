-- =============================================================================
-- Phase 1 verification: review_overrides_archive parity (read-only)
-- =============================================================================
--
-- Run after migration 082. Aborts if HS-1 violated.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/import-review/001_review-overrides-archive-verify.sql
--
-- =============================================================================

\set ON_ERROR_STOP on

\echo '=== Phase 1 archive parity (HS-1) ==='

DO $$
DECLARE
    tbl text;
    tables constant text[] := array[
        'import_review.address_candidates',
        'import_review.admin_area_candidates',
        'import_review.building_candidates',
        'import_review.bus_route_candidates',
        'import_review.bus_route_stop_candidates',
        'import_review.bus_route_variant_candidates',
        'import_review.bus_stop_candidates',
        'import_review.landuse_candidates',
        'import_review.place_candidates',
        'import_review.road_candidates',
        'import_review.routing_barrier_candidates',
        'import_review.routing_turn_restriction_candidates',
        'import_review.water_line_candidates',
        'import_review.water_polygon_candidates'
    ];
    live_cnt bigint;
    arch_cnt bigint;
    diff_cnt bigint;
    has_archive boolean;
BEGIN
    FOREACH tbl IN ARRAY tables
    LOOP
        IF to_regclass(tbl) IS NULL THEN
            RAISE NOTICE 'SKIP % (missing)', tbl;
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'import_review'
              AND table_name = split_part(tbl, '.', 2)
              AND column_name = 'review_overrides_archive'
        )
        INTO has_archive;

        IF NOT has_archive THEN
            RAISE EXCEPTION 'HS-1 FAIL: % missing column review_overrides_archive', tbl;
        END IF;

        EXECUTE format(
            'select count(*)::bigint from %s where review_overrides <> %L::jsonb',
            tbl,
            '{}'
        )
        INTO live_cnt;

        EXECUTE format(
            'select count(*)::bigint from %s where review_overrides_archive <> %L::jsonb',
            tbl,
            '{}'
        )
        INTO arch_cnt;

        EXECUTE format(
            $sql$
            select count(*)::bigint
            from %s
            where review_overrides <> '{}'::jsonb
              and review_overrides_archive is distinct from review_overrides
            $sql$,
            tbl
        )
        INTO diff_cnt;

        IF live_cnt IS DISTINCT FROM arch_cnt OR diff_cnt > 0 THEN
            RAISE EXCEPTION
                'HS-1 FAIL on %: live=% archive=% json_diff=%',
                tbl,
                live_cnt,
                arch_cnt,
                diff_cnt;
        END IF;

        RAISE NOTICE 'OK % live=% archive=%', tbl, live_cnt, arch_cnt;
    END LOOP;
END $$;

\echo '=== Phase 1 archive verification passed ==='
