-- Optional admin boundary for dashboard / API metadata (nullable FK).
-- Mirrors core_places.admin_area_id pattern.

alter table core.core_map_buildings
    add column if not exists admin_area_id bigint;

do $$
begin
    if not exists (
        select 1
        from pg_constraint c
        join pg_class t on c.conrelid = t.oid
        join pg_namespace n on t.relnamespace = n.oid
        where n.nspname = 'core'
          and t.relname = 'core_map_buildings'
          and c.conname = 'core_map_buildings_admin_area_id_fkey'
    ) then
        alter table core.core_map_buildings
            add constraint core_map_buildings_admin_area_id_fkey
            foreign key (admin_area_id)
            references core.core_admin_areas (id);
    end if;
end $$;

create index if not exists core_map_buildings_admin_area_id_idx
    on core.core_map_buildings (admin_area_id);
