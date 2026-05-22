-- =============================================================================
-- Supabase migration 038: ref boundary status + address usage lookup tables
-- =============================================================================
--
-- Purpose:
--   DB-driven dropdowns for core.core_admin_areas boundary/address metadata
--   (boundary_status, address_usage, defaults for is_official_boundary and
--   boundary_confidence_score). Supports Myanmar villages with official,
--   surveyed, approximate, and settlement-extent polygons.
--
-- Safety:
--   - CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--   - Idempotent seeds via ON CONFLICT (code) DO UPDATE.
--   - Does not alter core.core_admin_areas or existing row values.
--
-- =============================================================================

begin;

create schema if not exists ref;

-- ---------------------------------------------------------------------------
-- ref.ref_address_usage_types (seed first — referenced by boundary defaults)
-- ---------------------------------------------------------------------------
create table if not exists ref.ref_address_usage_types (
    id bigserial primary key,
    code text not null,
    name_en text not null,
    name_mm text,
    helper_en text,
    helper_mm text,
    sort_order integer not null default 100,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ref_address_usage_types_code_key unique (code),
    constraint ref_address_usage_types_code_format_chk
        check (btrim(code) <> '' and code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$')
);

create index if not exists ref_address_usage_types_code_idx
    on ref.ref_address_usage_types (code);

create index if not exists ref_address_usage_types_is_active_idx
    on ref.ref_address_usage_types (is_active);

comment on table ref.ref_address_usage_types is
    'How an admin area may be used in address composition and search workflows (DB-driven dropdown source).';

comment on column ref.ref_address_usage_types.code is
    'Stable lowercase snake_case slug; mirrors core.core_admin_areas.address_usage text values.';

comment on column ref.ref_address_usage_types.helper_en is
    'Reviewer-facing guidance shown in dashboard dropdowns (English).';

comment on column ref.ref_address_usage_types.helper_mm is
    'Reviewer-facing guidance shown in dashboard dropdowns (Myanmar).';

insert into ref.ref_address_usage_types (
    code,
    name_en,
    name_mm,
    helper_en,
    sort_order,
    is_active
)
values
    (
        'official',
        'Official address area',
        'တရားဝင် လိပ်စာဧရိယာ',
        'Safe to use as an official address/admin component.',
        10,
        true
    ),
    (
        'locality_hint',
        'Locality hint',
        'အနီးစပ်ဆုံး နေရာညွှန်းချက်',
        'Can be used in address display as an approximate village/locality, but should have lower confidence.',
        20,
        true
    ),
    (
        'search_only',
        'Search only',
        'ရှာဖွေရန်သာ',
        'Search/focus only. Do not use automatically in address composition.',
        30,
        true
    ),
    (
        'disabled',
        'Disabled for address',
        'လိပ်စာတွင် မသုံးရန်',
        'Do not use this area in address assignment.',
        40,
        true
    )
on conflict (code) do update
set
    name_en = excluded.name_en,
    name_mm = excluded.name_mm,
    helper_en = excluded.helper_en,
    helper_mm = excluded.helper_mm,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- ref.ref_boundary_statuses
-- ---------------------------------------------------------------------------
create table if not exists ref.ref_boundary_statuses (
    id bigserial primary key,
    code text not null,
    name_en text not null,
    name_mm text,
    helper_en text,
    helper_mm text,
    sort_order integer not null default 100,
    default_is_official_boundary boolean not null default false,
    default_boundary_confidence_score numeric not null default 60,
    default_address_usage_code text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ref_boundary_statuses_code_key unique (code),
    constraint ref_boundary_statuses_code_format_chk
        check (btrim(code) <> '' and code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
    constraint ref_boundary_statuses_default_boundary_confidence_score_chk
        check (
            default_boundary_confidence_score >= 0
            and default_boundary_confidence_score <= 100
        )
);

create index if not exists ref_boundary_statuses_code_idx
    on ref.ref_boundary_statuses (code);

create index if not exists ref_boundary_statuses_is_active_idx
    on ref.ref_boundary_statuses (is_active);

comment on table ref.ref_boundary_statuses is
    'Boundary quality taxonomy for admin areas — drives dashboard dropdowns and suggested defaults on core.core_admin_areas.';

comment on column ref.ref_boundary_statuses.code is
    'Stable lowercase snake_case slug; mirrors core.core_admin_areas.boundary_status text values.';

comment on column ref.ref_boundary_statuses.default_is_official_boundary is
    'Suggested default for core.core_admin_areas.is_official_boundary when this status is selected.';

comment on column ref.ref_boundary_statuses.default_boundary_confidence_score is
    'Suggested default confidence on 0–100 scale when this status is selected.';

comment on column ref.ref_boundary_statuses.default_address_usage_code is
    'Suggested default ref.ref_address_usage_types.code / core.core_admin_areas.address_usage when this status is selected.';

comment on column ref.ref_boundary_statuses.helper_en is
    'Reviewer-facing guidance (English). official = trusted legal/admin boundary; '
    'surveyed = manually checked or field-verified; approximate = estimated, not legally exact; '
    'settlement_extent = built-up area only, not official boundary; unknown = boundary unknown.';

-- Optional FK after both tables exist (idempotent).
do $fk$
begin
    if to_regclass('ref.ref_address_usage_types') is not null then
        alter table ref.ref_boundary_statuses
            drop constraint if exists ref_boundary_statuses_default_address_usage_code_fkey;

        alter table ref.ref_boundary_statuses
            add constraint ref_boundary_statuses_default_address_usage_code_fkey
                foreign key (default_address_usage_code)
                references ref.ref_address_usage_types (code);
    end if;
exception
    when duplicate_object then null;
end;
$fk$;

insert into ref.ref_boundary_statuses (
    code,
    name_en,
    name_mm,
    helper_en,
    sort_order,
    default_is_official_boundary,
    default_boundary_confidence_score,
    default_address_usage_code,
    is_active
)
values
    (
        'official',
        'Official boundary',
        'တရားဝင် နယ်နိမိတ်',
        'Trusted official/legal administrative boundary.',
        10,
        true,
        90,
        'official',
        true
    ),
    (
        'surveyed',
        'Surveyed / verified boundary',
        'စစ်ဆေးအတည်ပြုထားသော နယ်နိမိတ်',
        'Boundary has been manually checked or field/satellite verified, but may not be from a legal source.',
        20,
        true,
        85,
        'official',
        true
    ),
    (
        'approximate',
        'Approximate boundary',
        'ခန့်မှန်း နယ်နိမိတ်',
        'Estimated boundary. Useful for map/search context, but not legally exact.',
        30,
        false,
        65,
        'locality_hint',
        true
    ),
    (
        'settlement_extent',
        'Settlement extent only',
        'လူနေထိုင်ရာ ဧရိယာသာ',
        'Visible built-up settlement area only. Not an official village boundary.',
        40,
        false,
        60,
        'locality_hint',
        true
    ),
    (
        'unknown',
        'Boundary unknown',
        'နယ်နိမိတ် မသိရသေး',
        'Boundary is unknown. Use point/centroid or parent area for search/address.',
        50,
        false,
        30,
        'search_only',
        true
    )
on conflict (code) do update
set
    name_en = excluded.name_en,
    name_mm = excluded.name_mm,
    helper_en = excluded.helper_en,
    helper_mm = excluded.helper_mm,
    sort_order = excluded.sort_order,
    default_is_official_boundary = excluded.default_is_official_boundary,
    default_boundary_confidence_score = excluded.default_boundary_confidence_score,
    default_address_usage_code = excluded.default_address_usage_code,
    is_active = excluded.is_active,
    updated_at = now();

commit;

-- Manual verification (Supabase SQL Editor):
--
-- SELECT code, name_en, default_boundary_confidence_score, default_address_usage_code
-- FROM ref.ref_boundary_statuses
-- ORDER BY sort_order;
--
-- SELECT code, name_en, sort_order
-- FROM ref.ref_address_usage_types
-- ORDER BY sort_order;
