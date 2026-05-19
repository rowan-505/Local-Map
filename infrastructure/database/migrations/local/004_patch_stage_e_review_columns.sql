-- =============================================================================
-- Local-only Stage E review column patch (non-destructive)
-- =============================================================================
--
-- Purpose:
--   Add missing review workflow columns and indexes to optional Stage E
--   routing/transit tables.
--
-- Safety:
--   - Local database only.
--   - Does not touch Supabase.
--   - Does not touch core.
--   - Does not DROP, TRUNCATE, rename, or remove existing indexes.
--
-- =============================================================================

alter table if exists staging.staging_routing_turn_restriction_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending',
    add column if not exists updated_at timestamptz not null default now();

alter table if exists staging.staging_routing_barrier_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending',
    add column if not exists updated_at timestamptz not null default now();

alter table if exists staging.staging_bus_route_stop_candidates
    add column if not exists auto_action text null,
    add column if not exists review_status text not null default 'pending',
    add column if not exists updated_at timestamptz not null default now();

-- routing turn restrictions
create index if not exists staging_routing_turn_restriction_candidates_match_status_idx
    on staging.staging_routing_turn_restriction_candidates (match_status);
create index if not exists staging_routing_turn_restriction_candidates_auto_action_idx
    on staging.staging_routing_turn_restriction_candidates (auto_action);
create index if not exists staging_routing_turn_restriction_candidates_review_status_idx
    on staging.staging_routing_turn_restriction_candidates (review_status);
create index if not exists staging_routing_turn_restriction_candidates_source_snapshot_id_idx
    on staging.staging_routing_turn_restriction_candidates (source_snapshot_id);
create index if not exists staging_routing_turn_restriction_candidates_external_id_idx
    on staging.staging_routing_turn_restriction_candidates (external_id);

-- routing barriers
create index if not exists staging_routing_barrier_candidates_match_status_idx
    on staging.staging_routing_barrier_candidates (match_status);
create index if not exists staging_routing_barrier_candidates_auto_action_idx
    on staging.staging_routing_barrier_candidates (auto_action);
create index if not exists staging_routing_barrier_candidates_review_status_idx
    on staging.staging_routing_barrier_candidates (review_status);
create index if not exists staging_routing_barrier_candidates_source_snapshot_id_idx
    on staging.staging_routing_barrier_candidates (source_snapshot_id);
create index if not exists staging_routing_barrier_candidates_external_id_idx
    on staging.staging_routing_barrier_candidates (external_id);

-- bus route stops
create index if not exists staging_bus_route_stop_candidates_match_status_idx
    on staging.staging_bus_route_stop_candidates (match_status);
create index if not exists staging_bus_route_stop_candidates_auto_action_idx
    on staging.staging_bus_route_stop_candidates (auto_action);
create index if not exists staging_bus_route_stop_candidates_review_status_idx
    on staging.staging_bus_route_stop_candidates (review_status);
create index if not exists staging_bus_route_stop_candidates_source_snapshot_id_idx
    on staging.staging_bus_route_stop_candidates (source_snapshot_id);
create index if not exists staging_bus_route_stop_candidates_external_id_idx
    on staging.staging_bus_route_stop_candidates (external_id);

-- Correctly named companion index. Keep any older/misleading index intact.
create index if not exists staging_address_component_candidates_address_candidate_id_idx
    on staging.staging_address_component_candidates (address_candidate_id);

-- Validation (run manually after applying locally):
--
-- select table_schema, table_name, column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'staging'
--   and table_name in (
--     'staging_routing_turn_restriction_candidates',
--     'staging_routing_barrier_candidates',
--     'staging_bus_route_stop_candidates'
--   )
--   and column_name in ('auto_action', 'review_status', 'updated_at')
-- order by table_name, column_name;
--
-- select schemaname, tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'staging'
--   and tablename in (
--     'staging_routing_turn_restriction_candidates',
--     'staging_routing_barrier_candidates',
--     'staging_bus_route_stop_candidates',
--     'staging_address_component_candidates'
--   )
-- order by tablename, indexname;
