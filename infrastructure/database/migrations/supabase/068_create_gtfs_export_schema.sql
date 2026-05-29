-- =============================================================================
-- Supabase migration 068: gtfs_export schema (GTFS build tracking for OTP)
-- =============================================================================
--
-- Purpose:
--   Track GTFS zip/text bundle builds generated from core_transport for
--   OpenTripPlanner graph builds, smoke tests, and later production publish.
--   Stores build metadata, per-file inventory, and validator findings — not
--   the production transport network itself (see core_transport).
--
-- Safety:
--   - Non-destructive: CREATE SCHEMA/TABLE/INDEX only.
--   - Does NOT modify import_transport.*, core_transport.*, core.core_bus_*,
--     tiles.*, or application code.
--
-- Depends on: none (logical source is core_transport exporter jobs).
--
-- Apply: Supabase SQL Editor or your usual migration workflow. Do not run from CI
-- without review.
--
-- =============================================================================

begin;

create schema if not exists gtfs_export;

comment on schema gtfs_export is
    'Generated GTFS feed builds from core_transport for OTP testing and production. '
    'Tracks export artifacts, checksums, counts, and validation results — not live vehicle data.';

-- ---------------------------------------------------------------------------
-- 1. gtfs_export.export_builds
-- ---------------------------------------------------------------------------
create table if not exists gtfs_export.export_builds (
    id bigserial primary key,
    build_code text not null,
    scope text not null,
    status text not null default 'draft',
    output_path text null,
    file_size_bytes bigint null,
    checksum text null,
    route_count integer not null default 0,
    variant_count integer not null default 0,
    stop_count integer not null default 0,
    service_count integer not null default 0,
    warning_count integer not null default 0,
    error_count integer not null default 0,
    started_at timestamptz null,
    finished_at timestamptz null,
    created_at timestamptz not null default now(),
    notes text null,
    constraint export_builds_build_code_key unique (build_code),
    constraint export_builds_build_code_nonempty_chk check (btrim(build_code) <> ''),
    constraint export_builds_scope_nonempty_chk check (btrim(scope) <> ''),
    constraint export_builds_status_chk check (
        status in (
            'draft',
            'building',
            'built',
            'validating',
            'valid',
            'invalid',
            'published',
            'failed'
        )
    ),
    constraint export_builds_file_size_bytes_chk check (
        file_size_bytes is null or file_size_bytes >= 0
    ),
    constraint export_builds_route_count_chk check (route_count >= 0),
    constraint export_builds_variant_count_chk check (variant_count >= 0),
    constraint export_builds_stop_count_chk check (stop_count >= 0),
    constraint export_builds_service_count_chk check (service_count >= 0),
    constraint export_builds_warning_count_chk check (warning_count >= 0),
    constraint export_builds_error_count_chk check (error_count >= 0),
    constraint export_builds_finished_after_started_chk check (
        finished_at is null
        or started_at is null
        or finished_at >= started_at
    )
);

create index if not exists export_builds_scope_idx
    on gtfs_export.export_builds (scope);

create index if not exists export_builds_status_idx
    on gtfs_export.export_builds (status);

create index if not exists export_builds_created_at_desc_idx
    on gtfs_export.export_builds (created_at desc);

create index if not exists export_builds_started_at_desc_idx
    on gtfs_export.export_builds (started_at desc nulls last)
    where started_at is not null;

comment on table gtfs_export.export_builds is
    'One GTFS export run (scoped bundle from core_transport) for OTP graph input and QA.';

comment on column gtfs_export.export_builds.build_code is
    'Unique human/machine id for this export (e.g. yangon_ybs_2026-05-29_a1b2).';

comment on column gtfs_export.export_builds.scope is
    'Export scope slug (e.g. yangon_local_bus, express_mandalay) defining core_transport row filters.';

comment on column gtfs_export.export_builds.output_path is
    'Storage path or URI of the built GTFS zip or output directory (R2, local artifact path).';

comment on column gtfs_export.export_builds.checksum is
    'Checksum of the primary GTFS archive (SHA-256 hex recommended).';

comment on column gtfs_export.export_builds.service_count is
    'Number of distinct service_id / calendar rows included in the export.';

-- ---------------------------------------------------------------------------
-- 2. gtfs_export.export_files
-- ---------------------------------------------------------------------------
create table if not exists gtfs_export.export_files (
    id bigserial primary key,
    export_build_id bigint not null references gtfs_export.export_builds (id) on delete cascade,
    file_name text not null,
    file_path text not null,
    row_count bigint null,
    checksum text null,
    created_at timestamptz not null default now(),
    constraint export_files_build_file_name_key unique (export_build_id, file_name),
    constraint export_files_file_name_nonempty_chk check (btrim(file_name) <> ''),
    constraint export_files_file_path_nonempty_chk check (btrim(file_path) <> ''),
    constraint export_files_row_count_chk check (row_count is null or row_count >= 0)
);

create index if not exists export_files_export_build_id_idx
    on gtfs_export.export_files (export_build_id);

create index if not exists export_files_file_name_idx
    on gtfs_export.export_files (file_name);

comment on table gtfs_export.export_files is
    'Per-file inventory inside a GTFS export build (agency.txt, stops.txt, routes.txt, etc.).';

comment on column gtfs_export.export_files.file_name is
    'GTFS filename (e.g. stops.txt, calendar.txt) within the bundle.';

comment on column gtfs_export.export_files.row_count is
    'Data rows exported (excluding header) when known.';

-- ---------------------------------------------------------------------------
-- 3. gtfs_export.validation_issues
-- ---------------------------------------------------------------------------
create table if not exists gtfs_export.validation_issues (
    id bigserial primary key,
    export_build_id bigint not null references gtfs_export.export_builds (id) on delete cascade,
    gtfs_file text not null,
    row_ref text null,
    issue_code text not null,
    severity text not null default 'warning',
    message text not null,
    issue_data jsonb not null default '{}'::jsonb,
    is_resolved boolean not null default false,
    created_at timestamptz not null default now(),
    constraint validation_issues_gtfs_file_nonempty_chk check (btrim(gtfs_file) <> ''),
    constraint validation_issues_issue_code_nonempty_chk check (btrim(issue_code) <> ''),
    constraint validation_issues_message_nonempty_chk check (btrim(message) <> ''),
    constraint validation_issues_severity_chk check (
        severity in ('info', 'warning', 'error')
    )
);

create index if not exists validation_issues_export_build_id_idx
    on gtfs_export.validation_issues (export_build_id);

create index if not exists validation_issues_export_build_severity_idx
    on gtfs_export.validation_issues (export_build_id, severity);

create index if not exists validation_issues_gtfs_file_idx
    on gtfs_export.validation_issues (export_build_id, gtfs_file);

create index if not exists validation_issues_is_resolved_idx
    on gtfs_export.validation_issues (export_build_id, is_resolved)
    where is_resolved = false;

create index if not exists validation_issues_issue_code_idx
    on gtfs_export.validation_issues (issue_code);

comment on table gtfs_export.validation_issues is
    'GTFS validator findings for an export build (structural, referential, OTP readiness).';

comment on column gtfs_export.validation_issues.gtfs_file is
    'GTFS file the issue relates to (e.g. stop_times.txt) or "bundle" for archive-level issues.';

comment on column gtfs_export.validation_issues.row_ref is
    'Optional row pointer: line number, stop_id, trip_id, or composite key string.';

comment on column gtfs_export.validation_issues.issue_data is
    'Machine-readable context (column names, referenced ids, validator rule id).';

commit;
