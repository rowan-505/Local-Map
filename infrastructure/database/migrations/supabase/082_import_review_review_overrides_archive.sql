-- =============================================================================
-- Supabase migration 082: import_review review_overrides_archive (Phase 1)
-- =============================================================================
--
-- Purpose:
--   Immutable snapshot of reviewer manual edits in review_overrides before
--   column-merge and direct-edit migration. Does NOT drop or clear
--   review_overrides.
--
-- Safety:
--   - Idempotent: ADD COLUMN IF NOT EXISTS; backfill only where archive is empty.
--   - Aborts transaction (HS-1) if archived row count ≠ non-empty review_overrides.
--   - Verifies jsonb equality for all rows with non-empty review_overrides.
--   - Skips tables that do not exist (NOTICE only).
--
-- Verify (read-only): infrastructure/database/migrations/import-review/001_review-overrides-archive-verify.sql
--
-- Apply: Supabase SQL Editor or psql after backup. Single transaction.
--
-- Rollback (before Phase 2 merge):
--   UPDATE import_review.<table>
--   SET review_overrides = review_overrides_archive
--   WHERE review_overrides_archive <> '{}'::jsonb;
--   -- DROP COLUMN review_overrides_archive only if abandoning migration entirely.
--
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Add review_overrides_archive to all import_review *_candidates tables
-- -----------------------------------------------------------------------------

do $$
declare
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
begin
    if to_regnamespace('import_review') is null then
        raise exception '082: schema import_review does not exist.';
    end if;

    foreach tbl in array tables
    loop
        if to_regclass(tbl) is null then
            raise notice '082: skipped % (table does not exist)', tbl;
            continue;
        end if;

        execute format(
            'alter table %s add column if not exists review_overrides_archive jsonb not null default %L::jsonb',
            tbl,
            '{}'
        );

        execute format(
            'comment on column %s.review_overrides_archive is %L',
            tbl,
            'Frozen copy of review_overrides at migration 082 (Phase 1). Do not update after archive; use typed columns + review_candidate_edits.'
        );
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Backfill archive from live review_overrides (one-time per row)
-- -----------------------------------------------------------------------------

do $$
declare
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
    updated_rows bigint;
begin
    foreach tbl in array tables
    loop
        if to_regclass(tbl) is null then
            continue;
        end if;

        execute format(
            $sql$
            update %s as c
            set review_overrides_archive = c.review_overrides
            where c.review_overrides <> '{}'::jsonb
              and c.review_overrides_archive = '{}'::jsonb
            $sql$,
            tbl
        );

        get diagnostics updated_rows = row_count;
        raise notice '082: backfilled % rows in %', updated_rows, tbl;
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. HS-1: archive count must match non-empty review_overrides (STOP if not)
-- -----------------------------------------------------------------------------

do $$
declare
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
    mismatch_cnt bigint;
begin
    foreach tbl in array tables
    loop
        if to_regclass(tbl) is null then
            continue;
        end if;

        execute format(
            'select count(*)::bigint from %s where review_overrides <> %L::jsonb',
            tbl,
            '{}'
        )
        into live_cnt;

        execute format(
            'select count(*)::bigint from %s where review_overrides_archive <> %L::jsonb',
            tbl,
            '{}'
        )
        into arch_cnt;

        if live_cnt is distinct from arch_cnt then
            raise exception
                '082 HS-1 STOP: archive count mismatch on %. review_overrides non-empty=% review_overrides_archive non-empty=%',
                tbl,
                live_cnt,
                arch_cnt;
        end if;

        execute format(
            $sql$
            select count(*)::bigint
            from %s
            where review_overrides <> '{}'::jsonb
              and review_overrides_archive is distinct from review_overrides
            $sql$,
            tbl
        )
        into mismatch_cnt;

        if mismatch_cnt > 0 then
            raise exception
                '082 HS-1 STOP: % rows on % have non-empty review_overrides but archive JSON differs from live',
                mismatch_cnt,
                tbl;
        end if;

        raise notice '082 HS-1 OK: % (live=% archived=%)', tbl, live_cnt, arch_cnt;
    end loop;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- Post-apply verification (read-only; optional re-run anytime)
-- -----------------------------------------------------------------------------
-- select 'import_review.building_candidates' as tbl,
--        count(*) filter (where review_overrides <> '{}') as live,
--        count(*) filter (where review_overrides_archive <> '{}') as archived
-- from import_review.building_candidates
-- union all
-- select 'import_review.road_candidates',
--        count(*) filter (where review_overrides <> '{}'),
--        count(*) filter (where review_overrides_archive <> '{}')
-- from import_review.road_candidates;
-- -- expect live = archived per table
