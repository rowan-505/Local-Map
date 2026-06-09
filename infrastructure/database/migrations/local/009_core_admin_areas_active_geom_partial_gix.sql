-- Active admin-area geometry partial GIST index for township infer / spatial filters.

create index if not exists core_admin_areas_active_geom_gix
    on core.core_admin_areas using gist (geom)
    where is_active is true
      and deleted_at is null
      and geom is not null;
