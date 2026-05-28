-- =============================================================================
-- Rollback for 061_ref_building_types_simplification.sql
-- =============================================================================
--
-- WARNING — read before running:
--
--   Use ONLY when migration 061 caused problems and production/dashboard/API
--   workflows do not yet depend on the simplified 16-code building taxonomy.
--
--   Do NOT run if:
--     - New buildings were promoted or edited expecting simplified type codes.
--     - Import review, tiles, or API clients were updated to use flat types only.
--     - You need to preserve building_type_migrated_at lineage in normalized_data.
--
--   This script restores state from one-time backups taken at the start of 061.
--   It does NOT drop ref.ref_building_type_merge_map (audit trail).
--
--   Buildings: only rows whose id exists in the backup table are updated.
--   Buildings created after the backup are left unchanged.
--
-- Requires:
--   system.backup_ref_building_types_before_simplification
--   system.backup_core_map_buildings_before_building_type_simplification
--
-- Apply manually in SQL Editor (not part of numbered forward migration chain).
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Preflight: backups must exist and contain data
-- ---------------------------------------------------------------------------
do $$
declare
    ref_backup_rows bigint;
    building_backup_rows bigint;
begin
    if to_regclass('system.backup_ref_building_types_before_simplification') is null then
        raise exception '061 rollback: missing system.backup_ref_building_types_before_simplification (run forward 061 first).';
    end if;

    if to_regclass('system.backup_core_map_buildings_before_building_type_simplification') is null then
        raise exception '061 rollback: missing system.backup_core_map_buildings_before_building_type_simplification (run forward 061 first).';
    end if;

    select count(*)::bigint
    into ref_backup_rows
    from system.backup_ref_building_types_before_simplification;

    select count(*)::bigint
    into building_backup_rows
    from system.backup_core_map_buildings_before_building_type_simplification;

    if ref_backup_rows = 0 then
        raise exception '061 rollback: ref backup table is empty; cannot restore taxonomy.';
    end if;

    if building_backup_rows = 0 then
        raise notice '061 rollback: building backup has 0 rows (no building_type_id at backup time); ref restore only.';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Restore ref.ref_building_types (parents first, then children)
-- ---------------------------------------------------------------------------
-- Re-insert or update every backed-up row by primary key id. Parent rows must
-- exist before child parent_id FKs are applied.
insert into ref.ref_building_types as cur (
    id,
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_active,
    created_at,
    updated_at
)
select
    b.id,
    b.code,
    b.name,
    b.name_mm,
    b.parent_id,
    b.sort_order,
    b.is_active,
    b.created_at,
    b.updated_at
from system.backup_ref_building_types_before_simplification as b
where b.parent_id is null
on conflict (id) do update
set
    code = excluded.code,
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

insert into ref.ref_building_types as cur (
    id,
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_active,
    created_at,
    updated_at
)
select
    b.id,
    b.code,
    b.name,
    b.name_mm,
    b.parent_id,
    b.sort_order,
    b.is_active,
    b.created_at,
    b.updated_at
from system.backup_ref_building_types_before_simplification as b
where b.parent_id is not null
  and exists (
      select 1
      from ref.ref_building_types as parent_bt
      where parent_bt.id = b.parent_id
  )
on conflict (id) do update
set
    code = excluded.code,
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- Rows whose parent_id could not be restored (unexpected) — surface in logs
do $$
declare
    orphan_children bigint;
begin
    select count(*)::bigint
    into orphan_children
    from system.backup_ref_building_types_before_simplification as b
    where b.parent_id is not null
      and not exists (
          select 1
          from ref.ref_building_types as live
          where live.id = b.id
      );

    if orphan_children > 0 then
        raise warning '061 rollback: % backed-up child building type row(s) were not restored (missing parent in ref).',
            orphan_children;
    end if;
end $$;

-- Keep bigserial sequence ahead of max(id) after re-inserting explicit ids
select setval(
    pg_get_serial_sequence('ref.ref_building_types', 'id'),
    coalesce((select max(id) from ref.ref_building_types), 1),
    true
);

-- ---------------------------------------------------------------------------
-- 2. Restore core.core_map_buildings for backed-up ids only
-- ---------------------------------------------------------------------------
-- Match on building primary key id only — never touch rows absent from backup.
update core.core_map_buildings as live
set
    building_type_id = bk.building_type_id,
    normalized_data = bk.normalized_data,
    updated_at = now()
from system.backup_core_map_buildings_before_building_type_simplification as bk
where live.id = bk.id
  and (
      bk.building_type_id is null
      or exists (
          select 1
          from ref.ref_building_types as bt
          where bt.id = bk.building_type_id
      )
  );

do $$
declare
    skipped_buildings bigint;
begin
    select count(*)::bigint
    into skipped_buildings
    from system.backup_core_map_buildings_before_building_type_simplification as bk
    where bk.building_type_id is not null
      and not exists (
          select 1
          from ref.ref_building_types as bt
          where bt.id = bk.building_type_id
      );

    if skipped_buildings > 0 then
        raise exception
            '061 rollback: % backed-up building row(s) reference building_type_id not present in ref after restore',
            skipped_buildings;
    end if;
end $$;

commit;

-- =============================================================================
-- Post-rollback checks (manual)
-- =============================================================================
--
-- -- Restored ref row count vs backup
-- select
--     (select count(*) from system.backup_ref_building_types_before_simplification) as backup_ref_rows,
--     (select count(*) from ref.ref_building_types r
--      where exists (
--          select 1 from system.backup_ref_building_types_before_simplification b where b.id = r.id
--      )) as live_ref_rows_matching_backup_ids;
--
-- -- Buildings restored (only ids present in backup)
-- select count(*) as buildings_in_backup
-- from system.backup_core_map_buildings_before_building_type_simplification;
--
-- select count(*) as buildings_restored_match
-- from core.core_map_buildings live
-- join system.backup_core_map_buildings_before_building_type_simplification bk on bk.id = live.id
-- where live.building_type_id is not distinct from bk.building_type_id
--   and live.normalized_data is not distinct from bk.normalized_data;
--
-- -- Optional: review migration-only codes still present (manual cleanup)
-- select code, is_active from ref.ref_building_types
-- where code in ('warehouse_storage', 'recreation')
--   and not exists (
--       select 1 from system.backup_ref_building_types_before_simplification b where b.code = ref.ref_building_types.code
--   );
