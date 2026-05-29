-- =============================================================================
-- Supabase migration 066: import_transport schema (raw external transport data)
-- =============================================================================
--
-- Purpose:
--   Staging area for messy, unverified transport datasets (GTFS, operator CSV,
--   corridor GeoJSON, manual uploads) before validation and promotion into
--   core_transport. This is NOT production map data and NOT import_review OSM
--   bus candidates — keep those flows separate.
--
-- Safety:
--   - Non-destructive: CREATE SCHEMA/TABLE/INDEX only.
--   - Does NOT modify core.core_bus_*, tiles.*, import_review.*, or API objects.
--
-- Depends on: PostGIS (geometry 4326).
--
-- Apply: Supabase SQL Editor or your usual migration workflow. Do not run from CI
-- without review.
--
-- =============================================================================

begin;

create extension if not exists postgis;
create extension if not exists pgcrypto;

create schema if not exists import_transport;

comment on schema import_transport is
    'Raw, messy external transport imports (GTFS, operator feeds, manual uploads) '
    'before validation and promotion into core_transport. Not production core; '
    'not OSM import_review bus candidates.';

-- ---------------------------------------------------------------------------
-- Shared check constraint helpers (inline per table)
-- Transport modes supported now and in near-term product scope.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. import_transport.source_datasets
-- ---------------------------------------------------------------------------
create table if not exists import_transport.source_datasets (
    id bigserial primary key,
    code text not null,
    name text not null,
    description text null,
    transport_mode text not null,
    source_format text not null,
    source_uri text null,
    provider_name text null,
    region_code text null,
    timezone text null default 'Asia/Yangon',
    is_active boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint source_datasets_code_key unique (code),
    constraint source_datasets_code_nonempty_chk check (btrim(code) <> ''),
    constraint source_datasets_name_nonempty_chk check (btrim(name) <> ''),
    constraint source_datasets_transport_mode_chk check (
        transport_mode in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint source_datasets_source_format_chk check (
        source_format in ('gtfs', 'gtfs_rt', 'csv', 'geojson', 'shapefile', 'api', 'manual', 'other')
    )
);

create index if not exists source_datasets_transport_mode_idx
    on import_transport.source_datasets (transport_mode);

create index if not exists source_datasets_region_code_idx
    on import_transport.source_datasets (region_code)
    where region_code is not null;

create index if not exists source_datasets_is_active_idx
    on import_transport.source_datasets (is_active)
    where is_active = true;

comment on table import_transport.source_datasets is
    'Catalog of external transport data sources (feeds, files, APIs) eligible for import batches.';

comment on column import_transport.source_datasets.transport_mode is
    'Primary mode: local_bus, express_bus, train, ferry, airport_access.';

-- ---------------------------------------------------------------------------
-- 2. import_transport.import_batches
-- ---------------------------------------------------------------------------
create table if not exists import_transport.import_batches (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    source_dataset_id bigint not null references import_transport.source_datasets (id) on delete restrict,
    batch_name text not null,
    import_status text not null default 'draft',
    validation_status text not null default 'not_started',
    source_file_name text null,
    source_file_checksum text null,
    source_snapshot_version text null,
    record_counts jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    error_message text null,
    imported_by bigint null,
    imported_at timestamptz null,
    validated_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint import_batches_public_id_key unique (public_id),
    constraint import_batches_batch_name_nonempty_chk check (btrim(batch_name) <> ''),
    constraint import_batches_import_status_chk check (
        import_status in (
            'draft',
            'queued',
            'importing',
            'imported',
            'validating',
            'validation_failed',
            'ready_for_promotion',
            'promoting',
            'promoted',
            'failed',
            'archived'
        )
    ),
    constraint import_batches_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    )
);

create index if not exists import_batches_source_dataset_id_idx
    on import_transport.import_batches (source_dataset_id);

create index if not exists import_batches_import_status_idx
    on import_transport.import_batches (import_status);

create index if not exists import_batches_validation_status_idx
    on import_transport.import_batches (validation_status);

create index if not exists import_batches_created_at_desc_idx
    on import_transport.import_batches (created_at desc);

comment on table import_transport.import_batches is
    'One ingest run for a source dataset. Holds batch-level import/validation status before promotion.';

-- ---------------------------------------------------------------------------
-- 3. import_transport.raw_operators
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_operators (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    source_operator_id text not null,
    operator_code text null,
    operator_name text null,
    transport_mode text not null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_operators_source_operator_batch_uq unique (import_batch_id, source_operator_id),
    constraint raw_operators_transport_mode_chk check (
        transport_mode in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint raw_operators_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_operators_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_operators_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists raw_operators_import_batch_id_idx
    on import_transport.raw_operators (import_batch_id);

create index if not exists raw_operators_source_operator_id_idx
    on import_transport.raw_operators (source_operator_id);

create index if not exists raw_operators_operator_code_idx
    on import_transport.raw_operators (operator_code)
    where operator_code is not null;

create index if not exists raw_operators_match_status_idx
    on import_transport.raw_operators (import_batch_id, match_status);

comment on table import_transport.raw_operators is
    'Raw agency/operator rows from external feeds before core_transport promotion.';

-- ---------------------------------------------------------------------------
-- 4. import_transport.raw_routes
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_routes (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_operator_id bigint null references import_transport.raw_operators (id) on delete set null,
    source_route_id text not null,
    source_operator_id text null,
    route_code text null,
    route_name text null,
    public_name text null,
    transport_mode text not null,
    route_type text null,
    directionality text null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_routes_source_route_batch_uq unique (import_batch_id, source_route_id),
    constraint raw_routes_transport_mode_chk check (
        transport_mode in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint raw_routes_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_routes_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_routes_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists raw_routes_import_batch_id_idx
    on import_transport.raw_routes (import_batch_id);

create index if not exists raw_routes_raw_operator_id_idx
    on import_transport.raw_routes (raw_operator_id)
    where raw_operator_id is not null;

create index if not exists raw_routes_source_route_id_idx
    on import_transport.raw_routes (source_route_id);

create index if not exists raw_routes_route_code_idx
    on import_transport.raw_routes (route_code)
    where route_code is not null;

create index if not exists raw_routes_source_operator_id_idx
    on import_transport.raw_routes (source_operator_id)
    where source_operator_id is not null;

comment on table import_transport.raw_routes is
    'Raw logical route records (GTFS route, YBS line code, express corridor id) before normalization.';

-- ---------------------------------------------------------------------------
-- 5. import_transport.raw_route_variants
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_route_variants (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_route_id bigint not null references import_transport.raw_routes (id) on delete cascade,
    source_variant_id text not null,
    source_route_id text null,
    variant_code text null,
    direction_name text null,
    origin_name text null,
    destination_name text null,
    geom geometry(LineString, 4326) null,
    distance_m numeric null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_route_variants_source_variant_batch_uq unique (import_batch_id, source_variant_id),
    constraint raw_route_variants_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_route_variants_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_route_variants_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint raw_route_variants_distance_m_chk check (
        distance_m is null or distance_m >= 0
    )
);

create index if not exists raw_route_variants_import_batch_id_idx
    on import_transport.raw_route_variants (import_batch_id);

create index if not exists raw_route_variants_raw_route_id_idx
    on import_transport.raw_route_variants (raw_route_id);

create index if not exists raw_route_variants_source_variant_id_idx
    on import_transport.raw_route_variants (source_variant_id);

create index if not exists raw_route_variants_geom_gix
    on import_transport.raw_route_variants using gist (geom);

comment on table import_transport.raw_route_variants is
    'Raw direction/pattern variant with optional centerline geometry (LineString, EPSG:4326).';

-- ---------------------------------------------------------------------------
-- 6. import_transport.raw_stops
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_stops (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    source_stop_id text not null,
    stop_code text null,
    stop_name text null,
    stop_name_local text null,
    location_type text null,
    geom geometry(Point, 4326) null,
    admin_area_code text null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_stops_source_stop_batch_uq unique (import_batch_id, source_stop_id),
    constraint raw_stops_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_stops_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_stops_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists raw_stops_import_batch_id_idx
    on import_transport.raw_stops (import_batch_id);

create index if not exists raw_stops_source_stop_id_idx
    on import_transport.raw_stops (source_stop_id);

create index if not exists raw_stops_stop_code_idx
    on import_transport.raw_stops (stop_code)
    where stop_code is not null;

create index if not exists raw_stops_geom_gix
    on import_transport.raw_stops using gist (geom);

comment on table import_transport.raw_stops is
    'Raw stop/platform points from feeds before core_transport promotion.';

-- ---------------------------------------------------------------------------
-- 7. import_transport.raw_route_stops
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_route_stops (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_route_variant_id bigint not null references import_transport.raw_route_variants (id) on delete cascade,
    raw_stop_id bigint not null references import_transport.raw_stops (id) on delete cascade,
    source_route_stop_id text null,
    source_variant_id text null,
    source_stop_id text null,
    stop_sequence integer not null,
    distance_from_start_m numeric null,
    is_timing_point boolean not null default false,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_route_stops_variant_stop_sequence_uq unique (
        raw_route_variant_id,
        stop_sequence
    ),
    constraint raw_route_stops_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_route_stops_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_route_stops_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint raw_route_stops_stop_sequence_chk check (stop_sequence > 0),
    constraint raw_route_stops_distance_from_start_m_chk check (
        distance_from_start_m is null or distance_from_start_m >= 0
    )
);

create index if not exists raw_route_stops_import_batch_id_idx
    on import_transport.raw_route_stops (import_batch_id);

create index if not exists raw_route_stops_raw_route_variant_id_idx
    on import_transport.raw_route_stops (raw_route_variant_id);

create index if not exists raw_route_stops_raw_stop_id_idx
    on import_transport.raw_route_stops (raw_stop_id);

create index if not exists raw_route_stops_source_route_stop_id_idx
    on import_transport.raw_route_stops (source_route_stop_id)
    where source_route_stop_id is not null;

comment on table import_transport.raw_route_stops is
    'Raw ordered stop membership for a route variant (pattern stop sequence).';

-- ---------------------------------------------------------------------------
-- 8. import_transport.raw_route_paths
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_route_paths (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_route_variant_id bigint null references import_transport.raw_route_variants (id) on delete cascade,
    raw_route_id bigint null references import_transport.raw_routes (id) on delete cascade,
    source_path_id text not null,
    source_variant_id text null,
    path_kind text not null default 'shape',
    geom geometry(LineString, 4326) null,
    distance_m numeric null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_route_paths_source_path_batch_uq unique (import_batch_id, source_path_id),
    constraint raw_route_paths_path_kind_chk check (
        path_kind in ('shape', 'corridor', 'display', 'imported', 'other')
    ),
    constraint raw_route_paths_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_route_paths_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_route_paths_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint raw_route_paths_target_chk check (
        raw_route_variant_id is not null or raw_route_id is not null
    )
);

create index if not exists raw_route_paths_import_batch_id_idx
    on import_transport.raw_route_paths (import_batch_id);

create index if not exists raw_route_paths_raw_route_variant_id_idx
    on import_transport.raw_route_paths (raw_route_variant_id)
    where raw_route_variant_id is not null;

create index if not exists raw_route_paths_raw_route_id_idx
    on import_transport.raw_route_paths (raw_route_id)
    where raw_route_id is not null;

create index if not exists raw_route_paths_source_path_id_idx
    on import_transport.raw_route_paths (source_path_id);

create index if not exists raw_route_paths_geom_gix
    on import_transport.raw_route_paths using gist (geom);

comment on table import_transport.raw_route_paths is
    'Raw display/routing path geometry (GTFS shapes, corridor lines) separate from variant metadata when needed.';

-- ---------------------------------------------------------------------------
-- 9. import_transport.raw_terminals
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_terminals (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_operator_id bigint null references import_transport.raw_operators (id) on delete set null,
    source_terminal_id text not null,
    terminal_code text null,
    terminal_name text null,
    terminal_type text not null default 'bus',
    transport_mode text not null,
    geom geometry(Point, 4326) null,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_terminals_source_terminal_batch_uq unique (import_batch_id, source_terminal_id),
    constraint raw_terminals_transport_mode_chk check (
        transport_mode in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint raw_terminals_terminal_type_chk check (
        terminal_type in ('bus', 'express', 'rail', 'ferry', 'airport', 'multimodal', 'other')
    ),
    constraint raw_terminals_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_terminals_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_terminals_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists raw_terminals_import_batch_id_idx
    on import_transport.raw_terminals (import_batch_id);

create index if not exists raw_terminals_source_terminal_id_idx
    on import_transport.raw_terminals (source_terminal_id);

create index if not exists raw_terminals_terminal_code_idx
    on import_transport.raw_terminals (terminal_code)
    where terminal_code is not null;

create index if not exists raw_terminals_geom_gix
    on import_transport.raw_terminals using gist (geom);

comment on table import_transport.raw_terminals is
    'Raw express/intercity/airport terminal or station points before core_transport promotion.';

-- ---------------------------------------------------------------------------
-- 10. import_transport.raw_fares
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_fares (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    raw_route_id bigint null references import_transport.raw_routes (id) on delete cascade,
    raw_operator_id bigint null references import_transport.raw_operators (id) on delete set null,
    source_fare_id text not null,
    source_route_id text null,
    fare_product_name text null,
    amount numeric null,
    currency_code text null default 'MMK',
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_fares_source_fare_batch_uq unique (import_batch_id, source_fare_id),
    constraint raw_fares_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_fares_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_fares_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint raw_fares_amount_chk check (amount is null or amount >= 0)
);

create index if not exists raw_fares_import_batch_id_idx
    on import_transport.raw_fares (import_batch_id);

create index if not exists raw_fares_raw_route_id_idx
    on import_transport.raw_fares (raw_route_id)
    where raw_route_id is not null;

create index if not exists raw_fares_source_fare_id_idx
    on import_transport.raw_fares (source_fare_id);

comment on table import_transport.raw_fares is
    'Unverified fare rows from feeds. Treat as informational until admin-verified; do not expose as authoritative pricing.';

-- ---------------------------------------------------------------------------
-- 11. import_transport.raw_service_notes
-- ---------------------------------------------------------------------------
create table if not exists import_transport.raw_service_notes (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    entity_kind text not null,
    entity_source_id text null,
    raw_route_id bigint null references import_transport.raw_routes (id) on delete cascade,
    raw_stop_id bigint null references import_transport.raw_stops (id) on delete cascade,
    raw_terminal_id bigint null references import_transport.raw_terminals (id) on delete cascade,
    note_type text not null default 'general',
    note_text text not null,
    language_code text null,
    is_verified boolean not null default false,
    match_status text not null default 'unmatched',
    validation_status text not null default 'not_started',
    confidence_score numeric null,
    raw_payload jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint raw_service_notes_note_text_nonempty_chk check (btrim(note_text) <> ''),
    constraint raw_service_notes_entity_kind_chk check (
        entity_kind in (
            'operator',
            'route',
            'route_variant',
            'stop',
            'route_stop',
            'route_path',
            'terminal',
            'fare',
            'batch',
            'other'
        )
    ),
    constraint raw_service_notes_note_type_chk check (
        note_type in (
            'general',
            'schedule',
            'detour',
            'closure',
            'fare',
            'accessibility',
            'safety',
            'data_quality',
            'other'
        )
    ),
    constraint raw_service_notes_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    ),
    constraint raw_service_notes_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    ),
    constraint raw_service_notes_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint raw_service_notes_target_chk check (
        entity_source_id is not null
        or raw_route_id is not null
        or raw_stop_id is not null
        or raw_terminal_id is not null
    )
);

create index if not exists raw_service_notes_import_batch_id_idx
    on import_transport.raw_service_notes (import_batch_id);

create index if not exists raw_service_notes_entity_kind_idx
    on import_transport.raw_service_notes (import_batch_id, entity_kind);

comment on table import_transport.raw_service_notes is
    'Free-form service notes, detours, and data-quality remarks attached to raw transport entities.';

-- ---------------------------------------------------------------------------
-- 12. import_transport.validation_issues
-- ---------------------------------------------------------------------------
create table if not exists import_transport.validation_issues (
    id bigserial primary key,
    import_batch_id bigint not null references import_transport.import_batches (id) on delete cascade,
    entity_kind text null,
    entity_id bigint null,
    entity_source_id text null,
    issue_code text not null,
    severity text not null default 'warning',
    issue_status text not null default 'open',
    message text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    resolved_at timestamptz null,
    constraint validation_issues_issue_code_nonempty_chk check (btrim(issue_code) <> ''),
    constraint validation_issues_message_nonempty_chk check (btrim(message) <> ''),
    constraint validation_issues_severity_chk check (
        severity in ('info', 'warning', 'error', 'critical')
    ),
    constraint validation_issues_issue_status_chk check (
        issue_status in ('open', 'acknowledged', 'resolved', 'suppressed')
    ),
    constraint validation_issues_entity_kind_chk check (
        entity_kind is null
        or entity_kind in (
            'operator',
            'route',
            'route_variant',
            'stop',
            'route_stop',
            'route_path',
            'terminal',
            'fare',
            'service_note',
            'batch',
            'other'
        )
    )
);

create index if not exists validation_issues_import_batch_id_idx
    on import_transport.validation_issues (import_batch_id);

create index if not exists validation_issues_severity_idx
    on import_transport.validation_issues (import_batch_id, severity);

create index if not exists validation_issues_issue_status_idx
    on import_transport.validation_issues (import_batch_id, issue_status);

create index if not exists validation_issues_entity_idx
    on import_transport.validation_issues (entity_kind, entity_id)
    where entity_kind is not null and entity_id is not null;

comment on table import_transport.validation_issues is
    'Structured validation findings for an import batch (geometry, referential, GTFS consistency).';

-- ---------------------------------------------------------------------------
-- 13. import_transport.promotion_batches
-- ---------------------------------------------------------------------------
create table if not exists import_transport.promotion_batches (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    import_batch_id bigint not null references import_transport.import_batches (id) on delete restrict,
    batch_name text not null,
    target_schema text not null default 'core_transport',
    promotion_status text not null default 'draft',
    validation_status text not null default 'not_started',
    item_counts jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    error_message text null,
    created_by bigint null,
    promoted_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint promotion_batches_public_id_key unique (public_id),
    constraint promotion_batches_batch_name_nonempty_chk check (btrim(batch_name) <> ''),
    constraint promotion_batches_target_schema_chk check (btrim(target_schema) <> ''),
    constraint promotion_batches_promotion_status_chk check (
        promotion_status in (
            'draft',
            'not_ready',
            'ready',
            'validating',
            'promoting',
            'promoted',
            'failed',
            'cancelled',
            'archived'
        )
    ),
    constraint promotion_batches_validation_status_chk check (
        validation_status in (
            'not_started',
            'pending',
            'in_progress',
            'passed',
            'passed_with_warnings',
            'failed',
            'skipped'
        )
    )
);

create index if not exists promotion_batches_import_batch_id_idx
    on import_transport.promotion_batches (import_batch_id);

create index if not exists promotion_batches_promotion_status_idx
    on import_transport.promotion_batches (promotion_status);

comment on table import_transport.promotion_batches is
    'Batch promoting validated raw transport rows into core_transport (future API workflow).';

-- ---------------------------------------------------------------------------
-- 14. import_transport.promotion_items
-- ---------------------------------------------------------------------------
create table if not exists import_transport.promotion_items (
    id bigserial primary key,
    promotion_batch_id bigint not null references import_transport.promotion_batches (id) on delete cascade,
    entity_kind text not null,
    raw_entity_id bigint not null,
    promotion_status text not null default 'pending',
    match_status text not null default 'unmatched',
    promoted_target_schema text null,
    promoted_target_table text null,
    promoted_target_id bigint null,
    error_message text null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint promotion_items_entity_batch_uq unique (promotion_batch_id, entity_kind, raw_entity_id),
    constraint promotion_items_entity_kind_chk check (
        entity_kind in (
            'operator',
            'route',
            'route_variant',
            'stop',
            'route_stop',
            'route_path',
            'terminal',
            'fare',
            'service_note'
        )
    ),
    constraint promotion_items_promotion_status_chk check (
        promotion_status in (
            'pending',
            'ready',
            'promoting',
            'promoted',
            'failed',
            'skipped'
        )
    ),
    constraint promotion_items_match_status_chk check (
        match_status in (
            'unmatched',
            'matched',
            'conflict',
            'duplicate',
            'merged',
            'skipped',
            'manual_review'
        )
    )
);

create index if not exists promotion_items_promotion_batch_id_idx
    on import_transport.promotion_items (promotion_batch_id);

create index if not exists promotion_items_promotion_status_idx
    on import_transport.promotion_items (promotion_batch_id, promotion_status);

create index if not exists promotion_items_entity_kind_raw_id_idx
    on import_transport.promotion_items (entity_kind, raw_entity_id);

comment on table import_transport.promotion_items is
    'Per-entity promotion queue from import_transport raw tables into core_transport targets.';

commit;
