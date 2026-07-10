-- =============================================================================
-- 133_search_analytics.sql
-- Lightweight aggregated search behavior telemetry (no event bus).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- search.search_request_events
-- One row per completed first-page text search (not keystrokes / pagination).
-- ---------------------------------------------------------------------------
create table if not exists search.search_request_events (
    id bigserial primary key,
    correlation_id uuid not null,
    normalized_query text not null,
    lang text null,
    category text not null default 'all',
    transport_type text not null default 'all',
    transport_mode text not null default 'all',
    result_count integer not null default 0,
    latency_ms integer not null,
    session_key text null,
    created_at timestamptz not null default now(),
    constraint search_request_events_correlation_id_key unique (correlation_id),
    constraint search_request_events_latency_ms_chk check (latency_ms >= 0),
    constraint search_request_events_result_count_chk check (result_count >= 0)
);

comment on table search.search_request_events is
    'Aggregated public search request telemetry. No precise location; optional anonymous session key only.';

comment on column search.search_request_events.correlation_id is
    'Client-facing event id returned with search responses for click correlation.';

comment on column search.search_request_events.session_key is
    'Optional anonymous session id (e.g. x-anonymous-id). Not a user profile key.';

create index if not exists search_request_events_created_at_idx
    on search.search_request_events (created_at desc);

create index if not exists search_request_events_normalized_query_created_idx
    on search.search_request_events (lower(normalized_query), created_at desc);

create index if not exists search_request_events_category_created_idx
    on search.search_request_events (category, created_at desc);

-- ---------------------------------------------------------------------------
-- search.search_result_click_events
-- Optional follow-up when the user selects a search result.
-- ---------------------------------------------------------------------------
create table if not exists search.search_result_click_events (
    id bigserial primary key,
    search_correlation_id uuid not null,
    entity_type text not null,
    entity_id bigint not null,
    clicked_rank integer not null,
    time_to_click_ms integer null,
    created_at timestamptz not null default now(),
    constraint search_result_click_events_rank_chk check (clicked_rank >= 1),
    constraint search_result_click_events_time_chk
        check (time_to_click_ms is null or time_to_click_ms >= 0)
);

comment on table search.search_result_click_events is
    'Search result selection telemetry linked by search request correlation id.';

create index if not exists search_result_click_events_created_at_idx
    on search.search_result_click_events (created_at desc);

create index if not exists search_result_click_events_correlation_idx
    on search.search_result_click_events (search_correlation_id, created_at desc);

create index if not exists search_result_click_events_entity_idx
    on search.search_result_click_events (entity_type, entity_id, created_at desc);

commit;

-- =============================================================================
-- Rollback (manual):
--   begin;
--     drop table if exists search.search_result_click_events;
--     drop table if exists search.search_request_events;
--   commit;
-- =============================================================================
