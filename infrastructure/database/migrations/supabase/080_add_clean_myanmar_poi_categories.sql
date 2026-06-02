-- =============================================================================
-- Supabase migration 080: Myanmar-focused POI category expansion (minimal)
-- =============================================================================
--
-- Purpose:
--   Add finance + community parent taxonomies, targeted transport/religion/food
--   children, fix market under shopping, backfill missing name_mm labels, and
--   rename bus_station → bus_stop when safe (preserve row id; no deletes).
--
-- Safety:
--   - Idempotent: ON CONFLICT (code), guarded inserts, conditional rename.
--   - No hardcoded category ids; parent_id resolved by parent code.
--   - Does not delete rows or rename hotel → lodging.
--
-- Apply: Supabase SQL Editor (paste full file). Safe to re-run.
--
-- =============================================================================

begin;

create schema if not exists ref;

do $$
begin
    if to_regclass('ref.ref_poi_categories') is null then
        raise exception '080: ref.ref_poi_categories does not exist.';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ensure Myanmar label column exists (Supabase may already have name_mm)
-- ---------------------------------------------------------------------------
alter table ref.ref_poi_categories
    add column if not exists name_mm text null;

comment on column ref.ref_poi_categories.name_mm is
    'Myanmar (Burmese) display label for search, tiles, and dashboard reference UI.';

-- ---------------------------------------------------------------------------
-- 1–2. Parent: finance (+ children bank, atm)
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
    ('finance', 'Finance', 'ငွေကြေး', null, 120, true, true)
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
        ('bank', 'Bank', 'ဘဏ်', 121),
        ('atm', 'ATM', '​​​ငွေထုတ်စက် (ATM)', 122)
) as v (code, name, name_mm, sort_order)
where p.code = 'finance'
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
-- 3–4. Parent: community (+ children charity, cemetery, retreat)
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
    ('community', 'Community', 'လူမှုရေး', null, 130, true, true)
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
        ('charity', 'Charity', 'ပရဟိတ', 131),
        ('cemetery', 'Cemetery', 'သုဿန်', 132),
        ('retreat', 'Retreat', 'ရိပ်သာ', 133)
) as v (code, name, name_mm, sort_order)
where p.code = 'community'
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
-- 5. Transport child: fuel
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
select
    'fuel',
    'Fuel Station',
    'ဆီဆိုင်',
    p.id,
    44,
    true,
    true
from ref.ref_poi_categories as p
where p.code = 'transport'
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
-- 6. Religion children: pagoda, monastery
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
        ('pagoda', 'Pagoda', 'ဘုရား', 71),
        ('monastery', 'Monastery', 'ဘုန်းကြီးကျောင်း', 72)
) as v (code, name, name_mm, sort_order)
where p.code = 'religion'
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
-- 7. Food child: teashop
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
select
    'teashop',
    'Tea Shop',
    'လက်ဖက်ရည်ဆိုင်',
    p.id,
    12,
    true,
    true
from ref.ref_poi_categories as p
where p.code = 'food'
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
-- 8. Shopping: keep market under shopping; normalize sort_order
-- ---------------------------------------------------------------------------
update ref.ref_poi_categories as child
set
    parent_id = parent.id,
    sort_order = 64
from ref.ref_poi_categories as parent
where child.code = 'market'
  and parent.code = 'shopping'
  and parent.parent_id is null;

-- ---------------------------------------------------------------------------
-- 9. Rename bus_station → bus_stop when bus_stop code is free (preserve id)
-- ---------------------------------------------------------------------------
update ref.ref_poi_categories
set code = 'bus_stop'
where code = 'bus_station'
  and not exists (
      select 1
      from ref.ref_poi_categories as existing
      where existing.code = 'bus_stop'
  );

-- ---------------------------------------------------------------------------
-- 10. Backfill missing Myanmar names on existing categories
-- ---------------------------------------------------------------------------
update ref.ref_poi_categories as c
set name_mm = v.name_mm
from (
    values
        ('restaurant', 'စားသောက်ဆိုင်'),
        ('cafe', 'ကဖေး'),
        ('hospital', 'ဆေးရုံ'),
        ('clinic', 'ဆေးခန်း'),
        ('pharmacy', 'ဆေးဆိုင်'),
        ('school', 'ကျောင်း'),
        ('university', 'တက္ကသိုလ်'),
        ('library', 'စာကြည့်တိုက်'),
        ('bus_stop', 'ဘတ်စ်ကားဂိတ်'),
        ('bus_station', 'ဘတ်စ်ကားဂိတ်'),
        ('train_station', 'ရထားဘူတာ'),
        ('ferry_terminal', 'သင်္ဘောဆိပ်'),
        ('township_office', 'မြို့နယ်ရုံး'),
        ('police_station', 'ရဲစခန်း'),
        ('post_office', 'စာတိုက်'),
        ('shopping_mall', 'စျေးဝယ်စင်တာ'),
        ('convenience_store', 'ကုန်စုံဆိုင်'),
        ('supermarket', 'စူပါမားကတ်'),
        ('market', 'စျေး')
) as v (code, name_mm)
where c.code = v.code
  and (c.name_mm is null or btrim(c.name_mm) = '');

commit;

-- =============================================================================
-- Verification (read-only; run after commit)
-- =============================================================================

-- Finance + community trees
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
where p.code in ('finance', 'community')
  and p.parent_id is null
order by p.sort_order, c.sort_order nulls first, c.code nulls first;

-- Transport, religion, food, shopping trees
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
where p.code in ('transport', 'religion', 'food', 'shopping')
  and p.parent_id is null
order by p.sort_order, c.sort_order nulls first, c.code nulls first;

-- Spot-check: new codes + market + bus stop label
select code, name, name_mm, sort_order, parent_id
from ref.ref_poi_categories
where code in (
    'finance',
    'bank',
    'atm',
    'community',
    'charity',
    'cemetery',
    'retreat',
    'fuel',
    'pagoda',
    'monastery',
    'teashop',
    'market',
    'bus_stop',
    'bus_station'
)
order by sort_order, code;
