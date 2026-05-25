-- =============================================================================
-- Supabase migration 052: routing barriers source table
-- =============================================================================
--
-- Source-of-truth routing barriers promoted from import_review. These rows are
-- consumed by future graph builds and do not directly mutate routing_edges.
--
-- =============================================================================

begin;

create schema if not exists routing;

create table if not exists routing.routing_barriers (
    id bigserial primary key,
    public_id uuid not null default gen_random_uuid(),
    barrier_type text not null,
    core_street_id bigint,
    geom geometry(Point, 4326) not null,
    is_active boolean not null default true,
    source_refs jsonb not null default '{}'::jsonb,
    normalized_data jsonb not null default '{}'::jsonb,
    is_verified boolean not null default false,
    verification_status text not null default 'unverified',
    verified_at timestamptz,
    verified_by bigint,
    verification_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint routing_barriers_barrier_type_chk check (btrim(barrier_type) <> ''),
    constraint routing_barriers_verification_status_chk check (
        verification_status in ('unverified', 'verified', 'needs_fix', 'questionable', 'rejected_after_core_review')
    )
);

create unique index if not exists routing_barriers_public_id_uq
    on routing.routing_barriers (public_id);

create index if not exists routing_barriers_geom_gix
    on routing.routing_barriers using gist (geom);

create index if not exists routing_barriers_core_street_id_idx
    on routing.routing_barriers (core_street_id);

create index if not exists routing_barriers_barrier_type_idx
    on routing.routing_barriers (barrier_type);

create index if not exists routing_barriers_is_active_idx
    on routing.routing_barriers (is_active);

create index if not exists routing_barriers_verification_status_idx
    on routing.routing_barriers (verification_status);

do $$
begin
    if to_regclass('core.core_streets') is not null
        and not exists (
            select 1
            from pg_constraint
            where conname = 'routing_barriers_core_street_id_fkey'
              and conrelid = 'routing.routing_barriers'::regclass
        )
    then
        alter table routing.routing_barriers
            add constraint routing_barriers_core_street_id_fkey
                foreign key (core_street_id)
                references core.core_streets (id)
                on delete set null;
    end if;
end $$;

comment on table routing.routing_barriers is
    'Reviewed routing barriers consumed by future graph builds. Does not directly edit generated routing_edges.';

commit;

-- =============================================================================
-- Verification
-- =============================================================================
--
-- SELECT column_name, data_type, udt_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'routing'
--   AND table_name = 'routing_barriers'
-- ORDER BY ordinal_position;
--
