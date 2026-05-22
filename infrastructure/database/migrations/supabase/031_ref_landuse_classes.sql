-- =============================================================================
-- Supabase migration 031: ref.ref_landuse_classes taxonomy
-- =============================================================================
--
-- Purpose:
--   Add a hierarchical land-use reference taxonomy for urban and village contexts
--   Myanmar-first taxonomy for Yangon / Kyauktan (urban + village/rice field).
--   Leaf codes align with OSM landuse=* where practical; parent rows group UI/tiles.
--
--   Note: parent row `transport` is the selectable transport class (no child row;
--   unique code constraint prevents parent + child both named transport).
--
-- =============================================================================

begin;

create schema if not exists ref;

-- ---------------------------------------------------------------------------
-- ref.ref_landuse_classes
-- ---------------------------------------------------------------------------
create table if not exists ref.ref_landuse_classes (
    id bigserial primary key,
    code text not null,
    name_en text not null,
    name_mm text,
    parent_id bigint references ref.ref_landuse_classes (id),
    sort_order integer not null default 100,
    min_zoom numeric not null default 12,
    default_import_confidence numeric not null default 70,
    is_public boolean not null default true,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ref_landuse_classes_code_key unique (code),
    constraint ref_landuse_classes_code_format_chk
        check (btrim(code) <> '' and code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
    constraint ref_landuse_classes_min_zoom_chk
        check (min_zoom >= 0 and min_zoom <= 24),
    constraint ref_landuse_classes_default_import_confidence_chk
        check (default_import_confidence >= 0 and default_import_confidence <= 100)
);

create index if not exists ref_landuse_classes_code_idx
    on ref.ref_landuse_classes (code);

create index if not exists ref_landuse_classes_parent_id_idx
    on ref.ref_landuse_classes (parent_id);

create index if not exists ref_landuse_classes_is_active_idx
    on ref.ref_landuse_classes (is_active);

comment on table ref.ref_landuse_classes is
    'Hierarchical land-use taxonomy for map styling, import confidence defaults, and zoom gating (urban + village Myanmar contexts).';

comment on column ref.ref_landuse_classes.code is
    'Stable lowercase snake_case slug; aligns with OSM landuse=* where practical.';

comment on column ref.ref_landuse_classes.default_import_confidence is
    'Default import confidence on 0–100 scale when mapping OSM or manual review sources.';

-- ---------------------------------------------------------------------------
-- Seed: parent categories (parent_id null)
-- ---------------------------------------------------------------------------
insert into ref.ref_landuse_classes (
    code,
    name_en,
    name_mm,
    parent_id,
    sort_order,
    min_zoom,
    default_import_confidence,
    is_public,
    is_active
)
values
    ('urban', 'Urban', 'မြို့ပြဧရိယာ', null, 10, 11, 70, true, true),
    ('agriculture', 'Agriculture & village', 'ကျေးလက်နှင့် စိုက်ပျိုးရေး', null, 20, 11, 75, true, true),
    ('institution', 'Institution & public', 'ပြည်သူ့အဆောက်အအုံ', null, 30, 12, 70, true, true),
    ('green', 'Green & recreation', 'သစ်တော / အပန်းဖြေ', null, 40, 11, 70, true, true),
    ('transport', 'Transport area', 'သယ်ယူပို့ဆောင်ရေးဧရိယာ', null, 50, 12, 75, true, true),
    ('special', 'Special', 'အထူး', null, 60, 12, 50, true, true)
on conflict (code) do update
set
    name_en = excluded.name_en,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    min_zoom = excluded.min_zoom,
    default_import_confidence = excluded.default_import_confidence,
    is_public = excluded.is_public,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Seed: child types (parent_id from parent code)
-- ---------------------------------------------------------------------------
insert into ref.ref_landuse_classes (
    code,
    name_en,
    name_mm,
    parent_id,
    sort_order,
    min_zoom,
    default_import_confidence,
    is_public,
    is_active
)
select
    v.code,
    v.name_en,
    v.name_mm,
    p.id,
    v.sort_order,
    v.min_zoom,
    v.default_import_confidence,
    v.is_public,
    true
from ref.ref_landuse_classes p
cross join (values
    -- urban
    ('urban', 'residential', 'Residential', 'လူနေရပ်ကွက်', 0, 12, 75, true),
    ('urban', 'commercial', 'Commercial', 'စီးပွားရေးဧရိယာ', 1, 12, 75, true),
    ('urban', 'retail', 'Retail', 'အရောင်းအဝယ်ဧရိယာ', 2, 13, 75, true),
    ('urban', 'industrial', 'Industrial', 'စက်မှုဧရိယာ', 3, 12, 75, true),
    ('urban', 'government', 'Government', 'အစိုးရဧရိယာ', 4, 13, 75, true),
    ('urban', 'construction', 'Construction', 'ဆောက်လုပ်ရေးမြေ', 5, 14, 75, true),
    -- agriculture / village
    ('agriculture', 'farmland', 'Farmland', 'စိုက်ပျိုးမြေ', 0, 12, 75, true),
    ('agriculture', 'paddy', 'Rice paddy', 'စပါးလယ်', 1, 12, 75, true),
    ('agriculture', 'orchard', 'Orchard', 'ဥယျာဉ်ခြံမြေ', 2, 13, 75, true),
    ('agriculture', 'aquaculture', 'Aquaculture', 'ငါး/ပုစွန်မွေးမြူရေးကန်', 3, 13, 70, true),
    ('agriculture', 'farmyard', 'Farmyard', 'လယ်ယာဝင်း', 4, 13, 75, true),
    -- institution / public
    ('institution', 'education', 'Education compound', 'ပညာရေးဝင်း', 0, 14, 70, true),
    ('institution', 'healthcare', 'Healthcare compound', 'ကျန်းမာရေးဝင်း', 1, 14, 70, true),
    ('institution', 'religious', 'Religious compound', 'ဘာသာရေးဝင်း', 2, 14, 70, true),
    ('institution', 'cemetery', 'Cemetery', 'သင်္ချိုင်း', 3, 14, 70, true),
    -- green / recreation
    ('green', 'park', 'Park', 'ပန်းခြံ', 0, 13, 70, true),
    ('green', 'recreation_ground', 'Recreation ground', 'အားကစား/အပန်းဖြေမြေ', 1, 13, 70, true),
    ('green', 'forest', 'Forest', 'သစ်တော', 2, 11, 75, true),
    ('green', 'grassland', 'Grassland', 'မြက်ခင်းပြင်', 3, 12, 75, true),
    -- special
    ('special', 'military', 'Military', 'စစ်ဘက်ဧရိယာ', 0, 13, 65, false),
    ('special', 'vacant', 'Vacant', 'မြေလွတ်', 1, 14, 50, true),
    ('special', 'other', 'Other', 'အခြား', 2, 12, 50, true)
) as v (
    parent_code,
    code,
    name_en,
    name_mm,
    sort_order,
    min_zoom,
    default_import_confidence,
    is_public
)
where p.code = v.parent_code
  and p.parent_id is null
on conflict (code) do update
set
    name_en = excluded.name_en,
    name_mm = excluded.name_mm,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    min_zoom = excluded.min_zoom,
    default_import_confidence = excluded.default_import_confidence,
    is_public = excluded.is_public,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Deactivate legacy draft taxonomy codes (safe on first apply: no-op)
-- ---------------------------------------------------------------------------
update ref.ref_landuse_classes
set
    is_active = false,
    updated_at = now()
where code not in (
    'urban',
    'agriculture',
    'institution',
    'green',
    'transport',
    'special',
    'residential',
    'commercial',
    'retail',
    'industrial',
    'government',
    'construction',
    'farmland',
    'paddy',
    'orchard',
    'aquaculture',
    'farmyard',
    'education',
    'healthcare',
    'religious',
    'cemetery',
    'park',
    'recreation_ground',
    'forest',
    'grassland',
    'military',
    'vacant',
    'other'
)
and is_active = true;

commit;
