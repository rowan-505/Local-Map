-- =============================================================================
-- Supabase migration 081: industry, facility, and office POI categories
-- =============================================================================
--
-- Purpose:
--   Add clean parent/child POI categories for industry, public facilities, and
--   office (parent only — no company/coworking children).
--
-- Safety:
--   - Idempotent: ON CONFLICT (code) DO UPDATE.
--   - No hardcoded ids; parent_id resolved by parent code.
--   - Does not delete or rename existing categories.
--
-- Apply: Supabase SQL Editor (paste full file). Safe to re-run.
--
-- =============================================================================

begin;

create schema if not exists ref;

do $$
begin
    if to_regclass('ref.ref_poi_categories') is null then
        raise exception '081: ref.ref_poi_categories does not exist.';
    end if;
end $$;

alter table ref.ref_poi_categories
    add column if not exists name_mm text null;

-- ---------------------------------------------------------------------------
-- 1. Parent: industry (+ children factory, warehouse, workshop)
-- ---------------------------------------------------------------------------
insert into ref.ref_poi_categories (
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_searchable,
    is_public
)
values
    ('industry', 'Industry', 'စက်မှုလုပ်ငန်း', null, 140, true, true)
on conflict (code) do update
set
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = null,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

insert into ref.ref_poi_categories (
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_searchable,
    is_public
)
select
    v.code,
    v.name,
    v.name_mm,
    p.id,
    v.sort_order,
    true,
    true
from ref.ref_poi_categories as p
cross join (
    values
        ('factory', 'Factory', 'စက်ရုံ', 141),
        ('warehouse', 'Warehouse', 'ကုန်လှောင်ရုံ', 142),
        ('workshop', 'Workshop', 'အလုပ်ရုံ', 143)
) as v (code, name, name_mm, sort_order)
where p.code = 'industry'
  and p.parent_id is null
on conflict (code) do update
set
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

-- ---------------------------------------------------------------------------
-- 2. Parent: facility (+ children toilet, parking, hall)
-- ---------------------------------------------------------------------------
insert into ref.ref_poi_categories (
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_searchable,
    is_public
)
values
    ('facility', 'Facility', 'အများသုံးနေရာ', null, 150, true, true)
on conflict (code) do update
set
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = null,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

insert into ref.ref_poi_categories (
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_searchable,
    is_public
)
select
    v.code,
    v.name,
    v.name_mm,
    p.id,
    v.sort_order,
    true,
    true
from ref.ref_poi_categories as p
cross join (
    values
        ('toilet', 'Public Toilet', 'အများသုံးအိမ်သာ', 151),
        ('parking', 'Parking', 'ကားရပ်နားရန်နေရာ', 152),
        ('hall', 'Hall', 'ခန်းမ', 153)
) as v (code, name, name_mm, sort_order)
where p.code = 'facility'
  and p.parent_id is null
on conflict (code) do update
set
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

-- ---------------------------------------------------------------------------
-- 3. Parent only: office (no children)
-- ---------------------------------------------------------------------------
insert into ref.ref_poi_categories (
    code,
    name,
    name_mm,
    parent_id,
    sort_order,
    is_searchable,
    is_public
)
values
    ('office', 'Office', 'ရုံး', null, 160, true, true)
on conflict (code) do update
set
    name = excluded.name,
    name_mm = excluded.name_mm,
    parent_id = null,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

commit;

-- =============================================================================
-- Verification (read-only; run after commit)
-- =============================================================================

select
    p.code as parent_code,
    p.name as parent_name,
    p.name_mm as parent_name_mm,
    p.sort_order as parent_sort,
    c.code as child_code,
    c.name as child_name,
    c.name_mm as child_name_mm,
    c.sort_order as child_sort
from ref.ref_poi_categories as p
left join ref.ref_poi_categories as c
    on c.parent_id = p.id
where p.code in ('industry', 'facility', 'office')
  and p.parent_id is null
order by p.sort_order, c.sort_order nulls first, c.code nulls first;

select code, name, name_mm, sort_order, parent_id
from ref.ref_poi_categories
where code in (
    'industry',
    'factory',
    'warehouse',
    'workshop',
    'facility',
    'toilet',
    'parking',
    'hall',
    'office'
)
order by sort_order, code;
