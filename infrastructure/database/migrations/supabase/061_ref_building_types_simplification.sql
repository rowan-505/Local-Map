-- =============================================================================
-- Supabase migration 061: simplify ref.ref_building_types to a flat active set
-- =============================================================================
--
-- Purpose:
--   Collapse detailed child building types into 16 top-level active codes,
--   remap core.core_map_buildings.building_type_id, preserve prior type lineage
--   in normalized_data, and remove obsolete ref rows only when unreferenced.
--
-- Safety:
--   - Preflight: enumerate FKs referencing ref.ref_building_types.
--   - Backups in system.* before mutating ref or core buildings.
--   - No DELETE until dynamic FK scan finds zero references to mapped source ids.
--   - Idempotent upserts; backups skipped when already populated.
--
-- Does NOT:
--   - Drop ref.ref_building_types.
--   - Alter core.core_map_buildings columns (only data updates).
--
-- Depends on: 010_ref_building_types.sql, 024_create_import_review_schema.sql (optional FK).
--
-- Rollback (manual, not auto-applied):
--   infrastructure/database/migrations/supabase/061_ref_building_types_simplification.rollback.sql
--
-- =============================================================================

begin;

create schema if not exists ref;
create schema if not exists system;

-- ---------------------------------------------------------------------------
-- 0. Preflight: FKs referencing ref.ref_building_types
-- ---------------------------------------------------------------------------
do $$
declare
    fk_rec record;
    fk_count integer := 0;
begin
    if to_regclass('ref.ref_building_types') is null then
        raise exception '061: ref.ref_building_types does not exist; run 010_ref_building_types.sql first.';
    end if;

    raise notice '061 preflight: foreign keys referencing ref.ref_building_types';
    for fk_rec in
        select
            c.conname as constraint_name,
            c.conrelid::regclass as referencing_table,
            (
                select array_agg(a.attname order by u.ord)
                from unnest(c.conkey) with ordinality as u(attnum, ord)
                join pg_attribute a
                    on a.attrelid = c.conrelid
                   and a.attnum = u.attnum
            ) as referencing_columns
        from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = 'ref.ref_building_types'::regclass
        order by 2::text, 1
    loop
        fk_count := fk_count + 1;
        raise notice '  FK % on %.%',
            fk_rec.constraint_name,
            fk_rec.referencing_table,
            array_to_string(fk_rec.referencing_columns, ', ');
    end loop;

    if fk_count = 0 then
        raise notice '  (no foreign keys found — unexpected if 010 was applied)';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Backup tables (idempotent: CTAS shell + one-time data copy)
-- ---------------------------------------------------------------------------
create table if not exists system.backup_ref_building_types_before_simplification as
select
    now() as backed_up_at,
    bt.*
from ref.ref_building_types as bt
where false;

insert into system.backup_ref_building_types_before_simplification
select
    now() as backed_up_at,
    bt.*
from ref.ref_building_types as bt
where not exists (
    select 1
    from system.backup_ref_building_types_before_simplification as b
    limit 1
);

create table if not exists system.backup_core_map_buildings_before_building_type_simplification as
select
    now() as backed_up_at,
    b.id,
    b.building_type_id,
    b.normalized_data
from core.core_map_buildings as b
where false;

insert into system.backup_core_map_buildings_before_building_type_simplification
select
    now() as backed_up_at,
    b.id,
    b.building_type_id,
    b.normalized_data
from core.core_map_buildings as b
where b.building_type_id is not null
  and not exists (
      select 1
      from system.backup_core_map_buildings_before_building_type_simplification as bk
      limit 1
  );

-- ---------------------------------------------------------------------------
-- 2. Merge map (source detailed/obsolete code -> final active code)
-- ---------------------------------------------------------------------------
create table if not exists ref.ref_building_type_merge_map (
    source_code text primary key,
    target_code text not null,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ref_building_type_merge_map_source_code_format_chk
        check (btrim(source_code) <> '' and source_code ~ '^[a-z][a-z0-9_]*$'),
    constraint ref_building_type_merge_map_target_code_format_chk
        check (btrim(target_code) <> '' and target_code ~ '^[a-z][a-z0-9_]*$'),
    constraint ref_building_type_merge_map_no_self_merge_chk
        check (source_code <> target_code)
);

create index if not exists ref_building_type_merge_map_target_code_idx
    on ref.ref_building_type_merge_map (target_code);

comment on table ref.ref_building_type_merge_map is
    'One-time simplification map: obsolete/detailed ref_building_types.code -> flat active target code.';

insert into ref.ref_building_type_merge_map (source_code, target_code, notes)
values
    -- residential
    ('house', 'residential', '010 child -> flat residential'),
    ('apartment', 'residential', null),
    ('dormitory', 'residential', null),
    ('townhouse', 'residential', null),
    ('villa', 'residential', null),
    -- commercial
    ('office', 'commercial', null),
    ('retail', 'commercial', null),
    ('shopping_mall', 'commercial', null),
    ('supermarket', 'commercial', null),
    ('market', 'commercial', null),
    ('hotel', 'commercial', null),
    ('restaurant_building', 'commercial', null),
    ('showroom', 'commercial', null),
    -- education
    ('school', 'education', null),
    ('university', 'education', null),
    ('library', 'education', null),
    ('training_center', 'education', null),
    -- healthcare
    ('hospital', 'healthcare', null),
    ('clinic', 'healthcare', null),
    ('pharmacy_building', 'healthcare', null),
    ('laboratory', 'healthcare', null),
    ('health_center', 'healthcare', null),
    -- government / civic
    ('government_office', 'government_civic', null),
    ('township_office', 'government_civic', null),
    ('courthouse', 'government_civic', null),
    ('police_station', 'government_civic', null),
    ('fire_station', 'government_civic', null),
    ('post_office', 'government_civic', null),
    ('community_center', 'government_civic', null),
    -- religious
    ('pagoda', 'religious', null),
    ('monastery', 'religious', null),
    ('church', 'religious', null),
    ('mosque', 'religious', null),
    ('temple', 'religious', null),
    ('religious_complex', 'religious', null),
    -- industrial
    ('factory', 'industrial', null),
    ('workshop', 'industrial', null),
    ('processing_plant', 'industrial', null),
    -- warehouse (was industrial child in 010; final type is warehouse_storage)
    ('warehouse', 'warehouse_storage', '010 child under industrial -> warehouse_storage'),
    -- transport
    ('bus_terminal', 'transport', null),
    ('train_station', 'transport', null),
    ('ferry_terminal', 'transport', null),
    ('airport_terminal', 'transport', null),
    ('parking_structure', 'transport', null),
    ('depot', 'transport', null),
    -- agriculture
    ('farm_building', 'agriculture', null),
    ('barn', 'agriculture', null),
    ('greenhouse', 'agriculture', null),
    ('livestock_structure', 'agriculture', null),
    -- recreation (parent code renamed recreation_entertainment -> recreation)
    ('recreation_entertainment', 'recreation', '010 parent slug retired'),
    ('stadium', 'recreation', null),
    ('cinema', 'recreation', null),
    ('gym', 'recreation', null),
    ('recreation_center', 'recreation', null),
    -- utility / infrastructure
    ('telecom', 'utility_infrastructure', null),
    ('water_facility', 'utility_infrastructure', null),
    ('electrical_substation', 'utility_infrastructure', null),
    ('sewage_facility', 'utility_infrastructure', null),
    ('waste_management', 'utility_infrastructure', null),
    -- military / restricted
    ('military', 'military_restricted', null),
    ('checkpoint', 'military_restricted', null),
    ('restricted_facility', 'military_restricted', null),
    -- mixed use
    ('mixed_use_lowrise', 'mixed_use', null),
    ('mixed_use_highrise', 'mixed_use', null),
    ('integrated_complex', 'mixed_use', null),
    -- temporary / informal
    ('temporary_structure', 'temporary_informal', null),
    ('kiosk', 'temporary_informal', null),
    ('market_stall', 'temporary_informal', null),
    ('informal_structure', 'temporary_informal', null),
    -- unknown
    ('generic_building', 'unknown', null),
    ('unclassified', 'unknown', null)
on conflict (source_code) do update
set
    target_code = excluded.target_code,
    notes = coalesce(excluded.notes, ref.ref_building_type_merge_map.notes),
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Upsert final flat active building types (parent_id null)
-- ---------------------------------------------------------------------------
insert into ref.ref_building_types (code, name, name_mm, parent_id, sort_order, is_active)
values
    ('residential', 'Residential', null, null, 10, true),
    ('commercial', 'Commercial', null, null, 20, true),
    ('mixed_use', 'Mixed use', null, null, 30, true),
    ('education', 'Education', null, null, 40, true),
    ('healthcare', 'Healthcare', null, null, 50, true),
    ('government_civic', 'Government / Civic', null, null, 60, true),
    ('religious', 'Religious', null, null, 70, true),
    ('industrial', 'Industrial', null, null, 80, true),
    ('warehouse_storage', 'Warehouse / Storage', null, null, 90, true),
    ('transport', 'Transport', null, null, 100, true),
    ('utility_infrastructure', 'Utility / Infrastructure', null, null, 110, true),
    ('agriculture', 'Agriculture', null, null, 120, true),
    ('recreation', 'Recreation', null, null, 130, true),
    ('military_restricted', 'Military / Restricted', null, null, 140, true),
    ('temporary_informal', 'Temporary / Informal', null, null, 150, true),
    ('unknown', 'Unknown', null, null, 160, true)
on conflict (code) do update
set
    name = excluded.name,
    parent_id = null,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Detach hierarchy pointers to rows slated for removal (self-FK safety)
-- ---------------------------------------------------------------------------
update ref.ref_building_types as child
set
    parent_id = null,
    updated_at = now()
from ref.ref_building_type_merge_map as m
where child.parent_id is not null
  and exists (
      select 1
      from ref.ref_building_types as parent_bt
      where parent_bt.id = child.parent_id
        and parent_bt.code = m.source_code
  );

-- ---------------------------------------------------------------------------
-- 5. Remap core.core_map_buildings + preserve prior type in normalized_data
-- ---------------------------------------------------------------------------
with remap as (
    select
        b.id as building_id,
        src.id as previous_building_type_id,
        src.code as previous_building_type_code,
        tgt.id as new_building_type_id,
        tgt.code as new_building_type_code
    from core.core_map_buildings as b
    inner join ref.ref_building_types as src
        on src.id = b.building_type_id
    inner join ref.ref_building_type_merge_map as m
        on m.source_code = src.code
    inner join ref.ref_building_types as tgt
        on tgt.code = m.target_code
    where b.building_type_id is not null
)
update core.core_map_buildings as b
set
    building_type_id = r.new_building_type_id,
    normalized_data = coalesce(b.normalized_data, '{}'::jsonb)
        || jsonb_strip_nulls(
            jsonb_build_object(
                'previous_building_type_id', r.previous_building_type_id,
                'previous_building_type_code', r.previous_building_type_code,
                'new_building_type_id', r.new_building_type_id,
                'new_building_type_code', r.new_building_type_code,
                'building_type_migrated_at', to_jsonb(now())
            )
        ),
    updated_at = now()
from remap as r
where b.id = r.building_id;

-- ---------------------------------------------------------------------------
-- 6. Post-remap verification (core buildings must not reference merge sources)
-- ---------------------------------------------------------------------------
do $$
declare
    stray_count bigint;
begin
    select count(*)::bigint
    into stray_count
    from core.core_map_buildings as b
    inner join ref.ref_building_types as src
        on src.id = b.building_type_id
    inner join ref.ref_building_type_merge_map as m
        on m.source_code = src.code
    where b.building_type_id is not null;

    if stray_count > 0 then
        raise exception
            '061: % core.core_map_buildings row(s) still reference obsolete building type codes after remap',
            stray_count;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Flatten any remaining parent_id on final active codes
-- ---------------------------------------------------------------------------
update ref.ref_building_types as bt
set
    parent_id = null,
    updated_at = now()
where bt.code in (
    'residential',
    'commercial',
    'mixed_use',
    'education',
    'healthcare',
    'government_civic',
    'religious',
    'industrial',
    'warehouse_storage',
    'transport',
    'utility_infrastructure',
    'agriculture',
    'recreation',
    'military_restricted',
    'temporary_informal',
    'unknown'
)
  and bt.parent_id is not null;

-- ---------------------------------------------------------------------------
-- 8. Delete obsolete mapped types — guarded by dynamic FK reference scan
-- ---------------------------------------------------------------------------
-- Hard-coded table checks drift as schemas grow (e.g. import_review today, another
-- module tomorrow). Before DELETE, discover every FK to ref.ref_building_types from
-- pg_catalog and count rows pointing at mapped *source* type ids. Abort if any
-- referencing table still holds references so we never break FK integrity.
do $$
declare
    fk_rec record;
    ref_count bigint;
    referencing_column text;
    check_sql text;
begin
    for fk_rec in
        select
            c.conname as constraint_name,
            c.conrelid::regclass as referencing_table,
            c.conkey,
            (
                select array_agg(a.attname order by u.ord)
                from unnest(c.conkey) with ordinality as u(attnum, ord)
                join pg_attribute a
                    on a.attrelid = c.conrelid
                   and a.attnum = u.attnum
            ) as referencing_columns
        from pg_constraint as c
        where c.contype = 'f'
          and c.confrelid = 'ref.ref_building_types'::regclass
        order by c.conrelid::regclass::text, c.conname
    loop
        if coalesce(array_length(fk_rec.conkey, 1), 0) <> 1 then
            raise exception
                '061: FK % on % uses % columns; expected single-column FK to ref.ref_building_types for automatic delete guard',
                fk_rec.constraint_name,
                fk_rec.referencing_table,
                coalesce(array_length(fk_rec.conkey, 1), 0);
        end if;

        referencing_column := fk_rec.referencing_columns[1];

        check_sql := format(
            $sql$
            select count(*)::bigint
            from %s as referencing_row
            where referencing_row.%I in (
                select obsolete.id
                from ref.ref_building_types as obsolete
                inner join ref.ref_building_type_merge_map as merge_map
                    on merge_map.source_code = obsolete.code
            )
            $sql$,
            fk_rec.referencing_table,
            referencing_column
        );

        execute check_sql into ref_count;

        if ref_count > 0 then
            raise exception
                '061: refusing to delete obsolete building types — % row(s) in %.% still reference mapped source type id(s) (constraint %)',
                ref_count,
                fk_rec.referencing_table,
                referencing_column,
                fk_rec.constraint_name;
        end if;
    end loop;
end $$;

delete from ref.ref_building_types as old_bt
using ref.ref_building_type_merge_map as m
where old_bt.code = m.source_code;

-- ---------------------------------------------------------------------------
-- 9. Deactivate non-final types still referenced elsewhere (do not delete)
-- ---------------------------------------------------------------------------
update ref.ref_building_types as bt
set
    is_active = false,
    updated_at = now()
where bt.code not in (
    'residential',
    'commercial',
    'mixed_use',
    'education',
    'healthcare',
    'government_civic',
    'religious',
    'industrial',
    'warehouse_storage',
    'transport',
    'utility_infrastructure',
    'agriculture',
    'recreation',
    'military_restricted',
    'temporary_informal',
    'unknown'
)
  and bt.is_active is distinct from false
  and (
      exists (
          select 1
          from core.core_map_buildings as b
          where b.building_type_id = bt.id
      )
      or (
          to_regclass('import_review.building_candidates') is not null
          and exists (
              select 1
              from import_review.building_candidates as c
              where c.building_type_id = bt.id
          )
      )
      or exists (
          select 1
          from ref.ref_building_types as child_ref
          where child_ref.parent_id = bt.id
      )
  );

-- ---------------------------------------------------------------------------
-- 10. Ensure final active set is active; deactivate other survivors
-- ---------------------------------------------------------------------------
update ref.ref_building_types as bt
set
    is_active = true,
    parent_id = null,
    updated_at = now()
where bt.code in (
    'residential',
    'commercial',
    'mixed_use',
    'education',
    'healthcare',
    'government_civic',
    'religious',
    'industrial',
    'warehouse_storage',
    'transport',
    'utility_infrastructure',
    'agriculture',
    'recreation',
    'military_restricted',
    'temporary_informal',
    'unknown'
);

update ref.ref_building_types as bt
set
    is_active = false,
    updated_at = now()
where bt.code not in (
    'residential',
    'commercial',
    'mixed_use',
    'education',
    'healthcare',
    'government_civic',
    'religious',
    'industrial',
    'warehouse_storage',
    'transport',
    'utility_infrastructure',
    'agriculture',
    'recreation',
    'military_restricted',
    'temporary_informal',
    'unknown'
)
  and bt.is_active is distinct from false;

commit;

-- =============================================================================
-- Verification queries (run manually after migration)
-- =============================================================================
--
-- -- Active final types only (expect 16 rows, all parent_id null, is_active true)
-- select code, name, parent_id, is_active, sort_order
-- from ref.ref_building_types
-- where is_active = true
-- order by sort_order, code;
--
-- -- No core buildings on obsolete merge source codes
-- select src.code, count(*) as building_count
-- from core.core_map_buildings b
-- join ref.ref_building_types src on src.id = b.building_type_id
-- join ref.ref_building_type_merge_map m on m.source_code = src.code
-- group by src.code;
--
-- -- Migration lineage sample
-- select
--     id,
--     building_type_id,
--     normalized_data ->> 'previous_building_type_code' as previous_code,
--     normalized_data ->> 'new_building_type_code' as new_code,
--     normalized_data ->> 'building_type_migrated_at' as migrated_at
-- from core.core_map_buildings
-- where normalized_data ? 'building_type_migrated_at'
-- limit 20;
--
-- -- Orphan obsolete ref rows (expect 0; delete only runs after dynamic FK guard passes)
-- select bt.code
-- from ref.ref_building_types bt
-- join ref.ref_building_type_merge_map m on m.source_code = bt.code;
--
-- -- Inactive but still referenced (import review / legacy)
-- select bt.code, bt.is_active,
--        (select count(*) from core.core_map_buildings b where b.building_type_id = bt.id) as core_refs,
--        (select count(*) from import_review.building_candidates c where c.building_type_id = bt.id) as irr_refs
-- from ref.ref_building_types bt
-- where bt.is_active = false
--   and (
--       exists (select 1 from core.core_map_buildings b where b.building_type_id = bt.id)
--       or exists (select 1 from import_review.building_candidates c where c.building_type_id = bt.id)
--   )
-- order by bt.code;
--
-- -- Backup row counts
-- select count(*) as ref_backup_rows from system.backup_ref_building_types_before_simplification;
-- select count(*) as buildings_backup_rows
-- from system.backup_core_map_buildings_before_building_type_simplification;
--
-- -- FK inventory (should match preflight)
-- select c.conname, c.conrelid::regclass as referencing_table
-- from pg_constraint c
-- where c.contype = 'f'
--   and c.confrelid = 'ref.ref_building_types'::regclass
-- order by 2::text, 1;
