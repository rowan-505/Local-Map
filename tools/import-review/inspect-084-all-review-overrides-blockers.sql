-- =============================================================================
-- Read-only inspection: all review_overrides blockers before rerunning 084
-- File: tools/import-review/inspect-084-all-review-overrides-blockers.sql
-- Supabase SQL Editor compatible
-- =============================================================================
--
-- Goal:
-- Inspect all import_review candidate tables for remaining non-empty review_overrides.
--
-- Tables:
-- - address_candidates
-- - admin_area_candidates
-- - building_candidates
-- - bus_route_candidates
-- - bus_route_stop_candidates
-- - bus_route_variant_candidates
-- - bus_stop_candidates
-- - landuse_candidates
-- - place_candidates
-- - road_candidates
-- - routing_barrier_candidates
-- - routing_turn_restriction_candidates
-- - water_line_candidates
-- - water_polygon_candidates
--
-- Outputs:
-- 1) Summary result table
-- 2) Detailed key frequencies for tables with non-empty rows
-- 3) Final PASS/FAIL status
--
-- Notes:
-- - Row archive = per-table review_overrides_archive column (migration 082).
-- - Central archive table import_review.review_overrides_archive is optional;
--   counts use dynamic SQL only when that relation exists (never parsed otherwise).
--
-- Read-only only.
-- =============================================================================

drop table if exists _084_inspect_summary;
create temp table _084_inspect_summary (
    table_name text not null primary key,
    table_exists boolean not null,
    has_review_overrides_column boolean not null,
    non_empty_review_overrides_count bigint,
    has_row_archive_column boolean not null,
    row_archive_non_empty_count bigint,
    has_central_archive_table boolean not null,
    central_archive_count bigint
);

drop table if exists _084_inspect_keys;
create temp table _084_inspect_keys (
    table_name text not null,
    review_overrides_key text not null,
    row_count bigint not null
);

do $$
declare
  tbl text;
  tables constant text[] := array[
    'address_candidates',
    'admin_area_candidates',
    'building_candidates',
    'bus_route_candidates',
    'bus_route_stop_candidates',
    'bus_route_variant_candidates',
    'bus_stop_candidates',
    'landuse_candidates',
    'place_candidates',
    'road_candidates',
    'routing_barrier_candidates',
    'routing_turn_restriction_candidates',
    'water_line_candidates',
    'water_polygon_candidates'
  ];
  rel_exists boolean;
  has_review_overrides_col boolean;
  has_row_archive_col boolean;
  has_central_archive boolean;
  non_empty_count bigint;
  row_archive_count bigint;
  central_count bigint;
begin
  select to_regclass('import_review.review_overrides_archive') is not null
  into has_central_archive;

  foreach tbl in array tables
  loop
    rel_exists := to_regclass(format('import_review.%I', tbl)) is not null;

    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'import_review'
        and c.table_name = tbl
        and c.column_name = 'review_overrides'
    )
    into has_review_overrides_col;

    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'import_review'
        and c.table_name = tbl
        and c.column_name = 'review_overrides_archive'
    )
    into has_row_archive_col;

    non_empty_count := null;
    row_archive_count := null;
    central_count := null;

    if rel_exists and has_review_overrides_col then
      execute format(
        $sql$
        select count(*)::bigint
        from import_review.%I x
        where coalesce(x.review_overrides, '{}'::jsonb) <> '{}'::jsonb
        $sql$,
        tbl
      )
      into non_empty_count;
    end if;

    if rel_exists and has_row_archive_col then
      execute format(
        $sql$
        select count(*)::bigint
        from import_review.%I x
        where coalesce(x.review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb
        $sql$,
        tbl
      )
      into row_archive_count;
    end if;

    if has_central_archive then
      execute
        $sql$
        select count(*)::bigint
        from import_review.review_overrides_archive
        where candidate_table = $1
        $sql$
      into central_count
      using tbl;
    end if;

    if non_empty_count is not null and non_empty_count > 0 then
      execute format(
        $sql$
        insert into _084_inspect_keys (table_name, review_overrides_key, row_count)
        select
          %L::text as table_name,
          k.key as review_overrides_key,
          count(*)::bigint as row_count
        from import_review.%I b
        cross join lateral jsonb_object_keys(coalesce(b.review_overrides, '{}'::jsonb)) as k(key)
        where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
        group by k.key
        $sql$,
        tbl,
        tbl
      );
    end if;

    insert into _084_inspect_summary (
      table_name,
      table_exists,
      has_review_overrides_column,
      non_empty_review_overrides_count,
      has_row_archive_column,
      row_archive_non_empty_count,
      has_central_archive_table,
      central_archive_count
    )
    values (
      tbl,
      rel_exists,
      has_review_overrides_col,
      non_empty_count,
      has_row_archive_col,
      row_archive_count,
      has_central_archive,
      central_count
    );
  end loop;
end $$;

-- 1) Summary table -------------------------------------------------------------
select
  table_name,
  table_exists,
  has_review_overrides_column,
  non_empty_review_overrides_count,
  has_row_archive_column,
  row_archive_non_empty_count,
  has_central_archive_table,
  central_archive_count
from _084_inspect_summary
order by table_name;

-- 2) Detailed key frequencies for non-empty tables -----------------------------
select
  table_name,
  review_overrides_key,
  row_count
from _084_inspect_keys
order by table_name, row_count desc, review_overrides_key asc;

-- 3) Final PASS/FAIL status ----------------------------------------------------
with totals as (
  select
    count(*)::bigint as inspected_tables,
    coalesce(sum(non_empty_review_overrides_count), 0)::bigint as total_non_empty_rows,
    count(*) filter (
      where coalesce(non_empty_review_overrides_count, 0) > 0
    )::bigint as blocking_tables
  from _084_inspect_summary
  where table_exists
    and has_review_overrides_column
)
select
  inspected_tables,
  blocking_tables,
  total_non_empty_rows,
  case
    when blocking_tables = 0 then 'PASS'
    else 'FAIL'
  end as final_status
from totals;
