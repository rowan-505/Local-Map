-- =============================================================================
-- Supabase migration 074: transport pipeline — review fields, API aliases, OTP
-- =============================================================================
--
-- Purpose:
--   Completes the transport data pipeline on top of migrations 066–068:
--
--     import_transport  (messy ingest + validation + promotion queue)
--           ↓ admin-reviewed promotion
--     core_transport    (verified production network for map/search/API)
--           ↓ GTFS exporter job (reads core_transport only; writes artifacts)
--     gtfs_export       (export batch metadata, files, validation, OTP builds)
--           ↓ static GTFS zip / graph artifact on disk or object storage
--     OpenTripPlanner     (loads published GTFS/graph files — NEVER reads Postgres)
--
-- Rules:
--   - Does NOT drop or modify core.core_bus_* (deprecated; kept until cutover).
--   - Non-destructive: ALTER ADD COLUMN, CREATE TABLE/VIEW/INDEX, COMMENT only.
--   - confidence_score uses 0–100 scale everywhere.
--   - Preserves external_id, source_refs, normalized_data on candidate rows.
--
-- Depends on:
--   066_create_import_transport_schema.sql
--   067_create_core_transport_schema.sql
--   068_create_gtfs_export_schema.sql
--
-- Apply after 066–068 (and optional 069–071). Safe to re-run (idempotent guards).
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Pipeline documentation (schema-level)
-- ---------------------------------------------------------------------------
comment on schema import_transport is
    'Staging for external transport feeds (GTFS, operator CSV, manual uploads). '
    'Messy candidates land here → validation → promotion into core_transport. '
    'Not production map data. Legacy core.core_bus_* and import_review bus queues '
    'are separate deprecated paths.';

comment on schema core_transport is
    'Production source of truth for verified operators, routes, stops, and patterns. '
    'Map tiles, search, and API read this schema. GTFS export jobs read this schema '
    'only. OpenTripPlanner must consume published GTFS/graph files — not Postgres.';

comment on schema gtfs_export is
    'Tracks GTFS bundle builds exported from core_transport, validator output, and '
    'OpenTripPlanner graph build metadata. Stores artifact paths/checksums only — '
    'OTP never connects to the database directly.';

-- ---------------------------------------------------------------------------
-- Shared mode_type / transport_mode values (product vocabulary)
-- local_bus | express_bus | train | ferry | airport_access
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- import_transport: review workflow columns on ingest candidate tables
-- (physical tables remain raw_* from 066; API-facing views use *_candidates)
-- ---------------------------------------------------------------------------

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
        if to_regclass('import_transport.' || tbl) is null then
            raise notice 'import_transport.% not found — skipping review columns', tbl;
            continue;
        end if;

        execute format(
            'alter table import_transport.%I
                add column if not exists external_id text null',
            tbl
        );
        execute format(
            'alter table import_transport.%I
                add column if not exists review_status text not null default ''pending''',
            tbl
        );
        execute format(
            'alter table import_transport.%I
                add column if not exists review_decision text null',
            tbl
        );
        execute format(
            'alter table import_transport.%I
                add column if not exists promotion_status text null',
            tbl
        );
        execute format(
            'alter table import_transport.%I
                add column if not exists review_note text null',
            tbl
        );

        if tbl = 'raw_route_stops' then
            execute format(
                'alter table import_transport.%I
                    add column if not exists source_refs jsonb not null default ''{}''::jsonb',
                tbl
            );
        end if;
    end loop;
end $$;

-- Backfill external_id from legacy source_* columns when empty.
update import_transport.raw_routes
set external_id = source_route_id
where external_id is null or btrim(external_id) = '';

update import_transport.raw_stops
set external_id = source_stop_id
where external_id is null or btrim(external_id) = '';

update import_transport.raw_route_variants
set external_id = source_variant_id
where external_id is null or btrim(external_id) = '';

update import_transport.raw_route_stops
set external_id = coalesce(nullif(btrim(source_route_stop_id), ''), source_variant_id || ':' || source_stop_id)
where external_id is null or btrim(external_id) = '';

-- Check constraints (add only when missing).
do $$
begin
    if to_regclass('import_transport.raw_routes') is not null
        and not exists (
            select 1 from pg_constraint
            where conname = 'raw_routes_review_status_chk'
              and conrelid = 'import_transport.raw_routes'::regclass
        )
    then
        alter table import_transport.raw_routes
            add constraint raw_routes_review_status_chk check (
                review_status in (
                    'pending',
                    'needs_review',
                    'needs_more_review',
                    'approved',
                    'rejected',
                    'ignored',
                    'promoted',
                    'promotion_failed'
                )
            );
    end if;

    if to_regclass('import_transport.raw_stops') is not null
        and not exists (
            select 1 from pg_constraint
            where conname = 'raw_stops_review_status_chk'
              and conrelid = 'import_transport.raw_stops'::regclass
        )
    then
        alter table import_transport.raw_stops
            add constraint raw_stops_review_status_chk check (
                review_status in (
                    'pending',
                    'needs_review',
                    'needs_more_review',
                    'approved',
                    'rejected',
                    'ignored',
                    'promoted',
                    'promotion_failed'
                )
            );
    end if;

    if to_regclass('import_transport.raw_route_variants') is not null
        and not exists (
            select 1 from pg_constraint
            where conname = 'raw_route_variants_review_status_chk'
              and conrelid = 'import_transport.raw_route_variants'::regclass
        )
    then
        alter table import_transport.raw_route_variants
            add constraint raw_route_variants_review_status_chk check (
                review_status in (
                    'pending',
                    'needs_review',
                    'needs_more_review',
                    'approved',
                    'rejected',
                    'ignored',
                    'promoted',
                    'promotion_failed'
                )
            );
    end if;

    if to_regclass('import_transport.raw_route_stops') is not null
        and not exists (
            select 1 from pg_constraint
            where conname = 'raw_route_stops_review_status_chk'
              and conrelid = 'import_transport.raw_route_stops'::regclass
        )
    then
        alter table import_transport.raw_route_stops
            add constraint raw_route_stops_review_status_chk check (
                review_status in (
                    'pending',
                    'needs_review',
                    'needs_more_review',
                    'approved',
                    'rejected',
                    'ignored',
                    'promoted',
                    'promotion_failed'
                )
            );
    end if;
end $$;

create index if not exists raw_routes_import_batch_review_status_idx
    on import_transport.raw_routes (import_batch_id, review_status);

create index if not exists raw_stops_import_batch_review_status_idx
    on import_transport.raw_stops (import_batch_id, review_status);

create index if not exists raw_route_variants_import_batch_review_status_idx
    on import_transport.raw_route_variants (import_batch_id, review_status);

create index if not exists raw_route_stops_import_batch_review_status_idx
    on import_transport.raw_route_stops (import_batch_id, review_status);

create index if not exists raw_routes_external_id_idx
    on import_transport.raw_routes (import_batch_id, external_id)
    where external_id is not null;

create index if not exists raw_stops_external_id_idx
    on import_transport.raw_stops (import_batch_id, external_id)
    where external_id is not null;

-- ---------------------------------------------------------------------------
-- import_transport: API-facing candidate views (*_candidates naming)
-- ---------------------------------------------------------------------------

create or replace view import_transport.route_candidates as
select
    r.id,
    r.import_batch_id,
    r.external_id,
    r.source_route_id,
    r.route_code,
    r.route_name,
    r.public_name,
    r.transport_mode as mode_type,
    r.route_type,
    r.directionality,
    r.match_status,
    r.validation_status,
    r.review_status,
    r.review_decision,
    r.promotion_status,
    r.review_note,
    r.confidence_score,
    r.raw_payload,
    r.normalized_data,
    r.source_refs,
    r.created_at,
    r.updated_at
from import_transport.raw_routes as r;

comment on view import_transport.route_candidates is
    'Dashboard/API alias for import_transport.raw_routes with review workflow fields.';

create or replace view import_transport.stop_candidates as
select
    s.id,
    s.import_batch_id,
    s.external_id,
    s.source_stop_id,
    s.stop_code,
    s.stop_name,
    s.stop_name_local,
    s.location_type,
    s.geom,
    s.admin_area_code,
    s.match_status,
    s.validation_status,
    s.review_status,
    s.review_decision,
    s.promotion_status,
    s.review_note,
    s.confidence_score,
    s.raw_payload,
    s.normalized_data,
    s.source_refs,
    s.created_at,
    s.updated_at
from import_transport.raw_stops as s;

comment on view import_transport.stop_candidates is
    'Dashboard/API alias for import_transport.raw_stops with review workflow fields.';

create or replace view import_transport.route_variant_candidates as
select
    v.id,
    v.import_batch_id,
    v.raw_route_id,
    v.external_id,
    v.source_variant_id,
    v.source_route_id,
    v.variant_code,
    v.direction_name,
    v.origin_name,
    v.destination_name,
    v.geom,
    v.distance_m,
    v.match_status,
    v.validation_status,
    v.review_status,
    v.review_decision,
    v.promotion_status,
    v.review_note,
    v.confidence_score,
    v.raw_payload,
    v.normalized_data,
    v.source_refs,
    v.created_at,
    v.updated_at
from import_transport.raw_route_variants as v;

comment on view import_transport.route_variant_candidates is
    'Dashboard/API alias for import_transport.raw_route_variants.';

create or replace view import_transport.route_stop_candidates as
select
    rs.id,
    rs.import_batch_id,
    rs.raw_route_variant_id,
    rs.raw_stop_id,
    rs.external_id,
    rs.source_route_stop_id,
    rs.source_variant_id,
    rs.source_stop_id,
    rs.stop_sequence,
    rs.distance_from_start_m,
    rs.is_timing_point,
    rs.match_status,
    rs.validation_status,
    rs.review_status,
    rs.review_decision,
    rs.promotion_status,
    rs.review_note,
    rs.confidence_score,
    rs.raw_payload,
    rs.normalized_data,
    rs.source_refs,
    rs.created_at,
    rs.updated_at
from import_transport.raw_route_stops as rs;

comment on view import_transport.route_stop_candidates is
    'Dashboard/API alias for import_transport.raw_route_stops.';

-- ---------------------------------------------------------------------------
-- import_transport.promotion_stage_logs
-- ---------------------------------------------------------------------------
create table if not exists import_transport.promotion_stage_logs (
    id bigserial primary key,
    promotion_batch_id bigint not null
        references import_transport.promotion_batches (id) on delete cascade,
    stage_key text not null,
    stage_label text not null,
    stage_status text not null default 'running',
    message text null,
    progress_percent numeric not null default 0,
    details jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default now(),
    finished_at timestamptz null,
    constraint promotion_stage_logs_stage_key_nonempty_chk check (btrim(stage_key) <> ''),
    constraint promotion_stage_logs_stage_label_nonempty_chk check (btrim(stage_label) <> ''),
    constraint promotion_stage_logs_stage_status_chk check (
        stage_status in ('pending', 'running', 'success', 'warning', 'failed', 'skipped')
    ),
    constraint promotion_stage_logs_progress_percent_chk check (
        progress_percent >= 0 and progress_percent <= 100
    ),
    constraint promotion_stage_logs_finished_after_started_chk check (
        finished_at is null or finished_at >= started_at
    )
);

create index if not exists promotion_stage_logs_batch_started_idx
    on import_transport.promotion_stage_logs (promotion_batch_id, started_at);

create index if not exists promotion_stage_logs_batch_stage_key_idx
    on import_transport.promotion_stage_logs (promotion_batch_id, stage_key);

comment on table import_transport.promotion_stage_logs is
    'Per-stage timeline for import_transport → core_transport promotion batches.';

-- ---------------------------------------------------------------------------
-- gtfs_export: export_batches alias (canonical table remains export_builds from 068)
-- ---------------------------------------------------------------------------
create or replace view gtfs_export.export_batches as
select
    id,
    build_code,
    scope,
    status,
    output_path,
    file_size_bytes,
    checksum,
    route_count,
    variant_count,
    stop_count,
    service_count,
    warning_count,
    error_count,
    started_at,
    finished_at,
    created_at,
    notes
from gtfs_export.export_builds;

comment on view gtfs_export.export_batches is
    'Alias view over gtfs_export.export_builds (one GTFS export run from core_transport).';

-- ---------------------------------------------------------------------------
-- gtfs_export.validation_reports
-- ---------------------------------------------------------------------------
create table if not exists gtfs_export.validation_reports (
    id bigserial primary key,
    export_build_id bigint not null
        references gtfs_export.export_builds (id) on delete cascade,
    validator_name text not null,
    validator_version text null,
    report_status text not null default 'completed',
    error_count integer not null default 0,
    warning_count integer not null default 0,
    info_count integer not null default 0,
    report_summary text null,
    report_payload jsonb not null default '{}'::jsonb,
    artifact_path text null,
    started_at timestamptz null,
    finished_at timestamptz null,
    created_at timestamptz not null default now(),
    constraint validation_reports_validator_name_nonempty_chk check (btrim(validator_name) <> ''),
    constraint validation_reports_report_status_chk check (
        report_status in ('pending', 'running', 'completed', 'failed', 'skipped')
    ),
    constraint validation_reports_error_count_chk check (error_count >= 0),
    constraint validation_reports_warning_count_chk check (warning_count >= 0),
    constraint validation_reports_info_count_chk check (info_count >= 0),
    constraint validation_reports_finished_after_started_chk check (
        finished_at is null or started_at is null or finished_at >= started_at
    )
);

create index if not exists validation_reports_export_build_id_idx
    on gtfs_export.validation_reports (export_build_id);

create index if not exists validation_reports_report_status_idx
    on gtfs_export.validation_reports (export_build_id, report_status);

create index if not exists validation_reports_created_at_desc_idx
    on gtfs_export.validation_reports (created_at desc);

comment on table gtfs_export.validation_reports is
    'Aggregate GTFS validator report for an export batch (companion to validation_issues rows).';

comment on column gtfs_export.validation_reports.artifact_path is
    'Optional path to full validator JSON/HTML report on object storage.';

-- ---------------------------------------------------------------------------
-- gtfs_export.otp_graph_builds
-- OpenTripPlanner consumes static graph/GTFS artifacts — not Postgres.
-- ---------------------------------------------------------------------------
create table if not exists gtfs_export.otp_graph_builds (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    export_build_id bigint null
        references gtfs_export.export_builds (id) on delete set null,
    build_code text not null,
    scope text not null,
    otp_version text null,
    graph_artifact_path text null,
    gtfs_input_path text null,
    build_status text not null default 'draft',
    node_count integer null,
    edge_count integer null,
    file_size_bytes bigint null,
    checksum text null,
    error_message text null,
    metadata jsonb not null default '{}'::jsonb,
    started_at timestamptz null,
    finished_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint otp_graph_builds_public_id_key unique (public_id),
    constraint otp_graph_builds_build_code_key unique (build_code),
    constraint otp_graph_builds_build_code_nonempty_chk check (btrim(build_code) <> ''),
    constraint otp_graph_builds_scope_nonempty_chk check (btrim(scope) <> ''),
    constraint otp_graph_builds_build_status_chk check (
        build_status in (
            'draft',
            'queued',
            'building',
            'built',
            'smoke_testing',
            'published',
            'failed',
            'archived'
        )
    ),
    constraint otp_graph_builds_node_count_chk check (node_count is null or node_count >= 0),
    constraint otp_graph_builds_edge_count_chk check (edge_count is null or edge_count >= 0),
    constraint otp_graph_builds_file_size_bytes_chk check (
        file_size_bytes is null or file_size_bytes >= 0
    ),
    constraint otp_graph_builds_finished_after_started_chk check (
        finished_at is null or started_at is null or finished_at >= started_at
    )
);

create index if not exists otp_graph_builds_export_build_id_idx
    on gtfs_export.otp_graph_builds (export_build_id)
    where export_build_id is not null;

create index if not exists otp_graph_builds_build_status_idx
    on gtfs_export.otp_graph_builds (build_status);

create index if not exists otp_graph_builds_scope_idx
    on gtfs_export.otp_graph_builds (scope);

create index if not exists otp_graph_builds_created_at_desc_idx
    on gtfs_export.otp_graph_builds (created_at desc);

comment on table gtfs_export.otp_graph_builds is
    'OpenTripPlanner graph build metadata. OTP loads gtfs_input_path/graph_artifact_path '
    'from disk or object storage — it must never query Postgres directly.';

comment on column gtfs_export.otp_graph_builds.gtfs_input_path is
    'GTFS zip or directory path fed into the OTP graph builder for this build.';

comment on column gtfs_export.otp_graph_builds.graph_artifact_path is
    'Published OTP graph directory or archive path after a successful build.';

-- ---------------------------------------------------------------------------
-- core_transport: document mode_type vocabulary on route_type columns
-- ---------------------------------------------------------------------------
comment on column core_transport.routes.route_type is
    'Mode type: local_bus, express_bus, train, ferry, airport_access (0–100 confidence elsewhere).';

comment on column core_transport.operators.primary_route_type is
    'Primary mode type for the operator (local_bus, express_bus, train, ferry, airport_access).';

commit;
