-- =============================================================================
-- Supabase migration 125: route_stops.waiting_time_seconds for calculated timetables
-- =============================================================================
--
-- Adds optional dwell/wait time at a stop (seconds). Used with
-- travel_time_from_previous_seconds to derive arrival/departure offsets.
--
-- =============================================================================

begin;

do $$
begin
    if to_regclass('transport.route_stops') is null then
        raise exception
            'transport.route_stops not found — apply transport schema migrations first';
    end if;
end $$;

alter table transport.route_stops
    add column if not exists waiting_time_seconds integer;

comment on column transport.route_stops.waiting_time_seconds is
    'Optional dwell time at this stop in seconds. Added to arrival_offset_seconds to derive departure_offset_seconds for middle stops.';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'route_stops_waiting_time_nonnegative_chk'
          and conrelid = 'transport.route_stops'::regclass
    ) then
        alter table transport.route_stops
            add constraint route_stops_waiting_time_nonnegative_chk
            check (
                waiting_time_seconds is null
                or waiting_time_seconds >= 0
            ) not valid;
    end if;
end $$;

commit;
