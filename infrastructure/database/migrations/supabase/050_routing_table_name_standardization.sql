-- =============================================================================
-- Supabase migration 050: routing schema table name standardization
-- =============================================================================
--
-- Drops legacy non-prefixed routing tables only when empty (row-count guard).
-- Creates routing.routing_edge_names and routing.routing_turn_restrictions
-- aligned with build-job-scoped routing.routing_edges / routing.routing_nodes.
--
-- Requires: 049_routing_graph_foundation.sql (routing.routing_* graph tables).
-- Does not rename routing.routing_nodes or routing.routing_edges.
--
-- =============================================================================

begin;

create schema if not exists routing;

-- ---------------------------------------------------------------------------
-- Guard: refuse to drop legacy tables that still hold rows
-- ---------------------------------------------------------------------------
do $$
declare
    v_table_name text;
    v_count bigint;
    v_legacy_tables text[] := array[
        'edge_names',
        'road_edges',
        'road_nodes',
        'turn_restrictions'
    ];
begin
    foreach v_table_name in array v_legacy_tables
    loop
        if to_regclass(format('routing.%I', v_table_name)) is null then
            continue;
        end if;

        execute format(
            'select count(*)::bigint from routing.%I',
            v_table_name
        )
        into v_count;

        if v_count > 0 then
            raise exception
                'Migration aborted: routing.% has % row(s). Migrate or archive data before standardizing routing table names.',
                v_table_name,
                v_count
                using hint = 'Legacy tables must be empty before drop. New graph data belongs in routing.routing_* tables.';
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Drop empty legacy tables (FK-safe order)
-- ---------------------------------------------------------------------------
drop table if exists routing.edge_names;
drop table if exists routing.turn_restrictions;
drop table if exists routing.road_edges;
drop table if exists routing.road_nodes;

-- ---------------------------------------------------------------------------
-- routing.routing_edge_names
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_edge_names (
    id bigserial primary key,
    routing_edge_id bigint not null references routing.routing_edges (id) on delete cascade,
    name text not null,
    language_code text,
    script_code text,
    name_type text not null default 'official',
    is_primary boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists routing_edge_names_edge_idx
    on routing.routing_edge_names (routing_edge_id);

create index if not exists routing_edge_names_language_idx
    on routing.routing_edge_names (language_code);

comment on table routing.routing_edge_names is
    'Display/search names for routing.routing_edges segments (build-job graph).';

-- ---------------------------------------------------------------------------
-- routing.routing_turn_restrictions
-- ---------------------------------------------------------------------------
create table if not exists routing.routing_turn_restrictions (
    id bigserial primary key,
    build_job_id bigint not null references routing.routing_build_jobs (id) on delete cascade,
    from_edge_id bigint not null references routing.routing_edges (id) on delete cascade,
    via_node_id bigint references routing.routing_nodes (id) on delete cascade,
    to_edge_id bigint not null references routing.routing_edges (id) on delete cascade,
    restriction_type text not null,
    source_refs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint routing_turn_restrictions_type_chk check (
        restriction_type in (
            'no_left_turn',
            'no_right_turn',
            'no_u_turn',
            'no_straight_on',
            'only_left_turn',
            'only_right_turn',
            'only_straight_on'
        )
    )
);

create index if not exists routing_turn_restrictions_build_job_idx
    on routing.routing_turn_restrictions (build_job_id);

create index if not exists routing_turn_restrictions_from_edge_idx
    on routing.routing_turn_restrictions (from_edge_id);

create index if not exists routing_turn_restrictions_to_edge_idx
    on routing.routing_turn_restrictions (to_edge_id);

create index if not exists routing_turn_restrictions_via_node_idx
    on routing.routing_turn_restrictions (via_node_id);

comment on table routing.routing_turn_restrictions is
    'Turn restrictions scoped to a routing build job (from/via/to on routing graph edges).';

comment on schema routing is
    'Routing graph derived from core.core_streets. All owned tables use routing.routing_* naming.';

commit;

-- =============================================================================
-- Verification (run manually after applying in Supabase SQL Editor)
-- =============================================================================
--
-- SELECT table_schema, table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'routing'
--   AND table_type = 'BASE TABLE'
-- ORDER BY table_name;
--
-- Expected BASE TABLE names (8):
--   routing_build_jobs
--   routing_build_metadata
--   routing_edge_names
--   routing_edges
--   routing_nodes
--   routing_profiles
--   routing_turn_restrictions
--   routing_validation_reports
--
-- Legacy tables must be absent:
--   edge_names, road_edges, road_nodes, turn_restrictions
