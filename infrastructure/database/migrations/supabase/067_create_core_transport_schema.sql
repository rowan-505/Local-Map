-- =============================================================================
-- Supabase migration 067: core_transport schema (production transport data)
-- =============================================================================
--
-- Purpose:
--   Long-term source of truth for verified transport network data: YBS/local bus
--   now; express, train, ferry, and airport access later. Designed for map
--   display, search, and future GTFS export to OpenTripPlanner — not live GPS.
--
-- Safety:
--   - Non-destructive: CREATE SCHEMA/TABLE/INDEX only.
--   - Does NOT modify core.core_bus_*, tiles.*, import_review.*, or API objects.
--   - Parallel to legacy core.core_bus_* until an explicit cutover migration.
--
-- Depends on: PostGIS; optional ref.ref_source_types (FK added only if present).
--
-- Apply: Supabase SQL Editor or your usual migration workflow. Do not run from CI
-- without review.
--
-- =============================================================================

begin;

create extension if not exists postgis;
create extension if not exists pgcrypto;

create schema if not exists core_transport;

comment on schema core_transport is
    'Production transport network (operators, routes, stops, schedules metadata). '
    'Source of truth for map/tiles/API and future GTFS export for OTP. '
    'Does not replace core.core_bus_* until cutover; no realtime vehicle tracking.';

-- ---------------------------------------------------------------------------
-- Reusable column semantics (applied on main entity tables)
-- confidence_score: 0–100 scale (never 0–1).
-- verification_status: reviewer lifecycle (aligned with core import-review promotion).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. core_transport.operators
-- ---------------------------------------------------------------------------
create table if not exists core_transport.operators (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    operator_code text not null,
    name text not null,
    name_local text null,
    primary_route_type text not null default 'local_bus',
    timezone text not null default 'Asia/Yangon',
    website_url text null,
    phone text null,
    gtfs_agency_id text null,
    source_type_id bigint null,
    external_id text null,
    confidence_score numeric null,
    is_active boolean not null default true,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz null,
    verified_by bigint null,
    verification_note text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint operators_public_id_key unique (public_id),
    constraint operators_operator_code_key unique (operator_code),
    constraint operators_operator_code_nonempty_chk check (btrim(operator_code) <> ''),
    constraint operators_name_nonempty_chk check (btrim(name) <> ''),
    constraint operators_primary_route_type_chk check (
        primary_route_type in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint operators_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint operators_verification_status_chk check (
        verification_status in (
            'unverified',
            'verified',
            'needs_fix',
            'questionable',
            'rejected_after_core_review'
        )
    )
);

create index if not exists operators_is_active_deleted_at_idx
    on core_transport.operators (is_active, deleted_at);

create index if not exists operators_primary_route_type_idx
    on core_transport.operators (primary_route_type);

create index if not exists operators_gtfs_agency_id_idx
    on core_transport.operators (gtfs_agency_id)
    where gtfs_agency_id is not null;

comment on table core_transport.operators is
    'Transit agencies/operators. Maps to GTFS agency.txt on export.';

comment on column core_transport.operators.gtfs_agency_id is
    'Stable agency_id for GTFS export (defaults to operator_code when unset in exporter).';

-- ---------------------------------------------------------------------------
-- 2. core_transport.routes
-- ---------------------------------------------------------------------------
create table if not exists core_transport.routes (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    operator_id bigint not null references core_transport.operators (id) on delete restrict,
    route_code text not null,
    public_name text not null,
    route_type text not null,
    directionality text null,
    gtfs_route_type smallint null,
    description text null,
    source_type_id bigint null,
    external_id text null,
    confidence_score numeric null,
    is_active boolean not null default true,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz null,
    verified_by bigint null,
    verification_note text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint routes_public_id_key unique (public_id),
    constraint routes_operator_route_code_key unique (operator_id, route_code),
    constraint routes_route_code_nonempty_chk check (btrim(route_code) <> ''),
    constraint routes_public_name_nonempty_chk check (btrim(public_name) <> ''),
    constraint routes_route_type_chk check (
        route_type in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint routes_gtfs_route_type_chk check (
        gtfs_route_type is null
        or (gtfs_route_type >= 0 and gtfs_route_type <= 12)
    ),
    constraint routes_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint routes_verification_status_chk check (
        verification_status in (
            'unverified',
            'verified',
            'needs_fix',
            'questionable',
            'rejected_after_core_review'
        )
    )
);

create index if not exists routes_route_type_route_code_idx
    on core_transport.routes (route_type, route_code);

create index if not exists routes_is_active_deleted_at_idx
    on core_transport.routes (is_active, deleted_at);

create index if not exists routes_operator_id_idx
    on core_transport.routes (operator_id);

create index if not exists routes_public_id_idx
    on core_transport.routes (public_id);

comment on table core_transport.routes is
    'Logical transit routes. Maps to GTFS routes.txt; route_type drives mode and default GTFS route_type.';

comment on column core_transport.routes.gtfs_route_type is
    'Optional GTFS route_type override (0–12). Exporter may derive from route_type when null.';

-- ---------------------------------------------------------------------------
-- 3. core_transport.route_names
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_names (
    id bigserial primary key,
    route_id bigint not null references core_transport.routes (id) on delete cascade,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 50,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint route_names_name_nonempty_chk check (btrim(name) <> ''),
    constraint route_names_language_code_chk check (
        language_code in ('mm', 'my', 'en', 'und')
    ),
    constraint route_names_name_type_chk check (
        name_type in ('official', 'alternate', 'short', 'local', 'old', 'imported', 'headsign')
    ),
    constraint route_names_search_weight_chk check (search_weight >= 0 and search_weight <= 100)
);

create index if not exists route_names_route_id_idx
    on core_transport.route_names (route_id);

create index if not exists route_names_language_code_idx
    on core_transport.route_names (language_code);

create unique index if not exists route_names_one_primary_per_language_uidx
    on core_transport.route_names (route_id, language_code)
    where is_primary = true;

comment on table core_transport.route_names is
    'Localized route names and headsign labels for map/search and GTFS route_long_name / trip_headsign.';

-- ---------------------------------------------------------------------------
-- 4. core_transport.route_variants
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_variants (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    route_id bigint not null references core_transport.routes (id) on delete cascade,
    variant_code text not null,
    direction_name text null,
    gtfs_direction_id smallint null,
    headsign text null,
    origin_name text null,
    destination_name text null,
    geom geometry(LineString, 4326) null,
    distance_m numeric null,
    confidence_score numeric null,
    is_active boolean not null default true,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz null,
    verified_by bigint null,
    verification_note text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint route_variants_public_id_key unique (public_id),
    constraint route_variants_route_variant_code_key unique (route_id, variant_code),
    constraint route_variants_variant_code_nonempty_chk check (btrim(variant_code) <> ''),
    constraint route_variants_gtfs_direction_id_chk check (
        gtfs_direction_id is null or gtfs_direction_id in (0, 1)
    ),
    constraint route_variants_distance_m_chk check (distance_m is null or distance_m >= 0),
    constraint route_variants_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint route_variants_verification_status_chk check (
        verification_status in (
            'unverified',
            'verified',
            'needs_fix',
            'questionable',
            'rejected_after_core_review'
        )
    )
);

create index if not exists route_variants_route_id_variant_code_idx
    on core_transport.route_variants (route_id, variant_code);

create index if not exists route_variants_is_active_deleted_at_idx
    on core_transport.route_variants (is_active, deleted_at);

create index if not exists route_variants_geom_gix
    on core_transport.route_variants using gist (geom);

comment on table core_transport.route_variants is
    'Direction/pattern variant (inbound, outbound, loop). Maps to GTFS trips via direction_id and headsign.';

comment on column core_transport.route_variants.gtfs_direction_id is
    'GTFS trips.direction_id: 0 or 1 when known.';

-- ---------------------------------------------------------------------------
-- 5. core_transport.stops
-- ---------------------------------------------------------------------------
create table if not exists core_transport.stops (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    stop_code text null,
    name text not null,
    name_local text null,
    stop_type text not null default 'bus_stop',
    location_type smallint not null default 0,
    parent_stop_id bigint null,
    geom geometry(Point, 4326) not null,
    admin_area_id bigint null,
    zone_id text null,
    source_type_id bigint null,
    external_id text null,
    confidence_score numeric null,
    is_active boolean not null default true,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz null,
    verified_by bigint null,
    verification_note text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint stops_public_id_key unique (public_id),
    constraint stops_name_nonempty_chk check (btrim(name) <> ''),
    constraint stops_stop_type_chk check (
        stop_type in (
            'bus_stop',
            'bus_station',
            'terminal',
            'rail_station',
            'ferry_terminal',
            'airport'
        )
    ),
    constraint stops_location_type_chk check (location_type >= 0 and location_type <= 4),
    constraint stops_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint stops_verification_status_chk check (
        verification_status in (
            'unverified',
            'verified',
            'needs_fix',
            'questionable',
            'rejected_after_core_review'
        )
    )
);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'stops_parent_stop_id_fkey'
          and conrelid = 'core_transport.stops'::regclass
    ) then
        alter table core_transport.stops
            add constraint stops_parent_stop_id_fkey
            foreign key (parent_stop_id) references core_transport.stops (id) on delete set null;
    end if;
end $$;

create index if not exists stops_stop_code_idx
    on core_transport.stops (stop_code)
    where stop_code is not null;

create index if not exists stops_is_active_deleted_at_idx
    on core_transport.stops (is_active, deleted_at);

create index if not exists stops_stop_type_idx
    on core_transport.stops (stop_type);

create index if not exists stops_geom_gix
    on core_transport.stops using gist (geom);

create index if not exists stops_parent_stop_id_idx
    on core_transport.stops (parent_stop_id)
    where parent_stop_id is not null;

comment on table core_transport.stops is
    'Stop/platform points. Maps to GTFS stops.txt; location_type supports parent stations.';

comment on column core_transport.stops.location_type is
    'GTFS location_type: 0=stop/platform, 1=station, 2=entrance/exit, 3=generic node, 4=boarding area.';

-- ---------------------------------------------------------------------------
-- 6. core_transport.stop_names
-- ---------------------------------------------------------------------------
create table if not exists core_transport.stop_names (
    id bigserial primary key,
    stop_id bigint not null references core_transport.stops (id) on delete cascade,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 50,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint stop_names_name_nonempty_chk check (btrim(name) <> ''),
    constraint stop_names_language_code_chk check (
        language_code in ('mm', 'my', 'en', 'und')
    ),
    constraint stop_names_name_type_chk check (
        name_type in ('official', 'alternate', 'short', 'local', 'old', 'imported')
    ),
    constraint stop_names_search_weight_chk check (search_weight >= 0 and search_weight <= 100)
);

create index if not exists stop_names_stop_id_idx
    on core_transport.stop_names (stop_id);

create unique index if not exists stop_names_one_primary_per_language_uidx
    on core_transport.stop_names (stop_id, language_code)
    where is_primary = true;

comment on table core_transport.stop_names is
    'Localized stop names for map labels and GTFS stop_name.';

-- ---------------------------------------------------------------------------
-- 7. core_transport.route_stops
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_stops (
    id bigserial primary key,
    route_variant_id bigint not null references core_transport.route_variants (id) on delete cascade,
    stop_id bigint not null references core_transport.stops (id) on delete restrict,
    stop_sequence integer not null,
    distance_from_start_m numeric null,
    pickup_type smallint not null default 0,
    drop_off_type smallint not null default 0,
    arrival_offset_seconds integer null,
    departure_offset_seconds integer null,
    is_timing_point boolean not null default false,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint route_stops_variant_sequence_key unique (route_variant_id, stop_sequence),
    constraint route_stops_variant_stop_key unique (route_variant_id, stop_id),
    constraint route_stops_stop_sequence_chk check (stop_sequence > 0),
    constraint route_stops_distance_from_start_m_chk check (
        distance_from_start_m is null or distance_from_start_m >= 0
    ),
    constraint route_stops_pickup_type_chk check (pickup_type >= 0 and pickup_type <= 3),
    constraint route_stops_drop_off_type_chk check (drop_off_type >= 0 and drop_off_type <= 3),
    constraint route_stops_arrival_offset_chk check (
        arrival_offset_seconds is null or arrival_offset_seconds >= 0
    ),
    constraint route_stops_departure_offset_chk check (
        departure_offset_seconds is null or departure_offset_seconds >= 0
    )
);

create index if not exists route_stops_route_variant_id_stop_sequence_idx
    on core_transport.route_stops (route_variant_id, stop_sequence);

create index if not exists route_stops_stop_id_idx
    on core_transport.route_stops (stop_id);

comment on table core_transport.route_stops is
    'Ordered stop pattern for a variant. Exports to GTFS stop_times.txt (sequence, times, pickup/drop_off).';

comment on column core_transport.route_stops.pickup_type is
    'GTFS pickup_type: 0=regular, 1=none, 2=must phone, 3=coordinate with driver.';

comment on column core_transport.route_stops.drop_off_type is
    'GTFS drop_off_type: same encoding as pickup_type.';

comment on column core_transport.route_stops.arrival_offset_seconds is
    'Seconds after trip start for arrival; exporter may map to stop_times arrival_time when exact times exist.';

comment on column core_transport.route_stops.departure_offset_seconds is
    'Seconds after trip start for departure; used with frequencies or exact-time trips.';

-- ---------------------------------------------------------------------------
-- 8. core_transport.route_paths
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_paths (
    id bigserial primary key,
    route_variant_id bigint not null references core_transport.route_variants (id) on delete cascade,
    path_kind text not null default 'shape',
    geom geometry(LineString, 4326) not null,
    distance_m numeric null,
    is_active boolean not null default true,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint route_paths_path_kind_chk check (
        path_kind in ('shape', 'corridor', 'display', 'imported')
    ),
    constraint route_paths_distance_m_chk check (distance_m is null or distance_m >= 0)
);

create index if not exists route_paths_route_variant_id_idx
    on core_transport.route_paths (route_variant_id);

create index if not exists route_paths_geom_gix
    on core_transport.route_paths using gist (geom);

create index if not exists route_paths_is_active_deleted_at_idx
    on core_transport.route_paths (is_active, deleted_at);

comment on table core_transport.route_paths is
    'Line geometry for map display and GTFS shapes.txt (typically one active shape per variant).';

-- ---------------------------------------------------------------------------
-- 9. core_transport.terminals
-- ---------------------------------------------------------------------------
create table if not exists core_transport.terminals (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    operator_id bigint null references core_transport.operators (id) on delete set null,
    linked_stop_id bigint null references core_transport.stops (id) on delete set null,
    terminal_code text null,
    name text not null,
    name_local text null,
    route_type text not null,
    terminal_role text not null default 'station',
    geom geometry(Point, 4326) not null,
    admin_area_id bigint null,
    source_type_id bigint null,
    external_id text null,
    confidence_score numeric null,
    is_active boolean not null default true,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz null,
    verified_by bigint null,
    verification_note text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint terminals_public_id_key unique (public_id),
    constraint terminals_name_nonempty_chk check (btrim(name) <> ''),
    constraint terminals_route_type_chk check (
        route_type in (
            'local_bus',
            'express_bus',
            'train',
            'ferry',
            'airport_access'
        )
    ),
    constraint terminals_terminal_role_chk check (
        terminal_role in ('station', 'hub', 'depot', 'port', 'airport', 'stop_group', 'other')
    ),
    constraint terminals_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    ),
    constraint terminals_verification_status_chk check (
        verification_status in (
            'unverified',
            'verified',
            'needs_fix',
            'questionable',
            'rejected_after_core_review'
        )
    )
);

create index if not exists terminals_is_active_deleted_at_idx
    on core_transport.terminals (is_active, deleted_at);

create index if not exists terminals_route_type_idx
    on core_transport.terminals (route_type);

create index if not exists terminals_geom_gix
    on core_transport.terminals using gist (geom);

comment on table core_transport.terminals is
    'Major terminals (express, rail, ferry, airport access). May link to a parent stop for GTFS station grouping.';

-- ---------------------------------------------------------------------------
-- 10. core_transport.service_calendars
-- ---------------------------------------------------------------------------
create table if not exists core_transport.service_calendars (
    id bigserial primary key,
    operator_id bigint null references core_transport.operators (id) on delete cascade,
    route_id bigint null references core_transport.routes (id) on delete cascade,
    service_code text not null,
    name text null,
    monday boolean not null default false,
    tuesday boolean not null default false,
    wednesday boolean not null default false,
    thursday boolean not null default false,
    friday boolean not null default false,
    saturday boolean not null default false,
    sunday boolean not null default false,
    start_date date not null,
    end_date date null,
    is_active boolean not null default true,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint service_calendars_service_code_nonempty_chk check (btrim(service_code) <> ''),
    constraint service_calendars_date_range_chk check (
        end_date is null or end_date >= start_date
    ),
    constraint service_calendars_target_chk check (
        operator_id is not null or route_id is not null
    )
);

create index if not exists service_calendars_operator_id_idx
    on core_transport.service_calendars (operator_id)
    where operator_id is not null;

create index if not exists service_calendars_route_id_idx
    on core_transport.service_calendars (route_id)
    where route_id is not null;

create index if not exists service_calendars_start_end_date_idx
    on core_transport.service_calendars (start_date, end_date);

comment on table core_transport.service_calendars is
    'Weekly service patterns for GTFS calendar.txt (service_id + day flags + date range).';

comment on column core_transport.service_calendars.service_code is
    'Stable service_id for GTFS calendar and trip.service_id.';

-- ---------------------------------------------------------------------------
-- 11. core_transport.frequencies
-- ---------------------------------------------------------------------------
create table if not exists core_transport.frequencies (
    id bigserial primary key,
    route_variant_id bigint not null references core_transport.route_variants (id) on delete cascade,
    service_calendar_id bigint null references core_transport.service_calendars (id) on delete set null,
    trip_code text null,
    start_time_seconds integer not null,
    end_time_seconds integer not null,
    headway_seconds integer not null,
    exact_times boolean not null default false,
    is_active boolean not null default true,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint frequencies_time_window_chk check (end_time_seconds > start_time_seconds),
    constraint frequencies_start_time_seconds_chk check (
        start_time_seconds >= 0 and start_time_seconds < 86400
    ),
    constraint frequencies_end_time_seconds_chk check (
        end_time_seconds > 0 and end_time_seconds <= 86400
    ),
    constraint frequencies_headway_seconds_chk check (headway_seconds > 0)
);

create index if not exists frequencies_route_variant_id_idx
    on core_transport.frequencies (route_variant_id);

create index if not exists frequencies_service_calendar_id_idx
    on core_transport.frequencies (service_calendar_id)
    where service_calendar_id is not null;

comment on table core_transport.frequencies is
    'Headway-based service windows for GTFS frequencies.txt when exact stop_times are unknown.';

comment on column core_transport.frequencies.start_time_seconds is
    'Seconds since midnight (service day) for window start — GTFS frequencies.start_time.';

comment on column core_transport.frequencies.headway_seconds is
    'Seconds between vehicles — GTFS frequencies.headway_secs.';

-- ---------------------------------------------------------------------------
-- 12. core_transport.fares
-- ---------------------------------------------------------------------------
create table if not exists core_transport.fares (
    id bigserial primary key,
    operator_id bigint null references core_transport.operators (id) on delete cascade,
    route_id bigint null references core_transport.routes (id) on delete cascade,
    fare_product_code text not null,
    fare_product_name text null,
    amount numeric null,
    currency_code text not null default 'MMK',
    is_verified boolean not null default false,
    verification_note text null,
    confidence_score numeric null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz null,
    constraint fares_fare_product_code_nonempty_chk check (btrim(fare_product_code) <> ''),
    constraint fares_target_chk check (operator_id is not null or route_id is not null),
    constraint fares_amount_chk check (amount is null or amount >= 0),
    constraint fares_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists fares_operator_id_idx
    on core_transport.fares (operator_id)
    where operator_id is not null;

create index if not exists fares_route_id_idx
    on core_transport.fares (route_id)
    where route_id is not null;

comment on table core_transport.fares is
    'Fare products (informational until verified). Optional future GTFS fare_attributes — not authoritative until reviewed.';

-- ---------------------------------------------------------------------------
-- 13. core_transport.route_sources
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_sources (
    id bigserial primary key,
    route_id bigint not null references core_transport.routes (id) on delete cascade,
    source_kind text not null,
    source_dataset_code text null,
    source_entity_id text null,
    import_transport_batch_id bigint null,
    is_primary boolean not null default false,
    confidence_score numeric null,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint route_sources_source_kind_chk check (
        source_kind in (
            'import_transport',
            'import_review_osm',
            'gtfs',
            'manual',
            'legacy_core_bus',
            'other'
        )
    ),
    constraint route_sources_confidence_chk check (
        confidence_score is null
        or (confidence_score >= 0 and confidence_score <= 100)
    )
);

create index if not exists route_sources_route_id_idx
    on core_transport.route_sources (route_id);

create index if not exists route_sources_source_kind_idx
    on core_transport.route_sources (source_kind);

create unique index if not exists route_sources_one_primary_per_route_uidx
    on core_transport.route_sources (route_id)
    where is_primary = true;

do $$
begin
    if to_regclass('import_transport.import_batches') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'route_sources_import_transport_batch_id_fkey'
              and conrelid = 'core_transport.route_sources'::regclass
        )
    then
        alter table core_transport.route_sources
            add constraint route_sources_import_transport_batch_id_fkey
            foreign key (import_transport_batch_id)
            references import_transport.import_batches (id)
            on delete set null;
    end if;
end $$;

comment on table core_transport.route_sources is
    'Lineage from import_transport batches, GTFS feeds, or legacy core bus tables.';

-- ---------------------------------------------------------------------------
-- 14. core_transport.route_versions
-- ---------------------------------------------------------------------------
create table if not exists core_transport.route_versions (
    id bigserial primary key,
    route_id bigint not null references core_transport.routes (id) on delete cascade,
    version_number integer not null,
    change_summary text null,
    effective_from timestamptz not null default now(),
    effective_to timestamptz null,
    snapshot jsonb not null default '{}'::jsonb,
    created_by bigint null,
    created_at timestamptz not null default now(),
    constraint route_versions_route_version_key unique (route_id, version_number),
    constraint route_versions_version_number_chk check (version_number > 0),
    constraint route_versions_effective_range_chk check (
        effective_to is null or effective_to > effective_from
    )
);

create index if not exists route_versions_route_id_effective_idx
    on core_transport.route_versions (route_id, effective_from desc);

comment on table core_transport.route_versions is
    'Append-only route metadata snapshots for audit and rollback planning (not a live edit log).';

-- ---------------------------------------------------------------------------
-- Optional FK: ref.ref_source_types (when present)
-- ---------------------------------------------------------------------------
do $$
declare
    tbl text;
begin
    if to_regclass('ref.ref_source_types') is null then
        raise notice 'ref.ref_source_types not found — skipping source_type_id FKs';
        return;
    end if;

    foreach tbl in array array['operators', 'routes', 'stops', 'terminals']
    loop
        if not exists (
            select 1
            from pg_constraint
            where conname = tbl || '_source_type_id_fkey'
              and conrelid = ('core_transport.' || tbl)::regclass
        ) then
            execute format(
                'alter table core_transport.%I
                    add constraint %I
                    foreign key (source_type_id)
                    references ref.ref_source_types (id)',
                tbl,
                tbl || '_source_type_id_fkey'
            );
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Optional FK: core.core_admin_areas (when present)
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('core.core_admin_areas') is null then
        raise notice 'core.core_admin_areas not found — skipping admin_area_id FKs';
        return;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'stops_admin_area_id_fkey'
          and conrelid = 'core_transport.stops'::regclass
    ) then
        alter table core_transport.stops
            add constraint stops_admin_area_id_fkey
            foreign key (admin_area_id) references core.core_admin_areas (id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'terminals_admin_area_id_fkey'
          and conrelid = 'core_transport.terminals'::regclass
    ) then
        alter table core_transport.terminals
            add constraint terminals_admin_area_id_fkey
            foreign key (admin_area_id) references core.core_admin_areas (id)
            on delete set null;
    end if;
end $$;

commit;
