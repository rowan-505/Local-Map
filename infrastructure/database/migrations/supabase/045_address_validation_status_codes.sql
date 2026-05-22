-- =============================================================================
-- Supabase migration 045: extend address_candidates.validation_status codes
-- =============================================================================
--
-- Adds API validation outcomes: valid, valid_with_warnings (keeps legacy values).
--
-- =============================================================================

begin;

do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise notice 'Skipping 045: import_review.address_candidates missing';
        return;
    end if;

    alter table import_review.address_candidates
        drop constraint if exists irr_addr_validation_status_chk;

    alter table import_review.address_candidates
        add constraint irr_addr_validation_status_chk
            check (
                validation_status in (
                    'not_checked',
                    'passed',
                    'warnings',
                    'failed',
                    'blocked',
                    'valid',
                    'valid_with_warnings'
                )
            );
end
$migration$;

comment on column import_review.address_candidates.validation_status is
    'Promotion readiness: not_checked | valid | valid_with_warnings | blocked (also legacy passed/warnings/failed).';

commit;
