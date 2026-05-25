-- =============================================================================
-- Supabase migration 055: import_review place-address link candidates
-- =============================================================================
--
-- Purpose:
--   Add a review-time link table for source features that have both place/POI
--   evidence and useful address evidence. This table represents candidate links
--   between import_review.place_candidates and import_review.address_candidates.
--
-- Safety:
--   - Additive only.
--   - Does not modify core tables.
--   - Does not promote anything.
--   - Does not create link rows by itself.
--
-- =============================================================================

begin;

create extension if not exists pgcrypto;
create schema if not exists import_review;

create table if not exists import_review.place_address_links (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    review_batch_id bigint not null,
    source_snapshot_id bigint,
    external_id text,
    place_candidate_id bigint,
    address_candidate_id bigint not null,
    matched_core_place_id bigint,
    matched_core_address_id bigint,
    relation_type text not null default 'primary',
    is_primary boolean not null default true,
    confidence_score numeric default 65,
    match_status text not null default 'new_auto',
    auto_action text not null default 'insert_candidate',
    review_status text not null default 'pending',
    review_decision text,
    review_note text,
    validation_status text not null default 'not_checked',
    validation_errors jsonb not null default '[]'::jsonb,
    validation_warnings jsonb not null default '[]'::jsonb,
    promotion_status text not null default 'not_ready',
    promoted_core_id bigint,
    promoted_at timestamptz,
    promoted_by text,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint irr_pal_relation_type_chk check (
        relation_type in (
            'primary',
            'located_at',
            'entrance',
            'delivery',
            'mailing',
            'nearby'
        )
    ),
    constraint irr_pal_confidence_score_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint irr_pal_validation_errors_array_chk check (
        jsonb_typeof(validation_errors) = 'array'
    ),
    constraint irr_pal_validation_warnings_array_chk check (
        jsonb_typeof(validation_warnings) = 'array'
    ),
    constraint irr_pal_source_refs_object_chk check (
        jsonb_typeof(source_refs) = 'object'
    ),
    constraint irr_pal_normalized_data_object_chk check (
        jsonb_typeof(normalized_data) = 'object'
    )
);

alter table import_review.place_address_links
    alter column public_id set default gen_random_uuid(),
    alter column relation_type set default 'primary',
    alter column is_primary set default true,
    alter column confidence_score set default 65,
    alter column match_status set default 'new_auto',
    alter column auto_action set default 'insert_candidate',
    alter column review_status set default 'pending',
    alter column validation_status set default 'not_checked',
    alter column validation_errors set default '[]'::jsonb,
    alter column validation_warnings set default '[]'::jsonb,
    alter column promotion_status set default 'not_ready',
    alter column source_refs set default '{}'::jsonb,
    alter column normalized_data set default '{}'::jsonb,
    alter column created_at set default now(),
    alter column updated_at set default now();

update import_review.place_address_links
set public_id = gen_random_uuid()
where public_id is null;

update import_review.place_address_links
set relation_type = 'primary'
where relation_type is null
   or btrim(relation_type) = '';

update import_review.place_address_links
set is_primary = true
where is_primary is null;

update import_review.place_address_links
set confidence_score = 65
where confidence_score is null;

update import_review.place_address_links
set match_status = 'new_auto'
where match_status is null
   or btrim(match_status) = '';

update import_review.place_address_links
set auto_action = 'insert_candidate'
where auto_action is null
   or btrim(auto_action) = '';

update import_review.place_address_links
set review_status = 'pending'
where review_status is null
   or btrim(review_status) = '';

update import_review.place_address_links
set validation_status = 'not_checked'
where validation_status is null
   or btrim(validation_status) = '';

update import_review.place_address_links
set validation_errors = '[]'::jsonb
where validation_errors is null;

update import_review.place_address_links
set validation_warnings = '[]'::jsonb
where validation_warnings is null;

update import_review.place_address_links
set promotion_status = 'not_ready'
where promotion_status is null
   or btrim(promotion_status) = '';

update import_review.place_address_links
set source_refs = '{}'::jsonb
where source_refs is null;

update import_review.place_address_links
set normalized_data = '{}'::jsonb
where normalized_data is null;

update import_review.place_address_links
set created_at = now()
where created_at is null;

update import_review.place_address_links
set updated_at = now()
where updated_at is null;

alter table import_review.place_address_links
    alter column public_id set not null,
    alter column relation_type set not null,
    alter column is_primary set not null,
    alter column match_status set not null,
    alter column auto_action set not null,
    alter column review_status set not null,
    alter column validation_status set not null,
    alter column validation_errors set not null,
    alter column validation_warnings set not null,
    alter column promotion_status set not null,
    alter column source_refs set not null,
    alter column normalized_data set not null,
    alter column created_at set not null,
    alter column updated_at set not null;

do $migration$
begin
    if to_regclass('import_review.review_batches') is not null
       and not exists (
           select 1
           from pg_constraint
           where conrelid = 'import_review.place_address_links'::regclass
             and conname = 'irr_pal_review_batch_id_fkey'
       ) then
        alter table import_review.place_address_links
            add constraint irr_pal_review_batch_id_fkey
                foreign key (review_batch_id)
                references import_review.review_batches (id)
                on delete cascade;
    end if;

    if to_regclass('import_review.place_candidates') is not null
       and not exists (
           select 1
           from pg_constraint
           where conrelid = 'import_review.place_address_links'::regclass
             and conname = 'irr_pal_place_candidate_id_fkey'
       ) then
        alter table import_review.place_address_links
            add constraint irr_pal_place_candidate_id_fkey
                foreign key (place_candidate_id)
                references import_review.place_candidates (id)
                on delete set null;
    end if;

    if to_regclass('import_review.address_candidates') is not null
       and not exists (
           select 1
           from pg_constraint
           where conrelid = 'import_review.place_address_links'::regclass
             and conname = 'irr_pal_address_candidate_id_fkey'
       ) then
        alter table import_review.place_address_links
            add constraint irr_pal_address_candidate_id_fkey
                foreign key (address_candidate_id)
                references import_review.address_candidates (id)
                on delete cascade;
    end if;
end
$migration$;

create index if not exists irr_pal_review_batch_id_idx
    on import_review.place_address_links (review_batch_id);

create index if not exists irr_pal_place_candidate_id_idx
    on import_review.place_address_links (place_candidate_id);

create index if not exists irr_pal_address_candidate_id_idx
    on import_review.place_address_links (address_candidate_id);

create index if not exists irr_pal_external_id_idx
    on import_review.place_address_links (external_id);

create index if not exists irr_pal_review_status_idx
    on import_review.place_address_links (review_status);

create index if not exists irr_pal_validation_status_idx
    on import_review.place_address_links (validation_status);

create index if not exists irr_pal_promotion_status_idx
    on import_review.place_address_links (promotion_status);

create unique index if not exists irr_pal_batch_place_address_relation_uq
    on import_review.place_address_links (
        review_batch_id,
        place_candidate_id,
        address_candidate_id,
        relation_type
    )
    where place_candidate_id is not null;

comment on table import_review.place_address_links is
    'Review-time candidate links between import_review.place_candidates and import_review.address_candidates.';

comment on column import_review.place_address_links.place_candidate_id is
    'Nullable until a matching import_review.place_candidates row exists for the source feature.';

comment on column import_review.place_address_links.address_candidate_id is
    'Required import_review.address_candidates row participating in the link candidate.';

comment on column import_review.place_address_links.matched_core_place_id is
    'Optional core.core_places id used during review; no core writes happen in this phase.';

comment on column import_review.place_address_links.matched_core_address_id is
    'Optional core.core_addresses id used during review; no core writes happen in this phase.';

commit;

-- =============================================================================
-- Manual verification SQL
-- =============================================================================
--
-- 1) Show table columns:
-- select
--     column_name,
--     data_type,
--     is_nullable,
--     column_default
-- from information_schema.columns
-- where table_schema = 'import_review'
--   and table_name = 'place_address_links'
-- order by ordinal_position;
--
-- 2) Show constraints:
-- select
--     conname as constraint_name,
--     contype as constraint_type,
--     pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where conrelid = 'import_review.place_address_links'::regclass
-- order by conname;
--
-- 3) Show indexes:
-- select
--     indexname,
--     indexdef
-- from pg_indexes
-- where schemaname = 'import_review'
--   and tablename = 'place_address_links'
-- order by indexname;
--
-- 4) Count by review/validation/promotion status:
-- select
--     review_status,
--     validation_status,
--     promotion_status,
--     count(*)::bigint as link_count
-- from import_review.place_address_links
-- group by review_status, validation_status, promotion_status
-- order by review_status, validation_status, promotion_status;
