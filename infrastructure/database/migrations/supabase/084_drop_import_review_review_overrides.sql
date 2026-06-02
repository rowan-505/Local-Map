-- =============================================================================
-- Supabase migration 084: drop import_review.review_overrides (Phase 9)
-- =============================================================================
--
-- Purpose:
--   Remove live review_overrides JSON columns after Phase 8 app cleanup.
--   Keep review_overrides_archive as immutable history.
--
-- Safety:
--   - Aborts transaction if any candidate table still has non-empty review_overrides.
--   - Skips missing tables with NOTICE (no failure).
--   - Drops column only after all checks pass.
--
-- Prerequisites:
--   - Gate D PASS in apps (no runtime dependency on review_overrides).
--   - review_overrides_archive already exists (migration 082).
--
-- Rollback:
--   - Re-add review_overrides jsonb not null default '{}'::jsonb to affected tables.
--   - Restore data from review_overrides_archive where needed.
--
-- =============================================================================

begin;

do $$
declare
    tbl text;
    non_empty_count bigint;
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
        raise exception '084: schema import_review does not exist.';
    end if;

    foreach tbl in array tables
    loop
        if to_regclass(tbl) is null then
            raise notice '084: skipped % (table does not exist)', tbl;
            continue;
        end if;

        -- If column is already absent, continue safely.
        if not exists (
            select 1
            from information_schema.columns c
            where c.table_schema = split_part(tbl, '.', 1)
              and c.table_name = split_part(tbl, '.', 2)
              and c.column_name = 'review_overrides'
        ) then
            raise notice '084: skipped %.review_overrides (column already absent)', tbl;
            continue;
        end if;

        execute format(
            'select count(*)::bigint from %s where review_overrides <> %L::jsonb',
            tbl,
            '{}'
        )
        into non_empty_count;

        if non_empty_count > 0 then
            raise exception
                '084 STOP: %.review_overrides has % non-empty rows; cleanup/clear required before drop.',
                tbl,
                non_empty_count;
        end if;
    end loop;
end $$;

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
    foreach tbl in array tables
    loop
        if to_regclass(tbl) is null then
            continue;
        end if;

        execute format(
            'alter table %s drop column if exists review_overrides',
            tbl
        );

        raise notice '084: dropped %.review_overrides', tbl;
    end loop;
end $$;

commit;

