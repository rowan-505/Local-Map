-- Allow dashboard-created landuse / water features without staging / external identifiers.
-- Mirrors 006_core_map_buildings_nullable_dashboard.sql.

alter table core.core_map_landuse
    alter column external_id drop not null;

alter table core.core_map_landuse
    alter column source_staging_id drop not null;

alter table core.core_map_landuse drop constraint if exists core_map_landuse_external_id_chk;

alter table core.core_map_landuse add constraint core_map_landuse_external_id_chk
    check (
        external_id is null
        or btrim(external_id) <> ''
    );

alter table core.core_map_water_lines
    alter column external_id drop not null;

alter table core.core_map_water_lines
    alter column source_staging_id drop not null;

alter table core.core_map_water_lines drop constraint if exists core_map_water_lines_external_id_chk;

alter table core.core_map_water_lines add constraint core_map_water_lines_external_id_chk
    check (
        external_id is null
        or btrim(external_id) <> ''
    );

alter table core.core_map_water_polygons
    alter column external_id drop not null;

alter table core.core_map_water_polygons
    alter column source_staging_id drop not null;

alter table core.core_map_water_polygons drop constraint if exists core_map_water_polygons_external_id_chk;

alter table core.core_map_water_polygons add constraint core_map_water_polygons_external_id_chk
    check (
        external_id is null
        or btrim(external_id) <> ''
    );
