-- =============================================================================
-- Supabase migration 034: core.core_map_landuse_names (feature labels)
-- =============================================================================
--
-- Purpose:
--   Formalize multilingual feature names for core landuse polygons, matching the
--   places/streets/admin-areas name-table pattern.
--
--   Category/taxonomy labels remain in ref.ref_landuse_classes; this table stores
--   reviewer-facing feature names only (my / en / und).
--
-- Notes:
--   - Migration 028 created an early core_map_landuse_names stub (language_code mm).
--     This migration upgrades that table in place when present.
--   - Does not backfill from core.core_map_landuse.name (028 may have imported
--     legacy rows as name_type = imported — left unchanged).
--   - No ref_language_codes table; language_code is constrained to my, en, und.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Create table when missing (greenfield / partial 028 apply)
-- ---------------------------------------------------------------------------
create table if not exists core.core_map_landuse_names (
    id bigserial primary key,
    landuse_id bigint not null references core.core_map_landuse (id) on delete cascade,
    name text not null,
    language_code text not null,
    script_code text,
    name_type text not null default 'official',
    is_primary boolean not null default true,
    search_weight integer not null default 50,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table core.core_map_landuse_names is
    'Multilingual feature names for core.core_map_landuse (not landuse category/taxonomy labels).';

comment on column core.core_map_landuse_names.landuse_id is
    'Parent landuse polygon (core.core_map_landuse.id).';

comment on column core.core_map_landuse_names.language_code is
    'ISO-style language tag without ref table: my (Myanmar), en (English), und (undetermined).';

comment on column core.core_map_landuse_names.name_type is
    'Name role: official, alternate, short, local, old, imported, etc.';

-- ---------------------------------------------------------------------------
-- Normalize legacy language codes from migration 028 (mm -> my)
-- ---------------------------------------------------------------------------
update core.core_map_landuse_names
set
    language_code = 'my',
    updated_at = now()
where language_code = 'mm';

-- ---------------------------------------------------------------------------
-- Column defaults (028 used is_primary default false)
-- ---------------------------------------------------------------------------
alter table core.core_map_landuse_names
    alter column name_type set default 'official',
    alter column is_primary set default true,
    alter column search_weight set default 50,
    alter column created_at set default now(),
    alter column updated_at set default now();

alter table core.core_map_landuse_names
    alter column language_code drop default;

-- ---------------------------------------------------------------------------
-- Check constraints (drop/recreate idempotently)
-- ---------------------------------------------------------------------------
alter table core.core_map_landuse_names
    drop constraint if exists core_map_landuse_names_language_code_chk;

alter table core.core_map_landuse_names
    add constraint core_map_landuse_names_language_code_chk
        check (language_code in ('my', 'en', 'und'));

alter table core.core_map_landuse_names
    drop constraint if exists core_map_landuse_names_name_chk;

alter table core.core_map_landuse_names
    add constraint core_map_landuse_names_name_chk
        check (btrim(name) <> '');

alter table core.core_map_landuse_names
    drop constraint if exists core_map_landuse_names_script_code_chk;

alter table core.core_map_landuse_names
    add constraint core_map_landuse_names_script_code_chk
        check (script_code is null or btrim(script_code) <> '');

alter table core.core_map_landuse_names
    drop constraint if exists core_map_landuse_names_name_type_chk;

alter table core.core_map_landuse_names
    add constraint core_map_landuse_names_name_type_chk
        check (
            name_type in ('official', 'alternate', 'short', 'local', 'old', 'imported', 'generated')
            and btrim(name_type) <> ''
        );

alter table core.core_map_landuse_names
    drop constraint if exists core_map_landuse_names_search_weight_chk;

alter table core.core_map_landuse_names
    add constraint core_map_landuse_names_search_weight_chk
        check (search_weight >= 0 and search_weight <= 100);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists core_map_landuse_names_landuse_id_idx
    on core.core_map_landuse_names (landuse_id);

create index if not exists core_map_landuse_names_language_code_idx
    on core.core_map_landuse_names (language_code);

create index if not exists core_map_landuse_names_lower_name_idx
    on core.core_map_landuse_names (lower(name));

-- Trigram search when pg_trgm is available (optional; matches local baseline).
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_trgm') then
        execute $idx$
            create index if not exists core_map_landuse_names_name_trgm_idx
            on core.core_map_landuse_names using gin (name gin_trgm_ops)
        $idx$;
    end if;
end $$;

-- One primary official name per landuse per language (name_type).
drop index if exists core.core_map_landuse_names_one_primary_per_lang_type_uidx;

create unique index core_map_landuse_names_one_primary_per_lang_type_uidx
    on core.core_map_landuse_names (landuse_id, language_code, name_type)
    where is_primary is true;

commit;
