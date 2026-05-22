-- =============================================================================
-- Supabase migration 046: core address promotion columns + duplicate_review status
-- =============================================================================
--
-- Ensures core.core_address_components has review-parity metadata for promotion.
-- Aligns core.core_addresses with matched street/admin FK promotion inserts.
-- Extends import_review.address_candidates.promotion_status for duplicate review.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- core.core_addresses — promotion FK / geometry / display cache columns
-- ---------------------------------------------------------------------------
alter table if exists core.core_addresses
    add column if not exists unit_number text,
    add column if not exists street_id bigint,
    add column if not exists admin_area_id bigint,
    add column if not exists entrance_geom geometry(Point, 4326),
    add column if not exists postal_code text,
    add column if not exists is_public boolean not null default true;

do $migration$
begin
    if to_regclass('core.core_streets') is not null
       and to_regclass('core.core_addresses') is not null
       and not exists (
           select 1 from pg_constraint
           where conname = 'core_addresses_street_id_fkey'
             and conrelid = 'core.core_addresses'::regclass
       )
    then
        alter table core.core_addresses
            add constraint core_addresses_street_id_fkey
                foreign key (street_id) references core.core_streets (id);
    end if;
end
$migration$;

do $migration$
begin
    if to_regclass('core.core_admin_areas') is not null
       and to_regclass('core.core_addresses') is not null
       and not exists (
           select 1 from pg_constraint
           where conname = 'core_addresses_admin_area_id_fkey'
             and conrelid = 'core.core_addresses'::regclass
       )
    then
        alter table core.core_addresses
            add constraint core_addresses_admin_area_id_fkey
                foreign key (admin_area_id) references core.core_admin_areas (id);
    end if;
end
$migration$;

create index if not exists core_addresses_street_id_idx
    on core.core_addresses (street_id);

create index if not exists core_addresses_admin_area_id_idx
    on core.core_addresses (admin_area_id);

-- ---------------------------------------------------------------------------
-- core.core_address_components — bilingual + lineage metadata
-- ---------------------------------------------------------------------------
alter table if exists core.core_address_components
    add column if not exists language_code text not null default 'und',
    add column if not exists component_type_code text,
    add column if not exists source_refs jsonb not null default '{}'::jsonb,
    add column if not exists confidence_score numeric,
    add column if not exists match_type text,
    add column if not exists source_admin_area_id bigint,
    add column if not exists boundary_status text,
    add column if not exists address_usage text,
    add column if not exists updated_at timestamptz not null default now();

update core.core_address_components
set language_code = 'und'
where language_code is null
   or btrim(language_code) = '';

update core.core_address_components
set source_refs = '{}'::jsonb
where source_refs is null;

update core.core_address_components
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

do $migration$
begin
    if to_regclass('core.core_address_components') is null then
        return;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'core.core_address_components'::regclass
          and conname = 'core_acmp_language_code_chk'
    ) then
        alter table core.core_address_components
            add constraint core_acmp_language_code_chk
                check (language_code in ('en', 'my', 'und'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'core.core_address_components'::regclass
          and conname = 'core_acmp_confidence_chk'
    ) then
        alter table core.core_address_components
            add constraint core_acmp_confidence_chk
                check (
                    confidence_score is null
                    or (confidence_score >= 0 and confidence_score <= 100)
                );
    end if;
end
$migration$;

-- ---------------------------------------------------------------------------
-- import_review.address_candidates — duplicate_review_needed promotion status
-- ---------------------------------------------------------------------------
do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise notice 'Skipping 046 promotion_status: address_candidates missing';
        return;
    end if;

    alter table import_review.address_candidates
        drop constraint if exists irr_addr_promotion_status_chk;

    alter table import_review.address_candidates
        add constraint irr_addr_promotion_status_chk
            check (
                promotion_status in (
                    'not_ready',
                    'ready',
                    'batched',
                    'promoting',
                    'promoted',
                    'failed',
                    'skipped',
                    'duplicate_review_needed'
                )
            );
end
$migration$;

comment on column core.core_address_components.language_code is
    'BCP-47-style review language: en | my | und (neutral tokens).';

commit;
