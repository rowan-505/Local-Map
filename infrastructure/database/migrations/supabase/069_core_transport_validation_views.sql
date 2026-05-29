-- =============================================================================
-- Supabase migration 069: core_transport validation views (GTFS / OTP readiness)
-- =============================================================================
--
-- Purpose:
--   Read-only views to surface data quality problems in core_transport before
--   GTFS export (gtfs_export) and OpenTripPlanner graph builds. No table changes.
--
-- Safety:
--   - CREATE OR REPLACE VIEW only.
--   - Does NOT modify core.core_bus_*, tiles.*, or application code.
--
-- Depends on: 067_create_core_transport_schema.sql
--
-- Apply: Supabase SQL Editor or your usual migration workflow.
--
-- =============================================================================

begin;

-- Active-row predicates reused conceptually:
--   routes / route_variants / stops: is_active = true AND deleted_at IS NULL
--   route_paths (primary shape): path_kind = 'shape', is_active = true, deleted_at IS NULL

-- ---------------------------------------------------------------------------
-- 1. Variants with fewer than two pattern stops (cannot form a trip leg)
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_route_variants_with_too_few_stops as
select
    v.id as route_variant_id,
    v.public_id as route_variant_public_id,
    v.route_id,
    r.route_code,
    r.public_name as route_public_name,
    v.variant_code,
    count(rs.id)::integer as stop_count
from core_transport.route_variants as v
inner join core_transport.routes as r
    on r.id = v.route_id
left join core_transport.route_stops as rs
    on rs.route_variant_id = v.id
where v.is_active = true
  and v.deleted_at is null
  and r.is_active = true
  and r.deleted_at is null
group by
    v.id,
    v.public_id,
    v.route_id,
    r.route_code,
    r.public_name,
    v.variant_code
having count(rs.id) < 2;

comment on view core_transport.v_route_variants_with_too_few_stops is
    'Active route variants with fewer than two route_stops — invalid for GTFS trips/stop_times.';

-- ---------------------------------------------------------------------------
-- 2. Duplicate stop_sequence within the same variant (should be unique)
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_duplicate_route_stop_sequences as
select
    rs.route_variant_id,
    v.variant_code,
    v.route_id,
    r.route_code,
    rs.stop_sequence,
    count(*)::integer as duplicate_count,
    array_agg(rs.id order by rs.id) as route_stop_ids
from core_transport.route_stops as rs
inner join core_transport.route_variants as v
    on v.id = rs.route_variant_id
inner join core_transport.routes as r
    on r.id = v.route_id
where v.is_active = true
  and v.deleted_at is null
group by
    rs.route_variant_id,
    v.variant_code,
    v.route_id,
    r.route_code,
    rs.stop_sequence
having count(*) > 1;

comment on view core_transport.v_duplicate_route_stop_sequences is
    'Duplicate stop_sequence values on one variant — breaks GTFS stop_times ordering (unique constraint should prevent inserts).';

-- ---------------------------------------------------------------------------
-- 3. Active stops missing English/Myanmar names and stop_code
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_stops_without_names as
select
    s.id as stop_id,
    s.public_id as stop_public_id,
    s.stop_code,
    s.name as canonical_name,
    s.name_local,
    s.stop_type
from core_transport.stops as s
left join lateral (
    select n.name
    from core_transport.stop_names as n
    where n.stop_id = s.id
      and n.language_code = 'en'
      and btrim(n.name) <> ''
    order by n.is_primary desc, n.id
    limit 1
) as name_en on true
left join lateral (
    select n.name
    from core_transport.stop_names as n
    where n.stop_id = s.id
      and n.language_code in ('mm', 'my')
      and btrim(n.name) <> ''
    order by n.is_primary desc, n.id
    limit 1
) as name_mm on true
where s.is_active = true
  and s.deleted_at is null
  and name_en.name is null
  and name_mm.name is null
  and (s.stop_code is null or btrim(s.stop_code) = '');

comment on view core_transport.v_stops_without_names is
    'Active stops with no stop_names (en/mm), no stop_code, and no GTFS-ready identifier for export.';

-- ---------------------------------------------------------------------------
-- 4. Active variants with no active frequency row (headway service gap)
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_variants_without_frequency as
select
    v.id as route_variant_id,
    v.public_id as route_variant_public_id,
    v.route_id,
    r.route_code,
    r.public_name as route_public_name,
    v.variant_code
from core_transport.route_variants as v
inner join core_transport.routes as r
    on r.id = v.route_id
where v.is_active = true
  and v.deleted_at is null
  and r.is_active = true
  and r.deleted_at is null
  and not exists (
      select 1
      from core_transport.frequencies as f
      where f.route_variant_id = v.id
        and f.is_active = true
  );

comment on view core_transport.v_variants_without_frequency is
    'Active variants lacking an active frequencies row — may be OK if all trips use exact stop_times, but flags OTP headway gaps.';

-- ---------------------------------------------------------------------------
-- 5. Active routes with no active variants
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_routes_without_variants as
select
    r.id as route_id,
    r.public_id as route_public_id,
    r.route_code,
    r.public_name,
    r.route_type,
    r.operator_id
from core_transport.routes as r
where r.is_active = true
  and r.deleted_at is null
  and not exists (
      select 1
      from core_transport.route_variants as v
      where v.route_id = r.id
        and v.is_active = true
        and v.deleted_at is null
  );

comment on view core_transport.v_routes_without_variants is
    'Active routes with no active variants — cannot export GTFS routes/trips/shapes for the route.';

-- ---------------------------------------------------------------------------
-- 6. Pattern stops missing both arrival and departure offsets
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_route_stops_missing_timing as
select
    rs.id as route_stop_id,
    rs.route_variant_id,
    v.variant_code,
    v.route_id,
    r.route_code,
    rs.stop_id,
    s.stop_code,
    rs.stop_sequence,
    rs.is_timing_point
from core_transport.route_stops as rs
inner join core_transport.route_variants as v
    on v.id = rs.route_variant_id
inner join core_transport.routes as r
    on r.id = v.route_id
inner join core_transport.stops as s
    on s.id = rs.stop_id
where v.is_active = true
  and v.deleted_at is null
  and rs.arrival_offset_seconds is null
  and rs.departure_offset_seconds is null;

comment on view core_transport.v_route_stops_missing_timing is
    'Route pattern rows with no arrival/departure offsets — fine when frequencies cover the variant; otherwise stop_times export may be empty.';

-- ---------------------------------------------------------------------------
-- 7. Active variants missing line geometry (variant geom and primary shape path)
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_route_paths_missing as
select
    v.id as route_variant_id,
    v.public_id as route_variant_public_id,
    v.route_id,
    r.route_code,
    r.public_name as route_public_name,
    v.variant_code,
    v.geom is not null as has_variant_geom,
    shape_path.path_id as primary_shape_path_id
from core_transport.route_variants as v
inner join core_transport.routes as r
    on r.id = v.route_id
left join lateral (
    select p.id as path_id
    from core_transport.route_paths as p
    where p.route_variant_id = v.id
      and p.path_kind = 'shape'
      and p.is_active = true
      and p.deleted_at is null
      and p.geom is not null
      and not st_isempty(p.geom)
    order by p.updated_at desc, p.id
    limit 1
) as shape_path on true
where v.is_active = true
  and v.deleted_at is null
  and r.is_active = true
  and r.deleted_at is null
  and (
      v.geom is null
      or st_isempty(v.geom)
  )
  and shape_path.path_id is null;

comment on view core_transport.v_route_paths_missing is
    'Active variants with no usable LineString on the variant or on an active primary shape route_paths row — map/OTP shape export gap.';

-- ---------------------------------------------------------------------------
-- 8. Single-row GTFS / OTP readiness summary
-- ---------------------------------------------------------------------------
create or replace view core_transport.v_gtfs_readiness_summary as
select
    (
        select count(*)::bigint
        from core_transport.routes as r
        where r.is_active = true
          and r.deleted_at is null
    ) as active_routes,
    (
        select count(*)::bigint
        from core_transport.route_variants as v
        where v.is_active = true
          and v.deleted_at is null
    ) as active_variants,
    (
        select count(*)::bigint
        from core_transport.stops as s
        where s.is_active = true
          and s.deleted_at is null
    ) as active_stops,
    (
        select count(*)::bigint
        from core_transport.v_route_variants_with_too_few_stops
    ) as variants_too_few_stops,
    (
        select count(*)::bigint
        from core_transport.v_duplicate_route_stop_sequences
    ) as duplicate_sequences,
    (
        select count(*)::bigint
        from core_transport.v_stops_without_names
    ) as stops_without_names,
    (
        select count(*)::bigint
        from core_transport.v_variants_without_frequency
    ) as variants_without_frequency,
    (
        select count(*)::bigint
        from core_transport.v_route_paths_missing
    ) as variants_without_path;

comment on view core_transport.v_gtfs_readiness_summary is
    'One-row dashboard of active entity counts and validation issue totals before gtfs_export / OTP build.';

commit;
