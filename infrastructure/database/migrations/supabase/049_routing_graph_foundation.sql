-- =============================================================================
-- Supabase migration 049: Phase 9C routing graph foundation
-- =============================================================================
--
-- Build-job-scoped routing graph tables derived from core.core_streets.
-- Graph rows are generated output only — rebuild by creating a new build job
-- and deleting/replacing prior jobs. Do not treat routing_edges as source data.
--
-- Coexists with legacy routing.road_* tables from migration 023; new work should
-- prefer routing.routing_* build-job tables below.
--
-- =============================================================================

begin;

create schema if not exists routing;

-- ---------------------------------------------------------------------------
-- 1. routing.routing_profiles
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_profiles (
    id bigserial primary key,
    code text not null,
    name text not null,
    description text,
    is_active boolean not null default true,
    default_speed_kph numeric,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_profiles_code_key unique (code)
);

comment on table routing.routing_profiles is
    'Reference routing modes (walk, drive, bus). Used to tag build jobs and edge cost columns.';

insert into routing.routing_profiles (code, name, description, default_speed_kph)
values
    ('walk', 'Walk', 'Pedestrian routing profile.', 5),
    ('drive', 'Drive', 'Motor vehicle routing profile.', 50),
    ('bus', 'Bus', 'Public transit routing profile (road-network segments).', 30)
on conflict (code) do update
set
    name = excluded.name,
    description = excluded.description,
    default_speed_kph = excluded.default_speed_kph,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. routing.routing_build_jobs
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_build_jobs (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    region_code text,
    profile_code text references routing.routing_profiles (code),
    source_description text,
    source_review_batch_id bigint,
    source_publish_batch_id bigint,
    status text not null default 'draft',
    started_at timestamptz,
    finished_at timestamptz,
    total_core_roads integer not null default 0,
    total_nodes integer not null default 0,
    total_edges integer not null default 0,
    warning_count integer not null default 0,
    error_count integer not null default 0,
    summary jsonb not null default '{}'::jsonb,
    created_by bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_build_jobs_status_chk check (
        status in ('draft', 'running', 'completed', 'failed', 'cancelled')
    ),
    constraint routing_build_jobs_total_core_roads_chk check (total_core_roads >= 0),
    constraint routing_build_jobs_total_nodes_chk check (total_nodes >= 0),
    constraint routing_build_jobs_total_edges_chk check (total_edges >= 0),
    constraint routing_build_jobs_warning_count_chk check (warning_count >= 0),
    constraint routing_build_jobs_error_count_chk check (error_count >= 0)
);

create unique index if not exists routing_build_jobs_public_id_uq
    on routing.routing_build_jobs (public_id);

comment on table routing.routing_build_jobs is
    'One routing graph build attempt. All routing_nodes/edges/reports for a build are tied here for easy rebuild and delete.';

comment on column routing.routing_build_jobs.source_description is
    'Human-readable build input summary (region, filters, core street snapshot).';

-- Optional lineage FKs (added only when upstream tables exist).
do $$
begin
    if to_regclass('import_review.review_batches') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_build_jobs_source_review_batch_id_fkey'
              and conrelid = 'routing.routing_build_jobs'::regclass
        )
    then
        alter table routing.routing_build_jobs
            add constraint routing_build_jobs_source_review_batch_id_fkey
                foreign key (source_review_batch_id)
                references import_review.review_batches (id)
                on delete set null;
    end if;

    if to_regclass('system.system_publish_batches') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_build_jobs_source_publish_batch_id_fkey'
              and conrelid = 'routing.routing_build_jobs'::regclass
        )
    then
        alter table routing.routing_build_jobs
            add constraint routing_build_jobs_source_publish_batch_id_fkey
                foreign key (source_publish_batch_id)
                references system.system_publish_batches (id)
                on delete set null;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. routing.routing_nodes
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_nodes (
    id bigserial primary key,
    build_job_id bigint not null references routing.routing_build_jobs (id) on delete cascade,
    node_type text not null,
    geom geometry(Point, 4326) not null,
    core_street_id bigint,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint routing_nodes_node_type_chk check (
        node_type in ('endpoint', 'intersection', 'split_point', 'barrier', 'stop_connector')
    )
);

create index if not exists routing_nodes_build_job_idx
    on routing.routing_nodes (build_job_id);

create index if not exists routing_nodes_geom_gix
    on routing.routing_nodes using gist (geom);

comment on table routing.routing_nodes is
    'Generated routing graph nodes for one build job. Rebuilt from core.core_streets; not edited manually.';

do $$
begin
    if to_regclass('core.core_streets') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_nodes_core_street_id_fkey'
              and conrelid = 'routing.routing_nodes'::regclass
        )
    then
        alter table routing.routing_nodes
            add constraint routing_nodes_core_street_id_fkey
                foreign key (core_street_id)
                references core.core_streets (id)
                on delete set null;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. routing.routing_edges
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_edges (
    id bigserial primary key,
    build_job_id bigint not null references routing.routing_build_jobs (id) on delete cascade,
    from_node_id bigint not null references routing.routing_nodes (id) on delete cascade,
    to_node_id bigint not null references routing.routing_nodes (id) on delete cascade,
    core_street_id bigint not null,
    geom geometry(LineString, 4326) not null,
    length_m numeric not null,
    road_class_id bigint,
    is_oneway boolean,
    forward_allowed boolean not null default true,
    backward_allowed boolean not null default true,
    walk_allowed boolean not null default true,
    drive_allowed boolean not null default true,
    bus_allowed boolean not null default false,
    speed_kph numeric,
    cost_walk numeric,
    cost_drive numeric,
    cost_bus numeric,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint routing_edges_length_m_chk check (length_m > 0),
    constraint routing_edges_speed_kph_chk check (speed_kph is null or speed_kph > 0),
    constraint routing_edges_cost_walk_chk check (cost_walk is null or cost_walk >= 0),
    constraint routing_edges_cost_drive_chk check (cost_drive is null or cost_drive >= 0),
    constraint routing_edges_cost_bus_chk check (cost_bus is null or cost_bus >= 0)
);

create index if not exists routing_edges_build_job_idx
    on routing.routing_edges (build_job_id);

create index if not exists routing_edges_from_node_idx
    on routing.routing_edges (from_node_id);

create index if not exists routing_edges_to_node_idx
    on routing.routing_edges (to_node_id);

create index if not exists routing_edges_core_street_idx
    on routing.routing_edges (core_street_id);

create index if not exists routing_edges_geom_gix
    on routing.routing_edges using gist (geom);

comment on table routing.routing_edges is
    'Generated directed routing segments for one build job, derived from core.core_streets. Not source data.';

do $$
begin
    if to_regclass('core.core_streets') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_edges_core_street_id_fkey'
              and conrelid = 'routing.routing_edges'::regclass
        )
    then
        alter table routing.routing_edges
            add constraint routing_edges_core_street_id_fkey
                foreign key (core_street_id)
                references core.core_streets (id);
    end if;

    if to_regclass('ref.ref_road_classes') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_edges_road_class_id_fkey'
              and conrelid = 'routing.routing_edges'::regclass
        )
    then
        alter table routing.routing_edges
            add constraint routing_edges_road_class_id_fkey
                foreign key (road_class_id)
                references ref.ref_road_classes (id)
                on delete set null;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. routing.routing_validation_reports
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_validation_reports (
    id bigserial primary key,
    build_job_id bigint not null references routing.routing_build_jobs (id) on delete cascade,
    severity text not null,
    code text not null,
    message text not null,
    core_street_id bigint,
    routing_edge_id bigint references routing.routing_edges (id) on delete set null,
    geom geometry(Geometry, 4326),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint routing_validation_reports_severity_chk check (
        severity in ('info', 'warning', 'error')
    )
);

create index if not exists routing_validation_reports_build_job_idx
    on routing.routing_validation_reports (build_job_id);

create index if not exists routing_validation_reports_severity_idx
    on routing.routing_validation_reports (severity);

create index if not exists routing_validation_reports_code_idx
    on routing.routing_validation_reports (code);

comment on table routing.routing_validation_reports is
    'Build-time validation findings (geometry, connectivity, access rules) for a routing build job.';

do $$
begin
    if to_regclass('core.core_streets') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_validation_reports_core_street_id_fkey'
              and conrelid = 'routing.routing_validation_reports'::regclass
        )
    then
        alter table routing.routing_validation_reports
            add constraint routing_validation_reports_core_street_id_fkey
                foreign key (core_street_id)
                references core.core_streets (id)
                on delete set null;
    end if;
end $$;

comment on schema routing is
    'Routing graph derived from approved core streets. Phase 9C build-job tables (routing_*) coexist with legacy road_* tables.';

commit;

-- =============================================================================
-- Verification (run manually after applying in Supabase SQL Editor)
-- =============================================================================
--
-- select table_name
-- from information_schema.tables
-- where table_schema = 'routing'
--   and table_name like 'routing_%'
-- order by table_name;
--
-- select code, name, is_active, default_speed_kph
-- from routing.routing_profiles
-- order by code;
--
-- select conname, pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where connamespace = 'routing'::regnamespace
--   and contype = 'c'
-- order by conname;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'routing'
--   and tablename in (
--       'routing_nodes',
--       'routing_edges',
--       'routing_validation_reports'
--   )
-- order by tablename, indexname;
