-- =============================================================================
-- Local-only Stage E staging candidate readiness (non-destructive)
-- =============================================================================
--
-- Purpose:
--   Prepare local PostgreSQL staging tables for broad OSM extraction from
--   raw.raw_osm_* into staging.* candidates: routing, addresses, search, bus,
--   and names.
--
-- Scope:
--   - Local database only.
--   - Does not touch Supabase.
--   - Does not touch core promotion logic.
--   - Does not DROP, TRUNCATE, or rename existing objects.
--
-- Safety:
--   - CREATE TABLE IF NOT EXISTS.
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS only.
--   - CREATE INDEX IF NOT EXISTS.
--   - Existing local rows are preserved.
--
-- Scores:
--   confidence_score on staging candidates uses numeric(6,2) semantics on a 0–100 scale
--   (aligned with Supabase production core), not fractional 0–1.
--
-- =============================================================================

create schema if not exists staging;

-- -----------------------------------------------------------------------------
-- Part A: upgrade existing staging tables for Stage E metadata
-- -----------------------------------------------------------------------------

alter table if exists staging.staging_place_candidates
    add column if not exists raw_id bigint null,
    add column if not exists class_code text null,
    add column if not exists footprint_geom geometry(Geometry, 4326) null,
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_place_name_candidates
    add column if not exists external_id text null,
    add column if not exists source_tag text null,
    add column if not exists source_refs jsonb not null default '{}'::jsonb,
    add column if not exists normalized_data jsonb not null default '{}'::jsonb,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists confidence_score numeric(6,2) null,
    add column if not exists match_status text not null default 'new_candidate',
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_road_candidates
    add column if not exists raw_id bigint null,
    add column if not exists class_code text null,
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_building_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_landuse_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_water_line_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_water_polygon_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_admin_area_candidates
    add column if not exists raw_id bigint null,
    add column if not exists class_code text null,
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_bus_stop_candidates
    add column if not exists raw_id bigint null,
    add column if not exists class_code text null,
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

alter table if exists staging.staging_bus_route_candidates
    add column if not exists raw_id bigint null,
    add column if not exists canonical_name text null,
    add column if not exists class_code text null,
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending';

-- Existing-table support indexes for added workflow columns.
create index if not exists staging_place_candidates_raw_id_idx
    on staging.staging_place_candidates (raw_id);
create index if not exists staging_place_candidates_auto_action_idx
    on staging.staging_place_candidates (auto_action);
create index if not exists staging_place_candidates_review_status_idx
    on staging.staging_place_candidates (review_status);
create index if not exists staging_place_candidates_footprint_geom_gix
    on staging.staging_place_candidates using gist (footprint_geom);

create index if not exists staging_place_name_candidates_external_id_idx
    on staging.staging_place_name_candidates (external_id);
create index if not exists staging_place_name_candidates_name_idx
    on staging.staging_place_name_candidates (name);
create index if not exists staging_place_name_candidates_lower_name_idx
    on staging.staging_place_name_candidates (lower(name));
create index if not exists staging_place_name_candidates_match_status_idx
    on staging.staging_place_name_candidates (match_status);
create index if not exists staging_place_name_candidates_auto_action_idx
    on staging.staging_place_name_candidates (auto_action);
create index if not exists staging_place_name_candidates_review_status_idx
    on staging.staging_place_name_candidates (review_status);

create index if not exists staging_road_candidates_raw_id_idx
    on staging.staging_road_candidates (raw_id);
create index if not exists staging_road_candidates_external_id_idx
    on staging.staging_road_candidates (external_id);
create index if not exists staging_road_candidates_auto_action_idx
    on staging.staging_road_candidates (auto_action);
create index if not exists staging_road_candidates_review_status_idx
    on staging.staging_road_candidates (review_status);

create index if not exists staging_building_candidates_source_snapshot_id_idx
    on staging.staging_building_candidates (source_snapshot_id);
create index if not exists staging_building_candidates_auto_action_idx
    on staging.staging_building_candidates (auto_action);
create index if not exists staging_building_candidates_review_status_idx
    on staging.staging_building_candidates (review_status);

create index if not exists staging_landuse_candidates_source_snapshot_id_idx
    on staging.staging_landuse_candidates (source_snapshot_id);
create index if not exists staging_landuse_candidates_auto_action_idx
    on staging.staging_landuse_candidates (auto_action);
create index if not exists staging_landuse_candidates_review_status_idx
    on staging.staging_landuse_candidates (review_status);

create index if not exists staging_water_line_candidates_source_snapshot_id_idx
    on staging.staging_water_line_candidates (source_snapshot_id);
create index if not exists staging_water_line_candidates_auto_action_idx
    on staging.staging_water_line_candidates (auto_action);
create index if not exists staging_water_line_candidates_review_status_idx
    on staging.staging_water_line_candidates (review_status);

create index if not exists staging_water_polygon_candidates_source_snapshot_id_idx
    on staging.staging_water_polygon_candidates (source_snapshot_id);
create index if not exists staging_water_polygon_candidates_auto_action_idx
    on staging.staging_water_polygon_candidates (auto_action);
create index if not exists staging_water_polygon_candidates_review_status_idx
    on staging.staging_water_polygon_candidates (review_status);

create index if not exists staging_admin_area_candidates_raw_id_idx
    on staging.staging_admin_area_candidates (raw_id);
create index if not exists staging_admin_area_candidates_external_id_idx
    on staging.staging_admin_area_candidates (external_id);
create index if not exists staging_admin_area_candidates_auto_action_idx
    on staging.staging_admin_area_candidates (auto_action);
create index if not exists staging_admin_area_candidates_review_status_idx
    on staging.staging_admin_area_candidates (review_status);

create index if not exists staging_bus_stop_candidates_raw_id_idx
    on staging.staging_bus_stop_candidates (raw_id);
create index if not exists staging_bus_stop_candidates_external_id_idx
    on staging.staging_bus_stop_candidates (external_id);
create index if not exists staging_bus_stop_candidates_auto_action_idx
    on staging.staging_bus_stop_candidates (auto_action);
create index if not exists staging_bus_stop_candidates_review_status_idx
    on staging.staging_bus_stop_candidates (review_status);

create index if not exists staging_bus_route_candidates_raw_id_idx
    on staging.staging_bus_route_candidates (raw_id);
create index if not exists staging_bus_route_candidates_external_id_idx
    on staging.staging_bus_route_candidates (external_id);
create index if not exists staging_bus_route_candidates_auto_action_idx
    on staging.staging_bus_route_candidates (auto_action);
create index if not exists staging_bus_route_candidates_review_status_idx
    on staging.staging_bus_route_candidates (review_status);

-- -----------------------------------------------------------------------------
-- Part B: name candidate tables
-- -----------------------------------------------------------------------------

create table if not exists staging.staging_road_name_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    road_candidate_id bigint not null references staging.staging_road_candidates(id) on delete cascade,
    external_id text not null,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 100,
    source_tag text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_road_name_candidates_uq
    on staging.staging_road_name_candidates (source_snapshot_id, road_candidate_id, language_code, name_type, name);

create table if not exists staging.staging_admin_area_name_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    admin_area_candidate_id bigint not null references staging.staging_admin_area_candidates(id) on delete cascade,
    external_id text not null,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 100,
    source_tag text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_admin_area_name_candidates_uq
    on staging.staging_admin_area_name_candidates (source_snapshot_id, admin_area_candidate_id, language_code, name_type, name);

create table if not exists staging.staging_bus_stop_name_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    bus_stop_candidate_id bigint not null references staging.staging_bus_stop_candidates(id) on delete cascade,
    external_id text not null,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 100,
    source_tag text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_bus_stop_name_candidates_uq
    on staging.staging_bus_stop_name_candidates (source_snapshot_id, bus_stop_candidate_id, language_code, name_type, name);

create table if not exists staging.staging_bus_route_name_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    bus_route_candidate_id bigint not null references staging.staging_bus_route_candidates(id) on delete cascade,
    external_id text not null,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    search_weight integer not null default 100,
    source_tag text null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_bus_route_name_candidates_uq
    on staging.staging_bus_route_name_candidates (source_snapshot_id, bus_route_candidate_id, language_code, name_type, name);

-- -----------------------------------------------------------------------------
-- Part C: address staging tables
-- -----------------------------------------------------------------------------

create table if not exists staging.staging_address_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    raw_table text not null,
    raw_id bigint not null,
    external_id text not null,
    source_feature_family text not null,
    full_address text null,
    house_number text null,
    street_name text null,
    quarter text null,
    suburb text null,
    township text null,
    city text null,
    district text null,
    state_region text null,
    postcode text null,
    country text null default 'MM',
    point_geom geometry(Point, 4326) null,
    geom geometry(Geometry, 4326) null,
    matched_core_address_id bigint null,
    matched_place_candidate_id bigint null,
    matched_building_candidate_id bigint null,
    matched_road_candidate_id bigint null,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    auto_action text null,
    review_status text not null default 'pending',
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists staging_address_candidates_source_snapshot_external_id_uq
    on staging.staging_address_candidates (source_snapshot_id, external_id);

create table if not exists staging.staging_address_component_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    address_candidate_id bigint not null references staging.staging_address_candidates(id) on delete cascade,
    component_type_code text not null,
    component_value text not null,
    language_code text not null default 'und',
    source_tag text null,
    sort_order integer not null default 100,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_address_component_candidates_uq
    on staging.staging_address_component_candidates (address_candidate_id, component_type_code, language_code, component_value);

-- -----------------------------------------------------------------------------
-- Part D: search staging tables
-- -----------------------------------------------------------------------------

create table if not exists staging.staging_search_name_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    entity_family text not null,
    candidate_id bigint null,
    external_id text not null,
    name text not null,
    language_code text not null default 'und',
    script_code text null,
    name_type text not null default 'official',
    search_weight integer not null default 100,
    tokens jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_search_name_candidates_uq
    on staging.staging_search_name_candidates (source_snapshot_id, entity_family, external_id, language_code, name_type, name);

create table if not exists staging.staging_search_address_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    address_candidate_id bigint null references staging.staging_address_candidates(id) on delete cascade,
    external_id text not null,
    search_text text not null,
    language_code text not null default 'und',
    tokens jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists staging_search_address_candidates_uq
    on staging.staging_search_address_candidates (source_snapshot_id, external_id, language_code, search_text);

-- -----------------------------------------------------------------------------
-- Part E: routing staging tables
-- -----------------------------------------------------------------------------

create table if not exists staging.staging_routing_road_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    road_candidate_id bigint null references staging.staging_road_candidates(id) on delete cascade,
    raw_id bigint null,
    external_id text not null,
    road_class_code text null,
    is_oneway boolean,
    maxspeed_kph numeric,
    lanes integer,
    surface text,
    access_tags jsonb not null default '{}'::jsonb,
    routing_tags jsonb not null default '{}'::jsonb,
    geom geometry(LineString, 4326) null,
    geom_multi geometry(MultiLineString, 4326) null,
    length_m numeric,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    auto_action text null,
    review_status text not null default 'pending',
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists staging_routing_road_candidates_source_snapshot_external_id_uq
    on staging.staging_routing_road_candidates (source_snapshot_id, external_id);

create table if not exists staging.staging_routing_turn_restriction_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    external_id text not null,
    restriction_type text null,
    from_external_id text null,
    via_external_id text null,
    to_external_id text null,
    raw_relation_id text null,
    relation_tags jsonb not null default '{}'::jsonb,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    created_at timestamptz not null default now()
);

create unique index if not exists staging_routing_turn_restriction_candidates_uq
    on staging.staging_routing_turn_restriction_candidates (source_snapshot_id, external_id);

create table if not exists staging.staging_routing_barrier_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    raw_table text not null,
    raw_id bigint not null,
    external_id text not null,
    barrier_type text null,
    access_tags jsonb not null default '{}'::jsonb,
    point_geom geometry(Point, 4326) null,
    geom geometry(Geometry, 4326) null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    created_at timestamptz not null default now()
);

create unique index if not exists staging_routing_barrier_candidates_uq
    on staging.staging_routing_barrier_candidates (source_snapshot_id, external_id);

-- -----------------------------------------------------------------------------
-- Part F: transit route staging
-- -----------------------------------------------------------------------------

create table if not exists staging.staging_bus_route_variant_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    bus_route_candidate_id bigint null references staging.staging_bus_route_candidates(id) on delete cascade,
    external_id text not null,
    variant_code text null,
    direction text null,
    from_name text null,
    to_name text null,
    geom geometry(MultiLineString, 4326) null,
    sequence_confidence numeric,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    auto_action text null,
    review_status text not null default 'pending',
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists staging_bus_route_variant_candidates_uq
    on staging.staging_bus_route_variant_candidates (source_snapshot_id, external_id);

create table if not exists staging.staging_bus_route_stop_candidates (
    id bigint generated by default as identity primary key,
    source_snapshot_id bigint not null references system.system_source_snapshots(id),
    bus_route_variant_candidate_id bigint null references staging.staging_bus_route_variant_candidates(id) on delete cascade,
    bus_stop_candidate_id bigint null references staging.staging_bus_stop_candidates(id),
    external_id text not null,
    stop_sequence integer null,
    role text null,
    point_geom geometry(Point, 4326) null,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    confidence_score numeric(6,2),
    match_status text not null default 'new_candidate',
    created_at timestamptz not null default now()
);

create unique index if not exists staging_bus_route_stop_candidates_uq
    on staging.staging_bus_route_stop_candidates (source_snapshot_id, external_id);

-- -----------------------------------------------------------------------------
-- Indexes for all new tables
-- -----------------------------------------------------------------------------

-- Name candidate indexes.
create index if not exists staging_road_name_candidates_source_snapshot_id_idx on staging.staging_road_name_candidates (source_snapshot_id);
create index if not exists staging_road_name_candidates_external_id_idx on staging.staging_road_name_candidates (external_id);
create index if not exists staging_road_name_candidates_created_at_idx on staging.staging_road_name_candidates (created_at);
create index if not exists staging_road_name_candidates_name_idx on staging.staging_road_name_candidates (name);
create index if not exists staging_road_name_candidates_lower_name_idx on staging.staging_road_name_candidates (lower(name));
create index if not exists staging_road_name_candidates_language_code_idx on staging.staging_road_name_candidates (language_code);
create index if not exists staging_road_name_candidates_road_candidate_id_idx on staging.staging_road_name_candidates (road_candidate_id);

create index if not exists staging_admin_area_name_candidates_source_snapshot_id_idx on staging.staging_admin_area_name_candidates (source_snapshot_id);
create index if not exists staging_admin_area_name_candidates_external_id_idx on staging.staging_admin_area_name_candidates (external_id);
create index if not exists staging_admin_area_name_candidates_created_at_idx on staging.staging_admin_area_name_candidates (created_at);
create index if not exists staging_admin_area_name_candidates_name_idx on staging.staging_admin_area_name_candidates (name);
create index if not exists staging_admin_area_name_candidates_lower_name_idx on staging.staging_admin_area_name_candidates (lower(name));
create index if not exists staging_admin_area_name_candidates_language_code_idx on staging.staging_admin_area_name_candidates (language_code);
create index if not exists staging_admin_area_name_candidates_admin_area_candidate_id_idx on staging.staging_admin_area_name_candidates (admin_area_candidate_id);

create index if not exists staging_bus_stop_name_candidates_source_snapshot_id_idx on staging.staging_bus_stop_name_candidates (source_snapshot_id);
create index if not exists staging_bus_stop_name_candidates_external_id_idx on staging.staging_bus_stop_name_candidates (external_id);
create index if not exists staging_bus_stop_name_candidates_created_at_idx on staging.staging_bus_stop_name_candidates (created_at);
create index if not exists staging_bus_stop_name_candidates_name_idx on staging.staging_bus_stop_name_candidates (name);
create index if not exists staging_bus_stop_name_candidates_lower_name_idx on staging.staging_bus_stop_name_candidates (lower(name));
create index if not exists staging_bus_stop_name_candidates_language_code_idx on staging.staging_bus_stop_name_candidates (language_code);
create index if not exists staging_bus_stop_name_candidates_bus_stop_candidate_id_idx on staging.staging_bus_stop_name_candidates (bus_stop_candidate_id);

create index if not exists staging_bus_route_name_candidates_source_snapshot_id_idx on staging.staging_bus_route_name_candidates (source_snapshot_id);
create index if not exists staging_bus_route_name_candidates_external_id_idx on staging.staging_bus_route_name_candidates (external_id);
create index if not exists staging_bus_route_name_candidates_created_at_idx on staging.staging_bus_route_name_candidates (created_at);
create index if not exists staging_bus_route_name_candidates_name_idx on staging.staging_bus_route_name_candidates (name);
create index if not exists staging_bus_route_name_candidates_lower_name_idx on staging.staging_bus_route_name_candidates (lower(name));
create index if not exists staging_bus_route_name_candidates_language_code_idx on staging.staging_bus_route_name_candidates (language_code);
create index if not exists staging_bus_route_name_candidates_bus_route_candidate_id_idx on staging.staging_bus_route_name_candidates (bus_route_candidate_id);

-- Address indexes.
create index if not exists staging_address_candidates_source_snapshot_id_idx on staging.staging_address_candidates (source_snapshot_id);
create index if not exists staging_address_candidates_external_id_idx on staging.staging_address_candidates (external_id);
create index if not exists staging_address_candidates_match_status_idx on staging.staging_address_candidates (match_status);
create index if not exists staging_address_candidates_auto_action_idx on staging.staging_address_candidates (auto_action);
create index if not exists staging_address_candidates_review_status_idx on staging.staging_address_candidates (review_status);
create index if not exists staging_address_candidates_created_at_idx on staging.staging_address_candidates (created_at);
create index if not exists staging_address_candidates_point_geom_gix on staging.staging_address_candidates using gist (point_geom);
create index if not exists staging_address_candidates_geom_gix on staging.staging_address_candidates using gist (geom);

create index if not exists staging_address_component_candidates_source_snapshot_id_idx on staging.staging_address_component_candidates (source_snapshot_id);
create index if not exists staging_address_component_candidates_external_id_idx on staging.staging_address_component_candidates (address_candidate_id);
create index if not exists staging_address_component_candidates_component_type_code_idx on staging.staging_address_component_candidates (component_type_code);
create index if not exists staging_address_component_candidates_created_at_idx on staging.staging_address_component_candidates (created_at);
create index if not exists staging_address_component_candidates_language_code_idx on staging.staging_address_component_candidates (language_code);

-- Search indexes.
create index if not exists staging_search_name_candidates_source_snapshot_id_idx on staging.staging_search_name_candidates (source_snapshot_id);
create index if not exists staging_search_name_candidates_external_id_idx on staging.staging_search_name_candidates (external_id);
create index if not exists staging_search_name_candidates_created_at_idx on staging.staging_search_name_candidates (created_at);
create index if not exists staging_search_name_candidates_name_idx on staging.staging_search_name_candidates (name);
create index if not exists staging_search_name_candidates_lower_name_idx on staging.staging_search_name_candidates (lower(name));
create index if not exists staging_search_name_candidates_language_code_idx on staging.staging_search_name_candidates (language_code);
create index if not exists staging_search_name_candidates_entity_family_idx on staging.staging_search_name_candidates (entity_family);

create index if not exists staging_search_address_candidates_source_snapshot_id_idx on staging.staging_search_address_candidates (source_snapshot_id);
create index if not exists staging_search_address_candidates_external_id_idx on staging.staging_search_address_candidates (external_id);
create index if not exists staging_search_address_candidates_created_at_idx on staging.staging_search_address_candidates (created_at);
create index if not exists staging_search_address_candidates_search_text_idx on staging.staging_search_address_candidates (search_text);
create index if not exists staging_search_address_candidates_lower_search_text_idx on staging.staging_search_address_candidates (lower(search_text));
create index if not exists staging_search_address_candidates_language_code_idx on staging.staging_search_address_candidates (language_code);

-- Routing indexes.
create index if not exists staging_routing_road_candidates_source_snapshot_id_idx on staging.staging_routing_road_candidates (source_snapshot_id);
create index if not exists staging_routing_road_candidates_external_id_idx on staging.staging_routing_road_candidates (external_id);
create index if not exists staging_routing_road_candidates_match_status_idx on staging.staging_routing_road_candidates (match_status);
create index if not exists staging_routing_road_candidates_auto_action_idx on staging.staging_routing_road_candidates (auto_action);
create index if not exists staging_routing_road_candidates_review_status_idx on staging.staging_routing_road_candidates (review_status);
create index if not exists staging_routing_road_candidates_created_at_idx on staging.staging_routing_road_candidates (created_at);
create index if not exists staging_routing_road_candidates_road_candidate_id_idx on staging.staging_routing_road_candidates (road_candidate_id);
create index if not exists staging_routing_road_candidates_geom_gix on staging.staging_routing_road_candidates using gist (geom);
create index if not exists staging_routing_road_candidates_geom_multi_gix on staging.staging_routing_road_candidates using gist (geom_multi);

create index if not exists staging_routing_turn_restriction_candidates_source_snapshot_id_idx on staging.staging_routing_turn_restriction_candidates (source_snapshot_id);
create index if not exists staging_routing_turn_restriction_candidates_external_id_idx on staging.staging_routing_turn_restriction_candidates (external_id);
create index if not exists staging_routing_turn_restriction_candidates_match_status_idx on staging.staging_routing_turn_restriction_candidates (match_status);
create index if not exists staging_routing_turn_restriction_candidates_created_at_idx on staging.staging_routing_turn_restriction_candidates (created_at);

create index if not exists staging_routing_barrier_candidates_source_snapshot_id_idx on staging.staging_routing_barrier_candidates (source_snapshot_id);
create index if not exists staging_routing_barrier_candidates_external_id_idx on staging.staging_routing_barrier_candidates (external_id);
create index if not exists staging_routing_barrier_candidates_match_status_idx on staging.staging_routing_barrier_candidates (match_status);
create index if not exists staging_routing_barrier_candidates_created_at_idx on staging.staging_routing_barrier_candidates (created_at);
create index if not exists staging_routing_barrier_candidates_point_geom_gix on staging.staging_routing_barrier_candidates using gist (point_geom);
create index if not exists staging_routing_barrier_candidates_geom_gix on staging.staging_routing_barrier_candidates using gist (geom);

-- Transit indexes.
create index if not exists staging_bus_route_variant_candidates_source_snapshot_id_idx on staging.staging_bus_route_variant_candidates (source_snapshot_id);
create index if not exists staging_bus_route_variant_candidates_external_id_idx on staging.staging_bus_route_variant_candidates (external_id);
create index if not exists staging_bus_route_variant_candidates_match_status_idx on staging.staging_bus_route_variant_candidates (match_status);
create index if not exists staging_bus_route_variant_candidates_auto_action_idx on staging.staging_bus_route_variant_candidates (auto_action);
create index if not exists staging_bus_route_variant_candidates_review_status_idx on staging.staging_bus_route_variant_candidates (review_status);
create index if not exists staging_bus_route_variant_candidates_created_at_idx on staging.staging_bus_route_variant_candidates (created_at);
create index if not exists staging_bus_route_variant_candidates_bus_route_candidate_id_idx on staging.staging_bus_route_variant_candidates (bus_route_candidate_id);
create index if not exists staging_bus_route_variant_candidates_geom_gix on staging.staging_bus_route_variant_candidates using gist (geom);

create index if not exists staging_bus_route_stop_candidates_source_snapshot_id_idx on staging.staging_bus_route_stop_candidates (source_snapshot_id);
create index if not exists staging_bus_route_stop_candidates_external_id_idx on staging.staging_bus_route_stop_candidates (external_id);
create index if not exists staging_bus_route_stop_candidates_match_status_idx on staging.staging_bus_route_stop_candidates (match_status);
create index if not exists staging_bus_route_stop_candidates_created_at_idx on staging.staging_bus_route_stop_candidates (created_at);
create index if not exists staging_bus_route_stop_candidates_bus_route_variant_candidate_id_idx on staging.staging_bus_route_stop_candidates (bus_route_variant_candidate_id);
create index if not exists staging_bus_route_stop_candidates_bus_stop_candidate_id_idx on staging.staging_bus_route_stop_candidates (bus_stop_candidate_id);
create index if not exists staging_bus_route_stop_candidates_point_geom_gix on staging.staging_bus_route_stop_candidates using gist (point_geom);

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

comment on table staging.staging_road_name_candidates is 'Road names extracted from raw OSM tags for Stage E review/search.';
comment on table staging.staging_admin_area_name_candidates is 'Admin area names extracted from raw OSM tags for Stage E review/search.';
comment on table staging.staging_bus_stop_name_candidates is 'Bus stop names extracted from raw OSM tags for Stage E review/search.';
comment on table staging.staging_bus_route_name_candidates is 'Bus route names extracted from raw OSM tags for Stage E review/search.';
comment on table staging.staging_address_candidates is 'Address candidates extracted from raw OSM tags before core promotion.';
comment on table staging.staging_address_component_candidates is 'Normalized address components linked to staging address candidates.';
comment on table staging.staging_search_name_candidates is 'Search-name index candidates generated from places, roads, admin areas, transit, and aliases.';
comment on table staging.staging_search_address_candidates is 'Search-address index candidates generated from staged address data.';
comment on table staging.staging_routing_road_candidates is 'Routing-ready road candidates extracted from raw OSM roads.';
comment on table staging.staging_routing_turn_restriction_candidates is 'Turn restriction candidates extracted from OSM relation tags.';
comment on table staging.staging_routing_barrier_candidates is 'Routing barrier candidates extracted from OSM nodes/ways.';
comment on table staging.staging_bus_route_variant_candidates is 'Bus route variant candidates, including direction and geometry variants.';
comment on table staging.staging_bus_route_stop_candidates is 'Ordered stop candidates for bus route variants.';

comment on column staging.staging_address_candidates.source_refs is 'Raw OSM/source lineage references used by review and diff tooling.';
comment on column staging.staging_address_candidates.normalized_data is 'Structured normalized address payload for review and promotion.';
comment on column staging.staging_routing_road_candidates.routing_tags is 'Routing-specific extracted tags such as highway, junction, access, and turn metadata.';
comment on column staging.staging_search_name_candidates.tokens is 'Pre-tokenized search payload for local search experiments.';

-- =============================================================================
-- Validation (run manually after applying locally)
-- =============================================================================
--
-- List Stage E tables:
-- select table_schema, table_name
-- from information_schema.tables
-- where table_schema = 'staging'
--   and table_name in (
--     'staging_road_name_candidates',
--     'staging_admin_area_name_candidates',
--     'staging_bus_stop_name_candidates',
--     'staging_bus_route_name_candidates',
--     'staging_address_candidates',
--     'staging_address_component_candidates',
--     'staging_search_name_candidates',
--     'staging_search_address_candidates',
--     'staging_routing_road_candidates',
--     'staging_routing_turn_restriction_candidates',
--     'staging_routing_barrier_candidates',
--     'staging_bus_route_variant_candidates',
--     'staging_bus_route_stop_candidates'
--   )
-- order by table_name;
--
-- Find missing columns on new Stage E tables:
-- with expected(table_name, column_name) as (
--   values
--     ('staging_address_candidates', 'source_snapshot_id'),
--     ('staging_address_candidates', 'external_id'),
--     ('staging_address_candidates', 'source_refs'),
--     ('staging_address_candidates', 'normalized_data'),
--     ('staging_search_name_candidates', 'name'),
--     ('staging_search_address_candidates', 'search_text'),
--     ('staging_routing_road_candidates', 'geom'),
--     ('staging_routing_road_candidates', 'geom_multi'),
--     ('staging_bus_route_variant_candidates', 'geom'),
--     ('staging_bus_route_stop_candidates', 'point_geom')
-- )
-- select expected.*
-- from expected
-- left join information_schema.columns c
--   on c.table_schema = 'staging'
--  and c.table_name = expected.table_name
--  and c.column_name = expected.column_name
-- where c.column_name is null
-- order by expected.table_name, expected.column_name;
--
-- Inspect Stage E indexes:
-- select schemaname, tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'staging'
--   and tablename like 'staging_%_candidates'
-- order by tablename, indexname;
--
