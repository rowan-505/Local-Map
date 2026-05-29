-- Expand import_transport candidate validation_status to V2 lifecycle values.
-- Maps legacy ingest statuses to: not_validated | valid | warning | blocked

begin;

create or replace function import_transport._migrate_validation_status_v2(old_status text)
returns text
language sql
immutable
as $$
    select case
        when old_status in ('passed', 'valid') then 'valid'
        when old_status in ('passed_with_warnings', 'valid_with_warnings') then 'warning'
        when old_status in ('failed', 'blocked') then 'blocked'
        when old_status in ('not_validated', 'valid', 'warning', 'blocked') then old_status
        else 'not_validated'
    end;
$$;

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'raw_routes',
        'raw_stops',
        'raw_route_variants',
        'raw_route_stops'
    ]
    loop
        if to_regclass('import_transport.' || tbl) is not null then
            execute format(
                'update import_transport.%I
                 set validation_status = import_transport._migrate_validation_status_v2(validation_status)',
                tbl
            );

            execute format(
                'alter table import_transport.%I alter column validation_status set default ''not_validated''',
                tbl
            );

            execute format(
                'alter table import_transport.%I drop constraint if exists %I',
                tbl,
                tbl || '_validation_status_chk'
            );

            execute format(
                'alter table import_transport.%I
                 add constraint %I check (
                     validation_status in (''not_validated'', ''valid'', ''warning'', ''blocked'')
                 )',
                tbl,
                tbl || '_validation_status_chk'
            );
        end if;
    end loop;
end $$;

drop function if exists import_transport._migrate_validation_status_v2(text);

commit;
