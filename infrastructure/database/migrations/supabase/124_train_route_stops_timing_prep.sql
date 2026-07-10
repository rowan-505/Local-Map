-- =============================================================================
-- Supabase migration 124: train import preparation (route_stops timing + views)
-- =============================================================================
--
-- Purpose:
--   Prepare transport.route_stops for the simple Myanmar train app import pipeline.
--   Adds optional timing/source fields, safe CHECK constraints, helper indexes,
--   and read-only train helper views.
--
-- Scope:
--   - transport.route_stops columns + constraints + indexes (additive only)
--   - transport.stops partial indexes for mode = 'train' (additive only)
--   - transport helper views (CREATE OR REPLACE)
--
-- Does NOT:
--   - create raw import / timing profile / fare tables
--   - modify or delete bus rows
--   - mark or update legacy train route data
--
-- Safety:
--   - IF NOT EXISTS / guarded DO blocks throughout
--   - new CHECK constraints added NOT VALID (no full-table validation lock)
--   - views are read-only
--
-- Depends on:
--   transport schema tables (routes, route_variants, route_stops, stops, …)
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Guard: require transport.route_stops (fail fast on incomplete environments)
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('transport.route_stops') is null then
        raise exception
            'transport.route_stops not found — apply transport schema migrations first';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. route_stops timing / source text columns
-- ---------------------------------------------------------------------------
alter table transport.route_stops
    add column if not exists travel_time_from_previous_seconds integer;

alter table transport.route_stops
    add column if not exists source_time_text text;

alter table transport.route_stops
    add column if not exists source_time_type text;

comment on column transport.route_stops.travel_time_from_previous_seconds is
    'Seconds from the previous station departure to this station arrival, derived from visible app clock times during train import.';

comment on column transport.route_stops.source_time_text is
    'Raw visible clock-time text from the train app for this station row (audit/debug only).';

comment on column transport.route_stops.source_time_type is
    'How source_time_text should be interpreted: arrival, departure, arrival_departure, or unknown.';

-- ---------------------------------------------------------------------------
-- 2. Safe CHECK constraints (NOT VALID — does not scan existing rows on add)
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'route_stops_travel_time_from_previous_nonnegative_chk'
          and conrelid = 'transport.route_stops'::regclass
    ) then
        alter table transport.route_stops
            add constraint route_stops_travel_time_from_previous_nonnegative_chk
            check (
                travel_time_from_previous_seconds is null
                or travel_time_from_previous_seconds >= 0
            ) not valid;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'route_stops_source_time_type_chk'
          and conrelid = 'transport.route_stops'::regclass
    ) then
        alter table transport.route_stops
            add constraint route_stops_source_time_type_chk
            check (
                source_time_type is null
                or source_time_type in (
                    'arrival',
                    'departure',
                    'arrival_departure',
                    'unknown'
                )
            ) not valid;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'route_stops_departure_after_arrival_chk'
          and conrelid = 'transport.route_stops'::regclass
    ) then
        alter table transport.route_stops
            add constraint route_stops_departure_after_arrival_chk
            check (
                departure_offset_seconds is null
                or arrival_offset_seconds is null
                or departure_offset_seconds >= arrival_offset_seconds
            ) not valid;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Helper indexes
-- ---------------------------------------------------------------------------

-- Ordered stop pattern reads (variant editor, import validation)
create index if not exists transport_route_stops_variant_sequence_idx
    on transport.route_stops (route_variant_id, stop_sequence);

-- Reverse lookup: which routes use a shared train stop?
create index if not exists transport_route_stops_stop_id_idx
    on transport.route_stops (stop_id);

-- Timed train rows: filter/sort by offsets per variant
create index if not exists transport_route_stops_timing_idx
    on transport.route_stops (
        route_variant_id,
        arrival_offset_seconds,
        departure_offset_seconds
    );

-- Train station name matching pool (import match-train-stations.ts)
create index if not exists transport_stops_train_name_idx
    on transport.stops (mode, name, name_mm, name_en)
    where mode = 'train'
      and deleted_at is null;

-- Train station geometry pool (spatial proximity checks)
create index if not exists transport_stops_train_geom_gix
    on transport.stops
    using gist (geom)
    where mode = 'train'
      and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Helper views (read-only)
-- ---------------------------------------------------------------------------

-- Reusable train stop geometry + names. Import v1 matches here; never auto-creates.
create or replace view transport.train_station_geometry_pool_v as
select
    s.id as stop_id,
    s.public_id,
    s.stop_code,
    s.name,
    s.name_mm,
    s.name_en,
    s.stop_type,
    s.geom,
    s.admin_area_id,
    s.confidence_score,
    s.review_status,
    s.is_active,
    s.source_refs,
    s.normalized_data,
    s.created_at,
    s.updated_at,
    s.deleted_at
from transport.stops as s
where s.mode = 'train'
  and s.deleted_at is null;

comment on view transport.train_station_geometry_pool_v is
    'Read-only pool of existing train stops (mode = train) for simple train app import station matching. Does not create stops.';

-- Full ordered stop sequence for train routes with timing fields.
create or replace view transport.train_route_stop_sequence_v as
select
    r.id as route_id,
    r.route_code,
    r.public_name,
    rv.id as route_variant_id,
    rv.variant_code,
    rv.direction_name,
    rv.origin_name,
    rv.destination_name,
    rs.id as route_stop_id,
    rs.stop_sequence,
    s.id as stop_id,
    s.stop_code,
    s.name,
    s.name_mm,
    s.name_en,
    s.stop_type,
    s.geom,
    rs.travel_time_from_previous_seconds,
    rs.arrival_offset_seconds,
    rs.departure_offset_seconds,
    rs.source_time_text,
    rs.source_time_type,
    rs.distance_from_start_m,
    rs.is_timing_point,
    rs.source_refs,
    rs.normalized_data
from transport.routes as r
inner join transport.route_variants as rv
    on rv.route_id = r.id
   and rv.deleted_at is null
inner join transport.route_stops as rs
    on rs.route_variant_id = rv.id
inner join transport.stops as s
    on s.id = rs.stop_id
where r.mode = 'train'
  and r.deleted_at is null;

comment on view transport.train_route_stop_sequence_v is
    'Ordered train route_stop rows with station geometry and timing fields for import validation and dashboard review.';

-- Legacy train network rows to replace later (OSM / pre-app-import).
-- Identifies candidates by missing train-app source_link — does not mark rows.
create or replace view transport.train_legacy_data_v as
with legacy_routes as (
    select r.id as route_id
    from transport.routes as r
    where r.mode = 'train'
      and r.deleted_at is null
      and not exists (
          select 1
          from transport.source_links as sl
          where sl.entity_type = 'route'
            and sl.entity_id = r.id
            and sl.source_name = 'external_myanmar_train_app'
      )
)
select
    'route'::text as entity_type,
    r.id as entity_id,
    r.route_code as code,
    r.public_name as name,
    r.review_status,
    r.is_active,
    r.source_refs,
    r.normalized_data,
    r.created_at,
    r.updated_at,
    r.deleted_at
from transport.routes as r
inner join legacy_routes as lr
    on lr.route_id = r.id

union all

select
    'variant'::text as entity_type,
    rv.id as entity_id,
    rv.variant_code as code,
    coalesce(
        rv.headsign,
        nullif(concat_ws(' → ', rv.origin_name, rv.destination_name), '')
    ) as name,
    rv.review_status,
    rv.is_active,
    rv.source_refs,
    rv.normalized_data,
    rv.created_at,
    rv.updated_at,
    rv.deleted_at
from transport.route_variants as rv
inner join legacy_routes as lr
    on lr.route_id = rv.route_id
where rv.deleted_at is null

union all

select
    'path'::text as entity_type,
    rp.id as entity_id,
    rv.variant_code as code,
    rp.path_kind as name,
    rp.review_status,
    rp.is_active,
    rp.source_refs,
    rp.normalized_data,
    rp.created_at,
    rp.updated_at,
    rp.deleted_at
from transport.route_paths as rp
inner join transport.route_variants as rv
    on rv.id = rp.route_variant_id
inner join legacy_routes as lr
    on lr.route_id = rv.route_id
where rp.deleted_at is null
  and rv.deleted_at is null;

comment on view transport.train_legacy_data_v is
    'Train routes/variants/paths without external_myanmar_train_app source_link (legacy OSM/pre-import data). Read-only; cleanup scripts mark/remove later.';

commit;

-- =============================================================================
-- Verification SQL (read-only — run manually after applying)
-- =============================================================================
--
-- 1) New columns:
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'transport' and table_name = 'route_stops'
--   and column_name in (
--       'travel_time_from_previous_seconds',
--       'source_time_text',
--       'source_time_type'
--   );
--
-- 2) Constraints (expect NOT VALID until explicitly validated):
-- select conname, pg_get_constraintdef(oid), convalidated
-- from pg_constraint
-- where conrelid = 'transport.route_stops'::regclass
--   and conname in (
--       'route_stops_travel_time_from_previous_nonnegative_chk',
--       'route_stops_source_time_type_chk',
--       'route_stops_departure_after_arrival_chk'
--   );
--
-- 3) Indexes:
-- select indexname from pg_indexes
-- where schemaname = 'transport'
--   and indexname in (
--       'transport_route_stops_variant_sequence_idx',
--       'transport_route_stops_stop_id_idx',
--       'transport_route_stops_timing_idx',
--       'transport_stops_train_name_idx',
--       'transport_stops_train_geom_gix'
--   );
--
-- 4) Views:
-- select table_name from information_schema.views
-- where table_schema = 'transport'
--   and table_name in (
--       'train_station_geometry_pool_v',
--       'train_route_stop_sequence_v',
--       'train_legacy_data_v'
--   );
--
-- 5) Legacy candidate count (should match current OSM train routes until import):
-- select entity_type, count(*) from transport.train_legacy_data_v group by 1;
