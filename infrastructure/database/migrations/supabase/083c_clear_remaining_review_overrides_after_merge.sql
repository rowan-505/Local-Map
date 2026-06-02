-- =============================================================================
-- Supabase migration 083c: clear remaining legacy review_overrides blockers
-- =============================================================================
--
-- Purpose:
--   Unblock 084 by clearing remaining non-empty review_overrides in:
--     - import_review.road_candidates
--     - import_review.place_candidates
--     - import_review.bus_stop_candidates
--
-- Safety:
--   - Requires table + review_overrides + review_overrides_archive columns.
--   - Backfills row-level review_overrides_archive when missing/empty.
--   - Clears only rows where review_overrides is non-empty.
--   - Asserts zero non-empty review_overrides after update for each table.
--   - Emits per-table NOTICE metrics for auditability.
--
-- Rollback notes:
--   update import_review.<table>
--   set review_overrides = review_overrides_archive
--   where coalesce(review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb;
--
-- =============================================================================

begin;

do $$
declare
    tbl text;
    tables constant text[] := array[
        'road_candidates',
        'place_candidates',
        'bus_stop_candidates'
    ];

    has_table boolean;
    has_review_overrides_col boolean;
    has_review_overrides_archive_col boolean;

    rows_to_clear bigint;
    rows_backfilled_archive bigint;
    archive_coverage_after_backfill bigint;
    rows_cleared bigint;
    remaining_non_empty bigint;
begin
    if to_regnamespace('import_review') is null then
        raise exception '083c STOP: schema import_review does not exist.';
    end if;

    foreach tbl in array tables
    loop
        select to_regclass(format('import_review.%I', tbl)) is not null
        into has_table;

        if not has_table then
            raise exception '083c STOP: import_review.% does not exist.', tbl;
        end if;

        select exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = tbl
              and column_name = 'review_overrides'
        )
        into has_review_overrides_col;

        if not has_review_overrides_col then
            raise exception '083c STOP: import_review.%.review_overrides does not exist.', tbl;
        end if;

        select exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = tbl
              and column_name = 'review_overrides_archive'
        )
        into has_review_overrides_archive_col;

        if not has_review_overrides_archive_col then
            raise exception '083c STOP: import_review.%.review_overrides_archive does not exist.', tbl;
        end if;

        execute format(
            $sql$
            select count(*)::bigint
            from import_review.%I x
            where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
            $sql$,
            tbl
        )
        into rows_to_clear;

        raise notice '083c [%]: rows_to_clear=%', tbl, rows_to_clear;

        if rows_to_clear = 0 then
            raise notice '083c [%]: no-op (already clear)', tbl;
            continue;
        end if;

        -- Backfill row-level archive only for rows still carrying live overrides.
        execute format(
            $sql$
            update import_review.%I x
            set review_overrides_archive = x.review_overrides
            where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
              and coalesce(x.review_overrides_archive, '{}'::jsonb) = '{}'::jsonb
            $sql$,
            tbl
        );
        get diagnostics rows_backfilled_archive = row_count;
        raise notice '083c [%]: rows_backfilled_archive=%', tbl, rows_backfilled_archive;

        execute format(
            $sql$
            select count(*)::bigint
            from import_review.%I x
            where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
              and coalesce(x.review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb
            $sql$,
            tbl
        )
        into archive_coverage_after_backfill;

        if archive_coverage_after_backfill <> rows_to_clear then
            raise exception
                '083c STOP [%]: archive coverage mismatch after backfill. rows_to_clear=% covered=%',
                tbl,
                rows_to_clear,
                archive_coverage_after_backfill;
        end if;

        execute format(
            $sql$
            update import_review.%I x
            set review_overrides = '{}'::jsonb
            where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
            $sql$,
            tbl
        );
        get diagnostics rows_cleared = row_count;
        raise notice '083c [%]: rows_cleared=%', tbl, rows_cleared;

        execute format(
            $sql$
            select count(*)::bigint
            from import_review.%I x
            where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
            $sql$,
            tbl
        )
        into remaining_non_empty;

        if remaining_non_empty <> 0 then
            raise exception
                '083c STOP [%]: post-clear assertion failed. remaining_non_empty=%',
                tbl,
                remaining_non_empty;
        end if;

        raise notice '083c [%]: SUCCESS', tbl;
    end loop;
end $$;

commit;
