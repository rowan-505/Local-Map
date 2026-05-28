-- =============================================================================
-- verify_building_type_simplification.sql
-- -----------------------------------------------------------------------------
-- Read-only verification after migration 061_ref_building_types_simplification.sql
-- (building type taxonomy flattening). Does not modify data.
--
-- Run:
--   PAGER=cat psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/verification/verify_building_type_simplification.sql
--
-- Output:
--   • "summary" — PASS/FAIL gate checks (run this first)
--   • "info_*"  — counts and distributions (informational)
-- =============================================================================

\pset pager off

-- -----------------------------------------------------------------------------
-- Expected final flat active codes (migration 061)
-- -----------------------------------------------------------------------------
drop table if exists _verify_bt_expected;
create temp table _verify_bt_expected (
    code text primary key
);

insert into _verify_bt_expected (code)
values
    ('residential'),
    ('commercial'),
    ('mixed_use'),
    ('education'),
    ('healthcare'),
    ('government_civic'),
    ('religious'),
    ('industrial'),
    ('warehouse_storage'),
    ('transport'),
    ('utility_infrastructure'),
    ('agriculture'),
    ('recreation'),
    ('military_restricted'),
    ('temporary_informal'),
    ('unknown');

-- =============================================================================
-- SUMMARY: PASS / FAIL gates
-- =============================================================================
\echo ''
\echo '=== summary (PASS / FAIL) ==='

with
prereq as (
    select
        to_regclass('ref.ref_building_types') is not null as has_ref,
        to_regclass('core.core_map_buildings') is not null as has_core,
        to_regclass('ref.ref_building_type_merge_map') is not null as has_merge_map,
        to_regclass('tiles.tiles_buildings_v') is not null as has_tiles_view,
        to_regclass('system.backup_core_map_buildings_before_building_type_simplification') is not null
            as has_buildings_backup
),
check_01_orphan_fk as (
    select count(*)::bigint as bad_count
    from core.core_map_buildings as b
    where b.building_type_id is not null
      and not exists (
          select 1
          from ref.ref_building_types as bt
          where bt.id = b.building_type_id
      )
),
check_01_merge_source_refs as (
    select
        case
            when to_regclass('ref.ref_building_type_merge_map') is null then 0::bigint
            else (
                select count(*)::bigint
                from core.core_map_buildings as b
                inner join ref.ref_building_types as bt
                    on bt.id = b.building_type_id
                inner join ref.ref_building_type_merge_map as m
                    on m.source_code = bt.code
                where b.building_type_id is not null
            )
        end as bad_count
),
check_02_mapped_codes_remain as (
    select
        case
            when to_regclass('ref.ref_building_type_merge_map') is null then 0::bigint
            else (
                select count(*)::bigint
                from ref.ref_building_types as bt
                inner join ref.ref_building_type_merge_map as m
                    on m.source_code = bt.code
            )
        end as remaining_count
),
check_03_active_flat_count as (
    select count(*)::bigint as active_flat_count
    from ref.ref_building_types as bt
    where bt.is_active is true
      and bt.parent_id is null
),
check_03_extra_active as (
    select count(*)::bigint as extra_count
    from ref.ref_building_types as bt
    where bt.is_active is true
      and bt.parent_id is null
      and not exists (
          select 1
          from _verify_bt_expected as e
          where e.code = bt.code
      )
),
check_03_missing_active as (
    select count(*)::bigint as missing_count
    from _verify_bt_expected as e
    where not exists (
        select 1
        from ref.ref_building_types as bt
        where bt.code = e.code
          and bt.is_active is true
          and bt.parent_id is null
    )
),
check_03_active_with_parent as (
    select count(*)::bigint as bad_count
    from ref.ref_building_types as bt
    where bt.is_active is true
      and bt.parent_id is not null
      and exists (
          select 1
          from _verify_bt_expected as e
          where e.code = bt.code
      )
),
check_04_tiles_bad_codes as (
    select
        case
            when to_regclass('tiles.tiles_buildings_v') is null then 0::bigint
            else (
                select count(distinct t.building_type_code)::bigint
                from tiles.tiles_buildings_v as t
                where t.building_type_code is not null
                  and t.building_type_code not in (select code from _verify_bt_expected)
            )
        end as bad_distinct_codes
),
check_04_tiles_inactive_ref as (
    select
        case
            when to_regclass('tiles.tiles_buildings_v') is null then 0::bigint
            else (
                select count(*)::bigint
                from tiles.tiles_buildings_v as t
                inner join core.core_map_buildings as b
                    on b.id = t.id
                inner join ref.ref_building_types as bt
                    on bt.id = b.building_type_id
                where bt.is_active is not true
                   or bt.parent_id is not null
            )
        end as bad_count
),
check_05_new_nulls as (
    select
        case
            when to_regclass('system.backup_core_map_buildings_before_building_type_simplification') is null
                then 0::bigint
            else (
                select count(*)::bigint
                from core.core_map_buildings as b
                where b.building_type_id is null
                  and exists (
                      select 1
                      from system.backup_core_map_buildings_before_building_type_simplification as bk
                      where bk.id = b.id
                        and bk.building_type_id is not null
                  )
            )
        end as regression_count
),
check_06_null_counts as (
    select
        count(*) filter (where b.building_type_id is null)::bigint as null_all,
        count(*) filter (
            where b.building_type_id is null
              and b.is_active is true
              and b.deleted_at is null
        )::bigint as null_active_non_deleted
    from core.core_map_buildings as b
),
check_08_unknown as (
    select
        count(*)::bigint as core_all_unknown,
        count(*) filter (
            where b.is_active is true
              and b.deleted_at is null
        )::bigint as core_active_unknown,
        case
            when to_regclass('tiles.tiles_buildings_v') is null then 0::bigint
            else (
                select count(*)::bigint
                from tiles.tiles_buildings_v as t
                where t.building_type_code = 'unknown'
            )
        end as tiles_unknown
    from core.core_map_buildings as b
    inner join ref.ref_building_types as bt
        on bt.id = b.building_type_id
    where bt.code = 'unknown'
),
check_07_inactive as (
    select count(*)::bigint as inactive_count
    from ref.ref_building_types as bt
    where bt.is_active is not true
),
checks as (
    select
        p.*,
        c01o.bad_count as c01_orphan_fk,
        c01m.bad_count as c01_merge_source_fk,
        c02.remaining_count as c02_mapped_codes_in_ref,
        c03c.active_flat_count,
        c03e.extra_count as c03_extra_active_codes,
        c03m.missing_count as c03_missing_expected_codes,
        c03p.bad_count as c03_final_codes_with_parent,
        c04b.bad_distinct_codes as c04_tiles_non_simplified_codes,
        c04i.bad_count as c04_tiles_inactive_or_child_ref,
        c05.regression_count as c05_new_null_building_type_id,
        c06.null_all,
        c06.null_active_non_deleted,
        c07.inactive_count,
        c08.core_all_unknown,
        c08.core_active_unknown,
        c08.tiles_unknown
    from prereq as p
    cross join check_01_orphan_fk as c01o
    cross join check_01_merge_source_refs as c01m
    cross join check_02_mapped_codes_remain as c02
    cross join check_03_active_flat_count as c03c
    cross join check_03_extra_active as c03e
    cross join check_03_missing_active as c03m
    cross join check_03_active_with_parent as c03p
    cross join check_04_tiles_bad_codes as c04b
    cross join check_04_tiles_inactive_ref as c04i
    cross join check_05_new_nulls as c05
    cross join check_06_null_counts as c06
    cross join check_07_inactive as c07
    cross join check_08_unknown as c08
),
gate_rows as (
    select
        1 as ord,
        '01_core_building_type_id_valid'::text as check_name,
        case
            when not (select has_ref and has_core from checks) then 'SKIP'
            when (select c01_orphan_fk + c01_merge_source_fk from checks) = 0 then 'PASS'
            else 'FAIL'
        end as status,
        case
            when not (select has_ref and has_core from checks) then 'ref.ref_building_types or core.core_map_buildings missing'
            else format(
                'orphan_fk=%s; still_on_merge_source_code=%s',
                (select c01_orphan_fk from checks),
                (select c01_merge_source_fk from checks)
            )
        end as detail
    union all
    select
        2,
        '02_no_merge_map_source_codes_in_ref',
        case
            when not (select has_ref and has_merge_map from checks) then 'SKIP'
            when (select c02_mapped_codes_in_ref from checks) = 0 then 'PASS'
            else 'FAIL'
        end,
        case
            when not (select has_ref and has_merge_map from checks) then 'ref.ref_building_type_merge_map missing'
            else format(
                'mapped_source_rows_remaining=%s (expected 0 if 061 DELETE ran; >0 means deactivate-only path)',
                (select c02_mapped_codes_in_ref from checks)
            )
        end
    union all
    select
        3,
        '03_active_flat_types_match_final_16',
        case
            when not (select has_ref from checks) then 'SKIP'
            when (select active_flat_count from checks) = 16
                 and (select c03_extra_active_codes from checks) = 0
                 and (select c03_missing_expected_codes from checks) = 0
                 and (select c03_final_codes_with_parent from checks) = 0
                then 'PASS'
            else 'FAIL'
        end,
        case
            when not (select has_ref from checks) then 'ref.ref_building_types missing'
            else format(
                'active_flat_count=%s; extra_active=%s; missing_expected=%s; final_with_parent=%s',
                (select active_flat_count from checks),
                (select c03_extra_active_codes from checks),
                (select c03_missing_expected_codes from checks),
                (select c03_final_codes_with_parent from checks)
            )
        end
    union all
    select
        4,
        '04_tiles_building_type_code_simplified_only',
        case
            when not (select has_tiles_view and has_ref and has_core from checks) then 'SKIP'
            when (select c04_tiles_non_simplified_codes from checks) = 0
                 and (select c04_tiles_inactive_or_child_ref from checks) = 0
                then 'PASS'
            else 'FAIL'
        end,
        case
            when not (select has_tiles_view from checks) then 'tiles.tiles_buildings_v missing'
            else format(
                'distinct_non_simplified_building_type_code=%s; tile_rows_with_inactive_or_child_ref=%s',
                (select c04_tiles_non_simplified_codes from checks),
                (select c04_tiles_inactive_or_child_ref from checks)
            )
        end
    union all
    select
        5,
        '05_no_new_null_building_type_id_after_backup',
        case
            when not (select has_core from checks) then 'SKIP'
            when not (select has_buildings_backup from checks) then 'SKIP'
            when (select c05_new_null_building_type_id from checks) = 0 then 'PASS'
            else 'FAIL'
        end,
        case
            when not (select has_core from checks) then 'core.core_map_buildings missing'
            when not (select has_buildings_backup from checks) then
                'system.backup_core_map_buildings_before_building_type_simplification missing (run 061 first)'
            else format(
                'buildings_that_had_type_id_now_null=%s (NULL was allowed before 061; this flags regressions only)',
                (select c05_new_null_building_type_id from checks)
            )
        end
    union all
    select
        6,
        '06_null_building_type_id_within_baseline',
        case
            when not (select has_core from checks) then 'SKIP'
            else 'INFO'
        end,
        (select format(
            'null_building_type_id_all=%s; null_among_active_non_deleted=%s (NULL allowed pre-061; not a failure by itself)',
            null_all,
            null_active_non_deleted
        ) from checks)
    union all
    select
        7,
        '07_inactive_building_types_count',
        case when not (select has_ref from checks) then 'SKIP' else 'INFO' end,
        (select format('inactive_ref_rows=%s', inactive_count) from checks)
    union all
    select
        8,
        '08_unknown_building_type_usage',
        case when not (select has_ref and has_core from checks) then 'SKIP' else 'INFO' end,
        (select format(
            'core_all_buildings=%s; core_active_non_deleted=%s; tiles_view=%s',
            core_all_unknown,
            core_active_unknown,
            coalesce(tiles_unknown, 0)
        ) from checks)
)
select
    check_name,
    status,
    detail
from (
    select
        check_name,
        status,
        detail
    from gate_rows
    union all
    select
        '99_overall'::text as check_name,
        case
            when exists (
                select 1
                from gate_rows as g
                where g.check_name ~ '^0[1-5]_'
                  and g.status = 'FAIL'
            ) then 'FAIL'
            when not exists (
                select 1
                from gate_rows as g
                where g.check_name ~ '^0[1-5]_'
                  and g.status = 'PASS'
            ) then 'SKIP'
            else 'PASS'
        end as status,
        'FAIL if any of checks 01–05 are FAIL; SKIP when all gates skipped'::text as detail
) as summary_with_overall
order by
    case when check_name = '99_overall' then 99 else 1 end,
    check_name;

-- =============================================================================
-- INFO: buildings grouped by building_type_code (active, non-deleted)
-- =============================================================================
\echo ''
\echo '=== info_buildings_by_building_type_code (active, non-deleted) ==='

select
    coalesce(bt.code, '(null building_type_id)') as building_type_code,
    count(*)::bigint as building_count
from core.core_map_buildings as b
left join ref.ref_building_types as bt
    on bt.id = b.building_type_id
where b.is_active is true
  and b.deleted_at is null
group by coalesce(bt.code, '(null building_type_id)')
order by building_count desc, building_type_code;

-- =============================================================================
-- INFO: tiles.tiles_buildings_v grouped by building_type_code
-- =============================================================================
\echo ''
\echo '=== info_tiles_by_building_type_code ==='

select
    coalesce(t.building_type_code, '(null)') as building_type_code,
    count(*)::bigint as tile_row_count
from tiles.tiles_buildings_v as t
group by coalesce(t.building_type_code, '(null)')
order by tile_row_count desc, building_type_code;

-- =============================================================================
-- INFO: inactive ref.ref_building_types (with reference counts)
-- =============================================================================
\echo ''
\echo '=== info_inactive_building_types ==='

select
    bt.code,
    bt.is_active,
    bt.parent_id is not null as has_parent,
    exists (
        select 1
        from ref.ref_building_type_merge_map as m
        where m.source_code = bt.code
    ) as is_merge_map_source,
    (select count(*)::bigint from core.core_map_buildings as b where b.building_type_id = bt.id)
        as core_building_refs,
    case
        when to_regclass('import_review.building_candidates') is null then null::bigint
        else (
            select count(*)::bigint
            from import_review.building_candidates as c
            where c.building_type_id = bt.id
        )
    end as import_review_candidate_refs
from ref.ref_building_types as bt
where bt.is_active is not true
order by bt.code;

-- =============================================================================
-- INFO: merge-map source codes still present (should be empty after DELETE)
-- =============================================================================
\echo ''
\echo '=== info_merge_map_sources_still_in_ref ==='

select
    bt.code as obsolete_source_code,
    bt.is_active,
    m.target_code as mapped_to
from ref.ref_building_types as bt
inner join ref.ref_building_type_merge_map as m
    on m.source_code = bt.code
order by bt.code;

-- =============================================================================
-- INFO: active flat ref rows (expect 16)
-- =============================================================================
\echo ''
\echo '=== info_active_flat_ref_building_types ==='

select
    bt.code,
    bt.name,
    bt.parent_id,
    bt.is_active,
    bt.sort_order
from ref.ref_building_types as bt
where bt.is_active is true
  and bt.parent_id is null
order by bt.sort_order nulls last, bt.code;

-- =============================================================================
-- INFO: non-simplified building_type_code values in tiles (if any)
-- =============================================================================
\echo ''
\echo '=== info_tiles_non_simplified_building_type_codes ==='

select distinct
    t.building_type_code,
    count(*)::bigint as row_count
from tiles.tiles_buildings_v as t
where t.building_type_code is not null
  and t.building_type_code not in (select code from _verify_bt_expected)
group by t.building_type_code
order by row_count desc, t.building_type_code;

-- =============================================================================
-- INFO: buildings that lost building_type_id since backup (regression detail)
-- =============================================================================
\echo ''
\echo '=== info_buildings_newly_null_building_type_id ==='

select
    b.id,
    b.public_id,
    bk.building_type_id::text as backup_building_type_id
from core.core_map_buildings as b
inner join system.backup_core_map_buildings_before_building_type_simplification as bk
    on bk.id = b.id
where b.building_type_id is null
  and bk.building_type_id is not null
  and to_regclass('system.backup_core_map_buildings_before_building_type_simplification') is not null
order by b.id
limit 50;

\echo ''
\echo 'Done. Review summary: any FAIL row requires investigation.'
