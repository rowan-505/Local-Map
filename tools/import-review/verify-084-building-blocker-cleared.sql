-- =============================================================================
-- Read-only verification: building_candidates blocker cleared for migration 084
-- File: tools/import-review/verify-084-building-blocker-cleared.sql
-- Supabase SQL Editor compatible
-- =============================================================================
--
-- Goal:
-- Confirm import_review.building_candidates no longer blocks 084.
--
-- Outputs:
-- 1) non-empty review_overrides count
-- 2) archive count for building_candidates
-- 3) top keys still in review_overrides (if any)
-- 4) whether review_overrides column exists
-- 5) whether review_overrides_archive exists
-- 6) final PASS/FAIL status row
--
-- Read-only only.
-- =============================================================================

-- 0) Column/table existence flags
with flags as (
    select
        to_regclass('import_review.building_candidates') is not null as has_building_candidates,
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides'
        ) as has_review_overrides_column,
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides_archive'
        ) as has_review_overrides_archive_column,
        to_regclass('import_review.review_overrides_archive') is not null as has_central_archive_table
)
select *
from flags;

-- 1) building_candidates non-empty review_overrides count
do $$
declare
    has_building_candidates boolean;
    has_review_overrides_col boolean;
    non_empty_count bigint;
begin
    select to_regclass('import_review.building_candidates') is not null
    into has_building_candidates;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides'
    )
    into has_review_overrides_col;

    if has_building_candidates and has_review_overrides_col then
        execute $sql$
            select count(*)::bigint
            from import_review.building_candidates
            where coalesce(review_overrides, '{}'::jsonb) <> '{}'::jsonb
        $sql$
        into non_empty_count;

        raise notice '1) non_empty_review_overrides_count=%', non_empty_count;
    else
        raise notice '1) skipped: building_candidates or review_overrides column missing.';
    end if;
end $$;

-- 2) archive count for building_candidates
-- 2a) row-level archive column count (if exists)
do $$
declare
    has_row_archive_col boolean;
    row_archive_count bigint;
begin
    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides_archive'
    )
    into has_row_archive_col;

    if has_row_archive_col then
        execute $sql$
            select count(*)::bigint
            from import_review.building_candidates
            where coalesce(review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb
        $sql$
        into row_archive_count;

        raise notice '2a) row_archive_non_empty_count=%', row_archive_count;
    else
        raise notice '2a) row-level review_overrides_archive column missing.';
    end if;
end $$;

-- 2b) central archive table count for candidate_table='building_candidates' (if exists)
do $$
declare
    has_central_archive boolean;
    central_archive_count bigint;
begin
    select to_regclass('import_review.review_overrides_archive') is not null
    into has_central_archive;

    if has_central_archive then
        execute $sql$
            select count(*)::bigint
            from import_review.review_overrides_archive
            where candidate_table = 'building_candidates'
        $sql$
        into central_archive_count;

        raise notice '2b) central_archive_building_candidates_count=%', central_archive_count;
    else
        raise notice '2b) central archive table missing.';
    end if;
end $$;

-- 3) Top keys still in review_overrides (if any)
do $$
declare
    has_building_candidates boolean;
    has_review_overrides_col boolean;
begin
    select to_regclass('import_review.building_candidates') is not null
    into has_building_candidates;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides'
    )
    into has_review_overrides_col;

    if has_building_candidates and has_review_overrides_col then
        raise notice '3) top remaining keys returned by next SELECT.';
    else
        raise notice '3) skipped: building_candidates or review_overrides column missing.';
    end if;
end $$;

select
    k.key as review_overrides_key,
    count(*)::bigint as row_count
from import_review.building_candidates b
cross join lateral jsonb_object_keys(coalesce(b.review_overrides, '{}'::jsonb)) as k(key)
where exists (
    select 1
    from information_schema.columns
    where table_schema = 'import_review'
      and table_name = 'building_candidates'
      and column_name = 'review_overrides'
)
group by k.key
order by row_count desc, review_overrides_key asc
limit 50;

-- 4 + 5 + 6) Final status row
with flags as (
    select
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides'
        ) as has_review_overrides_column,
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides_archive'
        ) as has_review_overrides_archive_column
),
counts as (
    select
        case
            when f.has_review_overrides_column then (
                select count(*)::bigint
                from import_review.building_candidates b
                where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
            )
            else 0::bigint
        end as non_empty_review_overrides_count
    from flags f
)
select
    c.non_empty_review_overrides_count,
    f.has_review_overrides_column,
    f.has_review_overrides_archive_column,
    case
        when c.non_empty_review_overrides_count = 0 then 'PASS'
        else 'FAIL'
    end as final_status
from counts c
cross join flags f;

