-- =============================================================================
-- Supabase migration 064: remap FKs off non-final building types (prep for 063)
-- =============================================================================
--
-- Purpose:
--   Point core.core_map_buildings and import_review.building_candidates at flat
--   final ref codes so 065_ref_building_types_delete_unused_non_final.sql can delete
--   unused detailed rows. Does not delete ref rows.
--
-- Requires:
--   - ref.ref_building_type_merge_map (from 061_ref_building_types_simplification.sql)
--
-- Run order: 061 → 064 → 065
--
-- Supabase note: no session temp tables (editor/pooler may split statements).
--
-- =============================================================================

begin;

create schema if not exists ref;
create schema if not exists core;

do $$
begin
    if to_regclass('ref.ref_building_types') is null then
        raise exception '064: ref.ref_building_types missing; run 010 first.';
    end if;

    if to_regclass('ref.ref_building_type_merge_map') is null then
        raise exception
            '064: ref.ref_building_type_merge_map missing; run 061_ref_building_types_simplification.sql first.';
    end if;
end $$;

-- Ensure final 16 exist (idempotent; matches 061 / 063)
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
-- core.core_map_buildings (no class_code column on Supabase — use normalized_data)
-- ---------------------------------------------------------------------------
with remap as (
    select
        b.id as building_id,
        src.id as previous_building_type_id,
        src.code as previous_building_type_code,
        coalesce(tgt_map.id, tgt_class.id, tgt_unknown.id) as new_building_type_id,
        coalesce(tgt_map.code, tgt_class.code, tgt_unknown.code) as new_building_type_code
    from core.core_map_buildings as b
    inner join ref.ref_building_types as src
        on src.id = b.building_type_id
    left join ref.ref_building_type_merge_map as m
        on m.source_code = src.code
    left join ref.ref_building_types as tgt_map
        on tgt_map.code = m.target_code
    left join ref.ref_building_types as tgt_class
        on tgt_class.code = coalesce(
            nullif(btrim(b.normalized_data->>'class_code'), ''),
            nullif(btrim(b.normalized_data->>'building_type'), '')
        )
       and tgt_class.code in (
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
    cross join ref.ref_building_types as tgt_unknown
    where tgt_unknown.code = 'unknown'
      and src.code not in (
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
update core.core_map_buildings as b
set
    building_type_id = r.new_building_type_id,
    normalized_data = coalesce(b.normalized_data, '{}'::jsonb)
        || jsonb_strip_nulls(
            jsonb_build_object(
                'class_code', r.new_building_type_code,
                'previous_building_type_id', r.previous_building_type_id,
                'previous_building_type_code', r.previous_building_type_code,
                'new_building_type_id', r.new_building_type_id,
                'new_building_type_code', r.new_building_type_code,
                'building_type_migrated_at', to_jsonb(now()),
                'building_type_remap_reason', '064_remap_building_type_fks_before_hard_clean'
            )
        ),
    updated_at = now()
from remap as r
where b.id = r.building_id;

-- ---------------------------------------------------------------------------
-- import_review.building_candidates (optional schema; EXECUTE + inline codes)
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('import_review.building_candidates') is null then
        raise notice '064: import_review.building_candidates not present; skipping';
        return;
    end if;

    execute $sql$
        with remap as (
            select
                c.id as candidate_id,
                coalesce(tgt_map.id, tgt_class.id, tgt_unknown.id) as new_building_type_id
            from import_review.building_candidates as c
            inner join ref.ref_building_types as src
                on src.id = c.building_type_id
            left join ref.ref_building_type_merge_map as m
                on m.source_code = src.code
            left join ref.ref_building_types as tgt_map
                on tgt_map.code = m.target_code
            left join ref.ref_building_types as tgt_class
                on tgt_class.code = c.class_code
               and tgt_class.code in (
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
            cross join ref.ref_building_types as tgt_unknown
            where tgt_unknown.code = 'unknown'
              and src.code not in (
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
        update import_review.building_candidates as c
        set
            building_type_id = r.new_building_type_id,
            class_code = coalesce(
                (select bt.code from ref.ref_building_types as bt where bt.id = r.new_building_type_id),
                c.class_code
            ),
            updated_at = now()
        from remap as r
        where c.id = r.candidate_id
    $sql$;
end $$;

-- ---------------------------------------------------------------------------
-- Post-check: no core buildings on non-final types
-- ---------------------------------------------------------------------------
do $$
declare
    stray_count bigint;
begin
    select count(*)::bigint
    into stray_count
    from core.core_map_buildings as b
    where b.building_type_id in (
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

    if stray_count > 0 then
        raise exception
            '064: % core.core_map_buildings row(s) still reference non-final building_type_id after remap',
            stray_count;
    end if;
end $$;

commit;
