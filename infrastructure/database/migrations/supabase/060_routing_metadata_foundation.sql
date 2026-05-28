-- =============================================================================
-- Supabase migration 060: routing metadata foundation (Valhalla / OTP-ready)
-- =============================================================================
--
-- Purpose:
--   Production routing registry, engine configuration, build lineage, request
--   audit, and user feedback — without storing Valhalla/OTP graph internals in
--   PostGIS.
--
-- Coexists with:
--   - routing.routing_build_jobs / routing_nodes / routing_edges (049) — scoped
--     validation graph builds only.
--   - routing.routing_profiles (049) — extended here for public API profiles.
--   - routing.routing_validation_reports (049) — extended to attach to either
--     a graph build job or a published engine build.
--
-- Does NOT:
--   - Modify core.core_streets or transit tables.
--   - Store full Valhalla edge/node graphs.
--
-- Depends on: 049_routing_graph_foundation.sql (routing schema + profiles table).
--
-- =============================================================================

begin;

create schema if not exists routing;

-- ---------------------------------------------------------------------------
-- 1. routing.routing_physical_modes
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_physical_modes (
    id bigserial primary key,
    code text not null,
    name text not null,
    description text,
    sort_order integer not null default 100,
    is_routing_enabled boolean not null default false,
    is_public_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_physical_modes_code_key unique (code),
    constraint routing_physical_modes_code_nonempty_chk check (btrim(code) <> ''),
    constraint routing_physical_modes_sort_order_chk check (sort_order >= 0)
);

create index if not exists routing_physical_modes_code_idx
    on routing.routing_physical_modes (code);

create index if not exists routing_physical_modes_public_enabled_idx
    on routing.routing_physical_modes (is_public_enabled)
    where is_public_enabled = true;

comment on table routing.routing_physical_modes is
    'Canonical transport modes (walk, car, bus, rail). Gates public routing and future OTP legs.';

-- ---------------------------------------------------------------------------
-- 2. routing.routing_service_classes
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_service_classes (
    id bigserial primary key,
    code text not null,
    name text not null,
    description text,
    sort_order integer not null default 100,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_service_classes_code_key unique (code),
    constraint routing_service_classes_code_nonempty_chk check (btrim(code) <> ''),
    constraint routing_service_classes_sort_order_chk check (sort_order >= 0)
);

create index if not exists routing_service_classes_code_idx
    on routing.routing_service_classes (code);

comment on table routing.routing_service_classes is
    'Transit / mobility service tiers for future OTP and express-bus routing (metadata only).';

-- ---------------------------------------------------------------------------
-- 3. routing.routing_profiles (extend 049)
-- ---------------------------------------------------------------------------
alter table routing.routing_profiles
    add column if not exists profile_kind text not null default 'road',
    add column if not exists primary_physical_mode_code text,
    add column if not exists is_routing_enabled boolean not null default true,
    add column if not exists is_public_enabled boolean not null default true,
    add column if not exists sort_order integer not null default 100,
    add column if not exists engine_costing_map jsonb not null default '{}'::jsonb;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_profiles_profile_kind_chk'
          and conrelid = 'routing.routing_profiles'::regclass
    ) then
        alter table routing.routing_profiles
            add constraint routing_profiles_profile_kind_chk check (
                profile_kind in ('road', 'multimodal')
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_profiles_sort_order_chk'
          and conrelid = 'routing.routing_profiles'::regclass
    ) then
        alter table routing.routing_profiles
            add constraint routing_profiles_sort_order_chk check (sort_order >= 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_profiles_primary_physical_mode_code_fkey'
          and conrelid = 'routing.routing_profiles'::regclass
    ) then
        alter table routing.routing_profiles
            add constraint routing_profiles_primary_physical_mode_code_fkey
                foreign key (primary_physical_mode_code)
                references routing.routing_physical_modes (code)
                on update cascade
                on delete set null;
    end if;
end $$;

create index if not exists routing_profiles_code_idx
    on routing.routing_profiles (code);

create index if not exists routing_profiles_public_enabled_idx
    on routing.routing_profiles (is_public_enabled)
    where is_public_enabled = true;

comment on column routing.routing_profiles.engine_costing_map is
    'Per-engine costing keys, e.g. {"valhalla":"auto","otp":null}. Not engine-internal graph data.';

-- ---------------------------------------------------------------------------
-- 4. routing.routing_engine_configs
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_engine_configs (
    id bigserial primary key,
    engine_code text not null,
    name text not null,
    description text,
    base_url text,
    config jsonb not null default '{}'::jsonb,
    is_enabled boolean not null default false,
    is_default boolean not null default false,
    version_label text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_engine_configs_engine_code_key unique (engine_code),
    constraint routing_engine_configs_engine_code_chk check (
        engine_code in ('valhalla', 'otp', 'external')
    ),
    constraint routing_engine_configs_engine_code_nonempty_chk check (btrim(engine_code) <> '')
);

create index if not exists routing_engine_configs_engine_code_idx
    on routing.routing_engine_configs (engine_code);

create index if not exists routing_engine_configs_enabled_idx
    on routing.routing_engine_configs (is_enabled)
    where is_enabled = true;

comment on table routing.routing_engine_configs is
    'Routing engine endpoints and non-secret configuration. Secrets stay in deployment env, not DB.';

-- ---------------------------------------------------------------------------
-- 5. routing.routing_builds
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_builds (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    engine_code text not null,
    region_code text,
    build_version text not null,
    build_label text,
    status text not null default 'draft',
    is_active boolean not null default false,
    is_public boolean not null default false,
    profile_codes text[] not null default '{}'::text[],
    source_description text,
    summary jsonb not null default '{}'::jsonb,
    smoke_test_summary jsonb not null default '{}'::jsonb,
    warning_count integer not null default 0,
    error_count integer not null default 0,
    started_at timestamptz,
    finished_at timestamptz,
    published_at timestamptz,
    published_by bigint,
    created_by bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_builds_status_chk check (
        status in (
            'draft',
            'building',
            'validating',
            'published',
            'failed',
            'archived',
            'rolled_back'
        )
    ),
    constraint routing_builds_warning_count_chk check (warning_count >= 0),
    constraint routing_builds_error_count_chk check (error_count >= 0),
    constraint routing_builds_engine_code_chk check (
        engine_code in ('valhalla', 'otp', 'external')
    ),
    constraint routing_builds_build_version_nonempty_chk check (btrim(build_version) <> ''),
    constraint routing_builds_engine_config_fkey
        foreign key (engine_code)
        references routing.routing_engine_configs (engine_code)
        on update cascade
);

create unique index if not exists routing_builds_public_id_uq
    on routing.routing_builds (public_id);

create index if not exists routing_builds_engine_region_idx
    on routing.routing_builds (engine_code, region_code);

create index if not exists routing_builds_status_idx
    on routing.routing_builds (status);

create index if not exists routing_builds_created_at_idx
    on routing.routing_builds (created_at desc);

-- One active public build per engine + region (NULL region = nationwide).
create unique index if not exists routing_builds_active_engine_region_uq
    on routing.routing_builds (
        engine_code,
        coalesce(region_code, '__national__')
    )
    where is_active = true;

comment on table routing.routing_builds is
    'Published routing engine build metadata (Valhalla tiles tarball, OTP graph, etc.). Not PostGIS edge storage.';

comment on column routing.routing_builds.summary is
    'Build stats and human-readable metadata (checksums, counts, tool versions). No engine-internal topology.';

-- ---------------------------------------------------------------------------
-- 6. routing.routing_build_sources
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_build_sources (
    id bigserial primary key,
    routing_build_id bigint not null references routing.routing_builds (id) on delete cascade,
    source_type text not null,
    source_ref text,
    source_refs jsonb not null default '{}'::jsonb,
    description text,
    created_at timestamptz not null default now(),
    constraint routing_build_sources_source_type_chk check (
        source_type in (
            'osm_pbf',
            'core_streets_export',
            'routing_barriers',
            'publish_batch',
            'review_batch',
            'source_snapshot',
            'manual',
            'other'
        )
    ),
    constraint routing_build_sources_source_type_nonempty_chk check (btrim(source_type) <> '')
);

create index if not exists routing_build_sources_build_id_idx
    on routing.routing_build_sources (routing_build_id);

create index if not exists routing_build_sources_source_type_idx
    on routing.routing_build_sources (source_type);

comment on table routing.routing_build_sources is
    'Lineage inputs for a routing build (OSM extract, publish batch, barrier export).';

-- Optional FK to system.publish_batches when present.
do $$
begin
    if to_regclass('system.system_publish_batches') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_build_sources_publish_batch_id_fkey'
              and conrelid = 'routing.routing_build_sources'::regclass
        )
    then
        alter table routing.routing_build_sources
            add column if not exists source_publish_batch_id bigint,
            add constraint routing_build_sources_publish_batch_id_fkey
                foreign key (source_publish_batch_id)
                references system.system_publish_batches (id)
                on delete set null;
    end if;

    if to_regclass('import_review.review_batches') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_build_sources_review_batch_id_fkey'
              and conrelid = 'routing.routing_build_sources'::regclass
        )
    then
        alter table routing.routing_build_sources
            add column if not exists source_review_batch_id bigint,
            add constraint routing_build_sources_review_batch_id_fkey
                foreign key (source_review_batch_id)
                references import_review.review_batches (id)
                on delete set null;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. routing.routing_build_artifacts
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_build_artifacts (
    id bigserial primary key,
    routing_build_id bigint not null references routing.routing_builds (id) on delete cascade,
    artifact_type text not null,
    storage_url text,
    checksum_sha256 text,
    file_size_bytes bigint,
    content_type text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_build_artifacts_artifact_type_chk check (
        artifact_type in (
            'valhalla_tiles',
            'valhalla_config',
            'otp_graph',
            'otp_config',
            'extract_pbf',
            'smoke_test_log',
            'build_manifest',
            'other'
        )
    ),
    constraint routing_build_artifacts_artifact_type_nonempty_chk check (btrim(artifact_type) <> ''),
    constraint routing_build_artifacts_file_size_chk check (
        file_size_bytes is null or file_size_bytes >= 0
    )
);

create index if not exists routing_build_artifacts_build_id_idx
    on routing.routing_build_artifacts (routing_build_id);

create index if not exists routing_build_artifacts_type_idx
    on routing.routing_build_artifacts (artifact_type);

comment on table routing.routing_build_artifacts is
    'Pointers to built artifacts (R2/CDN URLs, checksums). Engine loads these; DB stores metadata only.';

-- ---------------------------------------------------------------------------
-- 8. routing.routing_validation_reports (extend 049)
-- ---------------------------------------------------------------------------
alter table routing.routing_validation_reports
    add column if not exists routing_build_id bigint,
    add column if not exists report_scope text not null default 'graph_build',
    add column if not exists updated_at timestamptz not null default now();

-- Legacy graph-build rows require build_job_id; engine builds use routing_build_id.
alter table routing.routing_validation_reports
    alter column build_job_id drop not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_validation_reports_routing_build_id_fkey'
          and conrelid = 'routing.routing_validation_reports'::regclass
    ) then
        alter table routing.routing_validation_reports
            add constraint routing_validation_reports_routing_build_id_fkey
                foreign key (routing_build_id)
                references routing.routing_builds (id)
                on delete cascade;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_validation_reports_target_chk'
          and conrelid = 'routing.routing_validation_reports'::regclass
    ) then
        alter table routing.routing_validation_reports
            add constraint routing_validation_reports_target_chk check (
                (
                    build_job_id is not null
                    and routing_build_id is null
                )
                or (
                    build_job_id is null
                    and routing_build_id is not null
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'routing_validation_reports_report_scope_chk'
          and conrelid = 'routing.routing_validation_reports'::regclass
    ) then
        alter table routing.routing_validation_reports
            add constraint routing_validation_reports_report_scope_chk check (
                report_scope in (
                    'graph_build',
                    'engine_build',
                    'smoke_test',
                    'publish',
                    'request'
                )
            );
    end if;
end $$;

create index if not exists routing_validation_reports_routing_build_id_idx
    on routing.routing_validation_reports (routing_build_id)
    where routing_build_id is not null;

-- ---------------------------------------------------------------------------
-- 9. routing.routing_service_health
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_service_health (
    id bigserial primary key,
    engine_code text not null,
    region_code text,
    status text not null default 'unknown',
    last_check_at timestamptz,
    last_success_at timestamptz,
    latency_ms integer,
    message text,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_service_health_status_chk check (
        status in ('healthy', 'degraded', 'down', 'unknown')
    ),
    constraint routing_service_health_engine_code_chk check (
        engine_code in ('valhalla', 'otp', 'external')
    ),
    constraint routing_service_health_latency_chk check (
        latency_ms is null or latency_ms >= 0
    ),
    constraint routing_service_health_engine_config_fkey
        foreign key (engine_code)
        references routing.routing_engine_configs (engine_code)
        on update cascade
);

create index if not exists routing_service_health_engine_idx
    on routing.routing_service_health (engine_code);

create unique index if not exists routing_service_health_engine_region_uq
    on routing.routing_service_health (
        engine_code,
        coalesce(region_code, '__national__')
    );

comment on table routing.routing_service_health is
    'Latest health probe per routing engine (and optional region). Updated by ops/API monitors.';

-- ---------------------------------------------------------------------------
-- 10. routing.routing_requests
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_requests (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    profile_code text not null,
    engine_code text not null,
    routing_build_id bigint references routing.routing_builds (id) on delete set null,
    status text not null default 'success',
    from_lon numeric not null,
    from_lat numeric not null,
    to_lon numeric not null,
    to_lat numeric not null,
    distance_m numeric,
    duration_s numeric,
    request_summary jsonb not null default '{}'::jsonb,
    response_summary jsonb not null default '{}'::jsonb,
    error_code text,
    error_message text,
    duration_ms integer,
    user_id bigint,
    session_id text,
    client_ip_hash text,
    created_at timestamptz not null default now(),
    constraint routing_requests_status_chk check (
        status in ('success', 'error', 'timeout', 'rejected')
    ),
    constraint routing_requests_engine_code_chk check (
        engine_code in ('valhalla', 'otp', 'external')
    ),
    constraint routing_requests_from_lon_chk check (from_lon >= -180 and from_lon <= 180),
    constraint routing_requests_from_lat_chk check (from_lat >= -90 and from_lat <= 90),
    constraint routing_requests_to_lon_chk check (to_lon >= -180 and to_lon <= 180),
    constraint routing_requests_to_lat_chk check (to_lat >= -90 and to_lat <= 90),
    constraint routing_requests_distance_m_chk check (distance_m is null or distance_m >= 0),
    constraint routing_requests_duration_s_chk check (duration_s is null or duration_s >= 0),
    constraint routing_requests_duration_ms_chk check (duration_ms is null or duration_ms >= 0),
    constraint routing_requests_profile_code_fkey
        foreign key (profile_code)
        references routing.routing_profiles (code)
        on update cascade
);

create unique index if not exists routing_requests_public_id_uq
    on routing.routing_requests (public_id);

create index if not exists routing_requests_created_at_idx
    on routing.routing_requests (created_at desc);

create index if not exists routing_requests_profile_code_idx
    on routing.routing_requests (profile_code);

create index if not exists routing_requests_engine_code_idx
    on routing.routing_requests (engine_code);

comment on table routing.routing_requests is
    'Audit log of routing API requests. Stores summaries only — not full route geometries.';

comment on column routing.routing_requests.response_summary is
    'Compact response metadata (leg count, bbox, units). Full GeoJSON stays ephemeral in API layer.';

-- ---------------------------------------------------------------------------
-- 11. routing.routing_feedback
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_feedback (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    routing_request_id bigint references routing.routing_requests (id) on delete set null,
    problem_type text not null,
    status text not null default 'open',
    comment text,
    metadata jsonb not null default '{}'::jsonb,
    user_id bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_feedback_problem_type_chk check (
        problem_type in (
            'wrong_route',
            'missing_road',
            'blocked_road',
            'unsafe_path',
            'wrong_duration',
            'wrong_mode',
            'other'
        )
    ),
    constraint routing_feedback_status_chk check (
        status in ('open', 'triaged', 'resolved', 'dismissed')
    ),
    constraint routing_feedback_problem_type_nonempty_chk check (btrim(problem_type) <> '')
);

create unique index if not exists routing_feedback_public_id_uq
    on routing.routing_feedback (public_id);

create index if not exists routing_feedback_status_problem_type_idx
    on routing.routing_feedback (status, problem_type);

create index if not exists routing_feedback_created_at_idx
    on routing.routing_feedback (created_at desc);

comment on table routing.routing_feedback is
    'User-reported routing issues linked optionally to a routing_requests audit row.';

-- ---------------------------------------------------------------------------
-- Seeds: physical modes
-- ---------------------------------------------------------------------------
insert into routing.routing_physical_modes (
    code,
    name,
    description,
    sort_order,
    is_routing_enabled,
    is_public_enabled
)
values
    (
        'walk',
        'Walk',
        'Pedestrian travel.',
        10,
        true,
        true
    ),
    (
        'car',
        'Car',
        'Private motor car / auto.',
        20,
        true,
        true
    ),
    (
        'motorcycle',
        'Motorcycle',
        'Motorcycle and similar two-wheel motor vehicles.',
        30,
        true,
        true
    ),
    (
        'bus',
        'Bus',
        'Road-based public bus (disabled until OTP/transit routing).',
        40,
        false,
        false
    ),
    (
        'rail',
        'Rail',
        'Rail-based transit (disabled until OTP).',
        50,
        false,
        false
    ),
    (
        'ferry',
        'Ferry',
        'Ferry crossings (disabled).',
        60,
        false,
        false
    ),
    (
        'air',
        'Air',
        'Air travel (disabled).',
        70,
        false,
        false
    )
on conflict (code) do update
set
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_routing_enabled = excluded.is_routing_enabled,
    is_public_enabled = excluded.is_public_enabled,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Seeds: service classes
-- ---------------------------------------------------------------------------
insert into routing.routing_service_classes (code, name, description, sort_order, is_active)
values
    ('local', 'Local', 'Urban and suburban local services.', 10, true),
    ('express', 'Express', 'Express and limited-stop services.', 20, true),
    ('intercity', 'Intercity', 'Long-distance intercity services.', 30, true),
    ('premium', 'Premium', 'Premium or higher-fare service tier.', 40, true),
    (
        'airport_shuttle',
        'Airport shuttle',
        'Airport transfer and shuttle services.',
        50,
        true
    )
on conflict (code) do update
set
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Seeds: engine configs (disabled until deployment wires URLs)
-- ---------------------------------------------------------------------------
insert into routing.routing_engine_configs (
    engine_code,
    name,
    description,
    is_enabled,
    is_default,
    version_label,
    config
)
values
    (
        'valhalla',
        'Valhalla',
        'Primary road routing engine (walk, auto, motorcycle costing).',
        false,
        true,
        null,
        '{"modes":["walk","car","motorcycle"]}'::jsonb
    ),
    (
        'otp',
        'OpenTripPlanner',
        'Multimodal transit routing (future).',
        false,
        false,
        null,
        '{"modes":["bus","rail","ferry","walk"]}'::jsonb
    ),
    (
        'external',
        'External provider',
        'Fallback or third-party routing adapter.',
        false,
        false,
        null,
        '{}'::jsonb
    )
on conflict (engine_code) do update
set
    name = excluded.name,
    description = excluded.description,
    is_default = excluded.is_default,
    config = excluded.config,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Seeds: profiles (public API + legacy graph-build codes)
-- ---------------------------------------------------------------------------
insert into routing.routing_profiles (
    code,
    name,
    description,
    default_speed_kph,
    is_active,
    profile_kind,
    primary_physical_mode_code,
    is_routing_enabled,
    is_public_enabled,
    sort_order,
    engine_costing_map
)
values
    (
        'walk',
        'Walk',
        'Pedestrian directions.',
        5,
        true,
        'road',
        'walk',
        true,
        true,
        10,
        '{"valhalla":"pedestrian"}'::jsonb
    ),
    (
        'car',
        'Car',
        'Car / auto directions.',
        50,
        true,
        'road',
        'car',
        true,
        true,
        20,
        '{"valhalla":"auto"}'::jsonb
    ),
    (
        'motorcycle',
        'Motorcycle',
        'Motorcycle directions.',
        45,
        true,
        'road',
        'motorcycle',
        true,
        true,
        30,
        '{"valhalla":"motorcycle"}'::jsonb
    ),
    (
        'multimodal',
        'Multimodal',
        'Walk + transit combined (disabled until OTP).',
        null,
        false,
        'multimodal',
        'walk',
        false,
        false,
        90,
        '{"valhalla":null,"otp":"multimodal"}'::jsonb
    ),
    (
        'drive',
        'Drive (legacy)',
        'Legacy validation graph profile from Phase 9E. Not for public Valhalla routing.',
        50,
        true,
        'road',
        'car',
        false,
        false,
        80,
        '{"valhalla":"auto"}'::jsonb
    ),
    (
        'bus',
        'Bus (legacy)',
        'Legacy graph-build bus profile. Public bus routing uses OTP when enabled.',
        30,
        false,
        'road',
        'bus',
        false,
        false,
        85,
        '{"valhalla":null,"otp":"transit"}'::jsonb
    )
on conflict (code) do update
set
    name = excluded.name,
    description = excluded.description,
    default_speed_kph = coalesce(excluded.default_speed_kph, routing.routing_profiles.default_speed_kph),
    is_active = excluded.is_active,
    profile_kind = excluded.profile_kind,
    primary_physical_mode_code = excluded.primary_physical_mode_code,
    is_routing_enabled = excluded.is_routing_enabled,
    is_public_enabled = excluded.is_public_enabled,
    sort_order = excluded.sort_order,
    engine_costing_map = excluded.engine_costing_map,
    updated_at = now();

-- Initial health rows (unknown until probes run).
insert into routing.routing_service_health (engine_code, region_code, status, message)
select v.engine_code, v.region_code, v.status, v.message
from (
    values
        ('valhalla'::text, null::text, 'unknown'::text, 'Awaiting first health probe.'::text),
        ('otp', null, 'unknown', 'OTP not enabled.'),
        ('external', null, 'unknown', 'External engine not configured.')
) as v (engine_code, region_code, status, message)
where not exists (
    select 1
    from routing.routing_service_health as h
    where h.engine_code = v.engine_code
      and h.region_code is not distinct from v.region_code
);

comment on schema routing is
    'Routing metadata: profiles, engine builds, request audit, and validation. '
    'PostGIS graph tables (routing_nodes/edges) are validation-only; Valhalla/OTP graphs live outside the DB.';

commit;

-- =============================================================================
-- Verification (run manually after apply)
-- =============================================================================
--
-- select code, is_routing_enabled, is_public_enabled
-- from routing.routing_physical_modes
-- order by sort_order;
--
-- select code, is_routing_enabled, is_public_enabled, engine_costing_map
-- from routing.routing_profiles
-- order by sort_order;
--
-- select engine_code, is_enabled, is_default from routing.routing_engine_configs;
--
-- select table_name
-- from information_schema.tables
-- where table_schema = 'routing'
--   and table_name in (
--       'routing_physical_modes',
--       'routing_service_classes',
--       'routing_engine_configs',
--       'routing_builds',
--       'routing_build_sources',
--       'routing_build_artifacts',
--       'routing_service_health',
--       'routing_requests',
--       'routing_feedback'
--   )
-- order by table_name;
--
-- =============================================================================
-- Rollback (manual — no down migration file in this repo)
-- =============================================================================
--
-- Apply only if 060 was just applied and no production routing_builds/requests exist.
-- Drop in dependency order after clearing child rows:
--
-- truncate routing.routing_feedback cascade;
-- truncate routing.routing_requests cascade;
-- truncate routing.routing_validation_reports cascade;  -- only rows with routing_build_id
-- truncate routing.routing_build_artifacts cascade;
-- truncate routing.routing_build_sources cascade;
-- truncate routing.routing_builds cascade;
-- truncate routing.routing_service_health cascade;
-- drop table if exists routing.routing_feedback;
-- drop table if exists routing.routing_requests;
-- drop table if exists routing.routing_build_artifacts;
-- drop table if exists routing.routing_build_sources;
-- drop table if exists routing.routing_builds;
-- drop table if exists routing.routing_service_health;
-- drop table if exists routing.routing_engine_configs;
-- drop table if exists routing.routing_service_classes;
-- drop table if exists routing.routing_physical_modes;
--
-- Revert routing_validation_reports / routing_profiles column additions only if needed
-- (see ALTER reversals in a dedicated rollback script).
