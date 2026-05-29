-- =============================================================================
-- Supabase migration 072: seed YBS default service calendar (MVP GTFS/OTP)
-- =============================================================================
--
-- Purpose:
--   Provide a reusable GTFS calendar.txt service_id for Yangon local bus / YBS
--   before verified schedules exist. Idempotent (safe to re-run).
--
-- Includes:
--   - Minimal core_transport.operators row (YBS) — required by
--     service_calendars_target_chk (operator_id or route_id must be set).
--   - Unique index on service_code for ON CONFLICT DO NOTHING.
--
-- Does NOT:
--   - Insert routes, stops, frequencies, or legacy core.core_bus_* data.
--   - Modify API/dashboard code.
--
-- Depends on: 067_create_core_transport_schema.sql
--
-- Apply: Supabase SQL Editor after 067+.
--
-- =============================================================================

begin;

-- Idempotent conflict target for service_calendars.service_code.
create unique index if not exists service_calendars_service_code_uq
    on core_transport.service_calendars (service_code);

-- Minimal operator anchor (no routes/stops).
insert into core_transport.operators (
    operator_code,
    name,
    primary_route_type,
    timezone,
    is_active,
    is_verified,
    verification_status,
    source_refs,
    normalized_data
)
values (
    'ybs',
    'Yangon Bus Service (YBS)',
    'local_bus',
    'Asia/Yangon',
    true,
    false,
    'unverified',
    '{"seed": "072_seed_core_transport_ybs_default_service_calendar"}'::jsonb,
    '{"scope": "yangon_local_bus", "mvp": true}'::jsonb
)
on conflict (operator_code) do nothing;

-- Default daily service calendar for MVP GTFS export / OTP smoke tests.
insert into core_transport.service_calendars (
    operator_id,
    service_code,
    name,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    saturday,
    sunday,
    start_date,
    end_date,
    is_active,
    source_refs,
    normalized_data
)
select
    o.id,
    'ybs_daily_default',
    'YBS Daily Default Service',
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    date_trunc('year', current_date)::date as start_date,
    (date_trunc('year', current_date) + interval '1 year' - interval '1 day')::date as end_date,
    true,
    '{"seed": "072_seed_core_transport_ybs_default_service_calendar", "scope": "yangon_local_bus"}'::jsonb,
    jsonb_build_object(
        'note',
        'Default estimated daily service for MVP GTFS/OTP testing. Replace with verified schedule when available.',
        'mvp',
        true,
        'region',
        'yangon'
    )
from core_transport.operators as o
where o.operator_code = 'ybs'
on conflict (service_code) do nothing;

commit;

-- Verify (optional):
-- select id, operator_id, service_code, name, start_date, end_date, normalized_data
-- from core_transport.service_calendars
-- where service_code = 'ybs_daily_default';
