-- =============================================================================
-- Supabase migration 053: import_review address source classification
-- =============================================================================
--
-- Purpose:
--   Add review-only source classification metadata to import_review.address_candidates
--   so POI-like OSM source features can be triaged before address promotion.
--
-- Safety:
--   - Additive only.
--   - Does not delete data.
--   - Does not overwrite review workflow fields.
--   - Does not promote anything.
--   - Defaults are applied only to NULL values in the new metadata columns.
--
-- =============================================================================

begin;

do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise notice 'Skipping 053: import_review.address_candidates missing';
        return;
    end if;

    alter table import_review.address_candidates
        add column if not exists source_classification text,
        add column if not exists has_place_evidence boolean,
        add column if not exists has_address_evidence boolean,
        add column if not exists address_strength text,
        add column if not exists place_candidate_status text,
        add column if not exists linked_place_candidate_id bigint,
        add column if not exists matched_core_place_id bigint,
        add column if not exists classification_reasons jsonb,
        add column if not exists classified_at timestamptz;

    alter table import_review.address_candidates
        alter column source_classification set default 'unclassified',
        alter column has_place_evidence set default false,
        alter column has_address_evidence set default false,
        alter column address_strength set default 'none',
        alter column place_candidate_status set default 'not_applicable',
        alter column classification_reasons set default '[]'::jsonb;

    update import_review.address_candidates
    set source_classification = 'unclassified'
    where source_classification is null;

    update import_review.address_candidates
    set has_place_evidence = false
    where has_place_evidence is null;

    update import_review.address_candidates
    set has_address_evidence = false
    where has_address_evidence is null;

    update import_review.address_candidates
    set address_strength = 'none'
    where address_strength is null;

    update import_review.address_candidates
    set place_candidate_status = 'not_applicable'
    where place_candidate_status is null;

    update import_review.address_candidates
    set classification_reasons = '[]'::jsonb
    where classification_reasons is null;
end
$migration$;

do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        return;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'import_review.address_candidates'::regclass
          and conname = 'irr_addr_source_classification_chk'
    ) then
        alter table import_review.address_candidates
            add constraint irr_addr_source_classification_chk
                check (
                    source_classification in (
                        'unclassified',
                        'place_only',
                        'address_only',
                        'place_with_address',
                        'weak_address',
                        'ignore'
                    )
                );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'import_review.address_candidates'::regclass
          and conname = 'irr_addr_address_strength_chk'
    ) then
        alter table import_review.address_candidates
            add constraint irr_addr_address_strength_chk
                check (
                    address_strength in (
                        'none',
                        'weak',
                        'partial',
                        'strong',
                        'full'
                    )
                );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'import_review.address_candidates'::regclass
          and conname = 'irr_addr_place_candidate_status_chk'
    ) then
        alter table import_review.address_candidates
            add constraint irr_addr_place_candidate_status_chk
                check (
                    place_candidate_status in (
                        'not_applicable',
                        'needs_place_candidate',
                        'place_candidate_created',
                        'matched_core_place',
                        'ignored'
                    )
                );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'import_review.address_candidates'::regclass
          and conname = 'irr_addr_classification_reasons_array_chk'
    ) then
        alter table import_review.address_candidates
            add constraint irr_addr_classification_reasons_array_chk
                check (jsonb_typeof(classification_reasons) = 'array');
    end if;
end
$migration$;

create index if not exists irr_addr_source_classification_idx
    on import_review.address_candidates (source_classification);

create index if not exists irr_addr_has_place_evidence_idx
    on import_review.address_candidates (has_place_evidence);

create index if not exists irr_addr_has_address_evidence_idx
    on import_review.address_candidates (has_address_evidence);

create index if not exists irr_addr_address_strength_idx
    on import_review.address_candidates (address_strength);

create index if not exists irr_addr_place_candidate_status_idx
    on import_review.address_candidates (place_candidate_status);

create index if not exists irr_addr_linked_place_candidate_id_idx
    on import_review.address_candidates (linked_place_candidate_id)
    where linked_place_candidate_id is not null;

create index if not exists irr_addr_matched_core_place_id_idx
    on import_review.address_candidates (matched_core_place_id)
    where matched_core_place_id is not null;

comment on column import_review.address_candidates.source_classification is
    'Review classification for mixed OSM source features: unclassified | place_only | address_only | place_with_address | weak_address | ignore.';

comment on column import_review.address_candidates.has_place_evidence is
    'True when source tags contain place/POI evidence such as name, amenity, shop, religion, building, phone, email, or opening_hours.';

comment on column import_review.address_candidates.has_address_evidence is
    'True when source tags contain address evidence such as addr:* components.';

comment on column import_review.address_candidates.address_strength is
    'Classifier strength of address evidence: none | weak | partial | strong | full.';

comment on column import_review.address_candidates.place_candidate_status is
    'Status of related place-candidate handling for this address source.';

comment on column import_review.address_candidates.linked_place_candidate_id is
    'Optional import_review.place_candidates id for a same-source place candidate.';

comment on column import_review.address_candidates.matched_core_place_id is
    'Optional core.core_places id matched by source classification or review.';

comment on column import_review.address_candidates.classification_reasons is
    'Array of machine/reviewer-readable reasons supporting source classification.';

comment on column import_review.address_candidates.classified_at is
    'Timestamp when source classification was last calculated or reviewed.';

commit;

-- =============================================================================
-- Manual verification SQL
-- =============================================================================
--
-- 1) Show columns:
-- select
--     column_name,
--     data_type,
--     is_nullable,
--     column_default
-- from information_schema.columns
-- where table_schema = 'import_review'
--   and table_name = 'address_candidates'
--   and column_name in (
--       'source_classification',
--       'has_place_evidence',
--       'has_address_evidence',
--       'address_strength',
--       'place_candidate_status',
--       'linked_place_candidate_id',
--       'matched_core_place_id',
--       'classification_reasons',
--       'classified_at'
--   )
-- order by ordinal_position;
--
-- 2) Count by source_classification:
-- select
--     source_classification,
--     count(*)::bigint as candidate_count
-- from import_review.address_candidates
-- group by source_classification
-- order by source_classification;
--
-- 3) Count by place_candidate_status:
-- select
--     place_candidate_status,
--     count(*)::bigint as candidate_count
-- from import_review.address_candidates
-- group by place_candidate_status
-- order by place_candidate_status;
