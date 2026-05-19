-- Allow dashboard-created buildings without staging / external identifiers.
alter table core.core_map_buildings
    alter column external_id drop not null;

alter table core.core_map_buildings
    alter column source_staging_id drop not null;

alter table core.core_map_buildings drop constraint if exists core_map_buildings_external_id_chk;

alter table core.core_map_buildings add constraint core_map_buildings_external_id_chk
    check (
        external_id is null
        or btrim(external_id) <> ''
    );
