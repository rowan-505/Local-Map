-- =============================================================================
-- Supabase migration 063: hard-clean ref.ref_building_types to 16 final codes
-- =============================================================================
--
-- Purpose:
--   Ensure ref.ref_building_types contains only the flat active taxonomy (16 codes).
--   Delete every non-final row that is not referenced by any FK. Block the migration
--   if any non-final id is still referenced (no remap, no deactivate-only path).
--
-- Depends on: 010, 061, 064 (if FK remap needed)
--
-- Note: If you already run 064, prefer 065_ref_building_types_delete_unused_non_final.sql
-- instead of this file (same delete logic; 065 runs after 064 in the intended order).
--
-- Supabase note: no session temp tables (editor/pooler may split statements).
--
-- =============================================================================

begin;

create schema if not exists ref;

do $$
begin
    if to_regclass('ref.ref_building_types') is null then
        raise exception '063: ref.ref_building_types does not exist; run 010_ref_building_types.sql first.';
    end if;
end $$;

-- Upsert all 16 final codes (idempotent)
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

-- Normalize final rows (active, flat, sort_order)
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

-- Detach self-FK parent_id pointers to non-final rows (ref table only)
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

-- Dynamic FK guard — block if any non-final id is still referenced
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
        raise notice '063: no non-final building types to delete; ref table already clean';
        return;
    end if;

    raise notice '063: checking % non-final building type row(s) for FK references', non_final_count;

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
                '063: FK % on % uses % column(s); expected single-column FK to ref.ref_building_types',
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
            fk_rec.referencing_table,
            referencing_column
        );

        execute check_sql into ref_count;

        if ref_count > 0 then
            raise exception
                '063: refusing to delete non-final building types — % row(s) in %.% still reference non-final type id(s) (constraint %). Remap or clear those references before re-running.',
                ref_count,
                fk_rec.referencing_table,
                referencing_column,
                fk_rec.constraint_name;
        end if;
    end loop;
end $$;

-- Delete unused non-final rows (no CASCADE)
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

-- Post-delete verification
do $$
declare
    leftover_count bigint;
    leftover_codes text;
begin
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
            '063: % non-final building type row(s) remain after delete: %',
            leftover_count,
            leftover_codes;
    end if;

    if (select count(*)::bigint from ref.ref_building_types) <> 16 then
        raise exception
            '063: expected exactly 16 ref.ref_building_types rows after hard clean, found %',
            (select count(*)::bigint from ref.ref_building_types);
    end if;
end $$;

commit;

-- Verification queries: see infrastructure/database/verification/verify_building_type_simplification.sql
