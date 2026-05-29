-- Promotion batch validation progress + per-item validation status

begin;

alter table import_transport.promotion_items
    add column if not exists item_validation_status text not null default 'pending';

alter table import_transport.promotion_batches
    add column if not exists can_promote boolean not null default false;

alter table import_transport.promotion_batches
    add column if not exists validation_total integer not null default 0;

alter table import_transport.promotion_batches
    add column if not exists validation_done integer not null default 0;

alter table import_transport.promotion_batches
    add column if not exists validation_percent numeric not null default 0;

alter table import_transport.promotion_batches
    add column if not exists validated_at timestamptz null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'promotion_items_item_validation_status_chk'
          and conrelid = 'import_transport.promotion_items'::regclass
    ) then
        alter table import_transport.promotion_items
            add constraint promotion_items_item_validation_status_chk check (
                item_validation_status in ('pending', 'valid', 'warning', 'blocked', 'skipped')
            );
    end if;
end $$;

do $$
begin
    if to_regclass('import_transport.promotion_batches') is not null then
        alter table import_transport.promotion_batches
            drop constraint if exists promotion_batches_validation_status_chk;

        alter table import_transport.promotion_batches
            add constraint promotion_batches_validation_status_chk check (
                validation_status in (
                    'not_started',
                    'pending',
                    'in_progress',
                    'validating',
                    'passed',
                    'passed_with_warnings',
                    'failed',
                    'skipped',
                    'blocked'
                )
            );
    end if;
end $$;

alter table import_transport.promotion_batches
    drop constraint if exists promotion_batches_validation_percent_chk;

alter table import_transport.promotion_batches
    add constraint promotion_batches_validation_percent_chk check (
        validation_percent >= 0 and validation_percent <= 100
    );

commit;
