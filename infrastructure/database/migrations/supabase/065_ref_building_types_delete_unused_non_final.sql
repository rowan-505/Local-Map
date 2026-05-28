-- =============================================================================
-- Supabase migration 065: delete unused non-final ref.ref_building_types rows
-- =============================================================================
--
-- Purpose:
--   After 064 remaps FKs to flat types, hard-delete every ref row whose code is
--   not one of the 16 final allowed codes — only when no FK still references it.
--
-- Does NOT:
--   - Remap FK columns (run 064 first).
--   - Deactivate non-final rows instead of deleting them.
--   - Use ON DELETE CASCADE.
--
-- Depends on:
--   010_ref_building_types.sql
--   061_ref_building_types_simplification.sql (recommended)
--   064_remap_building_type_fks_before_hard_clean.sql (required if detailed types remain referenced)
--
-- Run order: 061 → 064 → 065
--
-- Supabase: no session temp tables; inline final-code lists only.
--
-- Verify: infrastructure/database/verification/verify_building_type_simplification.sql
--
-- =============================================================================

begin;

create schema if not exists ref;

-- ---------------------------------------------------------------------------
-- 0. Preflight: table exists
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('ref.ref_building_types') is null then
        raise exception '065: ref.ref_building_types does not exist; run 010_ref_building_types.sql first.';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Upsert + verify all 16 final codes exist
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

do $$
declare
    final_present_count bigint;
    final_missing_codes text;
begin
    select count(*)::bigint
    into final_present_count
    from ref.ref_building_types as bt
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

    if final_present_count <> 16 then
        select string_agg(v.code, ', ' order by v.code)
        into final_missing_codes
        from (
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
                ('unknown')
        ) as v(code)
        where not exists (
            select 1
            from ref.ref_building_types as bt
            where bt.code = v.code
        );

        raise exception
            '065: expected 16 final building type rows, found %; missing code(s): %',
            final_present_count,
            coalesce(final_missing_codes, '(none listed)');
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Normalize final rows (active, flat, sort_order)
-- ---------------------------------------------------------------------------
update ref.ref_building_types as bt
set
    is_active = true,
    parent_id = null,
    sort_order = v.sort_order,
    updated_at = now()
from (
    values
        ('residential', 10),
        ('commercial', 20),
        ('mixed_use', 30),
        ('education', 40),
        ('healthcare', 50),
        ('government_civic', 60),
        ('religious', 70),
        ('industrial', 80),
        ('warehouse_storage', 90),
        ('transport', 100),
        ('utility_infrastructure', 110),
        ('agriculture', 120),
        ('recreation', 130),
        ('military_restricted', 140),
        ('temporary_informal', 150),
        ('unknown', 160)
) as v(code, sort_order)
where bt.code = v.code;

-- ---------------------------------------------------------------------------
-- 3. Detach ref.self-FK parent_id → non-final (ref table only)
-- ---------------------------------------------------------------------------
update ref.ref_building_types as child
set
    parent_id = null,
    updated_at = now()
where child.parent_id in (
    select bt.id
    from ref.ref_building_types as bt
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
);

-- ---------------------------------------------------------------------------
-- 4. Dynamic FK guard — abort if any non-final id is still referenced
-- ---------------------------------------------------------------------------
do $$
declare
    fk_rec record;
    ref_count bigint;
    referencing_column text;
    check_sql text;
    non_final_count bigint;
begin
    select count(*)::bigint
    into non_final_count
    from ref.ref_building_types as bt
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
    );

    if non_final_count = 0 then
        raise notice '065: no non-final building types to delete; ref table already has 16 rows only';
        return;
    end if;

    raise notice '065: checking % non-final building type row(s) for FK references before delete', non_final_count;

    for fk_rec in
        select
            c.conname as constraint_name,
            ns.nspname as referencing_schema,
            cl.relname as referencing_table,
            c.conkey,
            (
                select array_agg(a.attname order by u.ord)
                from unnest(c.conkey) with ordinality as u(attnum, ord)
                join pg_attribute a
                    on a.attrelid = c.conrelid
                   and a.attnum = u.attnum
            ) as referencing_columns
        from pg_constraint as c
        inner join pg_class as cl
            on cl.oid = c.conrelid
        inner join pg_namespace as ns
            on ns.oid = cl.relnamespace
        where c.contype = 'f'
          and c.confrelid = 'ref.ref_building_types'::regclass
        order by ns.nspname, cl.relname, c.conname
    loop
        if coalesce(array_length(fk_rec.conkey, 1), 0) <> 1 then
            raise exception
                '065: FK % on %.% uses % column(s); expected single-column FK to ref.ref_building_types',
                fk_rec.constraint_name,
                fk_rec.referencing_schema,
                fk_rec.referencing_table,
                coalesce(array_length(fk_rec.conkey, 1), 0);
        end if;

        referencing_column := fk_rec.referencing_columns[1];

        check_sql := format(
            $sql$
            select count(*)::bigint
            from %I.%I as referencing_row
            where referencing_row.%I in (
                select bt.id
                from ref.ref_building_types as bt
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
            )
            $sql$,
            fk_rec.referencing_schema,
            fk_rec.referencing_table,
            referencing_column
        );

        execute check_sql into ref_count;

        if ref_count > 0 then
            raise exception
                '065: refusing to delete non-final building types — schema=%, table=%, column=%, reference_count=% (constraint %). Run 064 to remap FKs, then re-run 065.',
                fk_rec.referencing_schema,
                fk_rec.referencing_table,
                referencing_column,
                ref_count,
                fk_rec.constraint_name;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. DELETE unused non-final rows (no CASCADE)
-- ---------------------------------------------------------------------------
delete from ref.ref_building_types as bt
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
);

-- ---------------------------------------------------------------------------
-- 6. Post-delete verification
-- ---------------------------------------------------------------------------
do $$
declare
    total_count bigint;
    leftover_count bigint;
    leftover_codes text;
    inactive_final_count bigint;
    final_with_parent_count bigint;
begin
    select count(*)::bigint
    into total_count
    from ref.ref_building_types;

    if total_count <> 16 then
        raise exception
            '065: expected exactly 16 ref.ref_building_types rows after delete, found %',
            total_count;
    end if;

    select count(*)::bigint
    into leftover_count
    from ref.ref_building_types as bt
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
    );

    if leftover_count > 0 then
        select string_agg(bt.code, ', ' order by bt.code)
        into leftover_codes
        from ref.ref_building_types as bt
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
        );

        raise exception
            '065: % non-final building type row(s) remain after delete: %',
            leftover_count,
            leftover_codes;
    end if;

    select count(*)::bigint
    into inactive_final_count
    from ref.ref_building_types as bt
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
      and bt.is_active is distinct from true;

    if inactive_final_count > 0 then
        raise exception
            '065: % final building type row(s) are not active after delete',
            inactive_final_count;
    end if;

    select count(*)::bigint
    into final_with_parent_count
    from ref.ref_building_types as bt
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

    if final_with_parent_count > 0 then
        raise exception
            '065: % final building type row(s) still have parent_id set',
            final_with_parent_count;
    end if;
end $$;

commit;

-- =============================================================================
-- Verification queries (run manually after migration)
-- =============================================================================
--
-- -- All remaining building types (expect 16)
-- select id, code, name, parent_id, sort_order, is_active
-- from ref.ref_building_types
-- order by sort_order, code;
--
-- -- Total count (expect 16)
-- select count(*) as building_type_count
-- from ref.ref_building_types;
--
-- -- Any code outside the final allowed list (expect 0 rows)
-- select bt.code
-- from ref.ref_building_types as bt
-- where bt.code not in (
--     'residential',
--     'commercial',
--     'mixed_use',
--     'education',
--     'healthcare',
--     'government_civic',
--     'religious',
--     'industrial',
--     'warehouse_storage',
--     'transport',
--     'utility_infrastructure',
--     'agriculture',
--     'recreation',
--     'military_restricted',
--     'temporary_informal',
--     'unknown'
-- )
-- order by bt.code;
--
-- -- Active flat final types (expect 16 rows, parent_id null)
-- select code, name, parent_id, is_active, sort_order
-- from ref.ref_building_types
-- where is_active = true
-- order by sort_order, code;
--
-- -- core.core_map_buildings still pointing at valid ref rows
-- select bt.code, count(*)::bigint as building_count
-- from core.core_map_buildings as b
-- inner join ref.ref_building_types as bt
--     on bt.id = b.building_type_id
-- where b.building_type_id is not null
-- group by bt.code
-- order by building_count desc, bt.code;
--
-- -- Orphan building_type_id (expect 0)
-- select count(*)::bigint as orphan_fk_count
-- from core.core_map_buildings as b
-- where b.building_type_id is not null
--   and not exists (
--       select 1
--       from ref.ref_building_types as bt
--       where bt.id = b.building_type_id
--   );
