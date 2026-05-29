-- =============================================================================
-- Supabase migration 079: verification_status canonical, is_verified derived
-- =============================================================================
--
-- Purpose:
--   Make verification_status the source of truth on core and core_transport
--   tables that carry both columns. Backfill NULL legacy rows, resync drift,
--   document column roles, and install triggers so is_verified always reflects
--   verification_status = 'verified'.
--
-- Safety:
--   - Idempotent: CREATE OR REPLACE function, DROP TRIGGER IF EXISTS,
--     ADD CONSTRAINT only when no verification_status CHECK exists.
--   - Does NOT drop is_verified or verification_status.
--   - Skips tables/schemas outside core + core_transport.
--   - Skips tables missing either column (see "Tables skipped" in footer).
--   - Uses rejected_after_core_review (project canonical DB value); normalizes
--     legacy alias 'rejected' before sync.
--
-- Apply: Supabase SQL Editor (paste full file). Safe to run once; re-run safe.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Shared trigger function (core schema — callable from core_transport too)
-- ---------------------------------------------------------------------------
create or replace function core.sync_is_verified_from_verification_status()
returns trigger
language plpgsql
as $$
begin
    new.is_verified := (new.verification_status = 'verified');
    return new;
end;
$$;

comment on function core.sync_is_verified_from_verification_status() is
    'BEFORE INSERT/UPDATE trigger helper: keeps is_verified derived from verification_status.';

-- ---------------------------------------------------------------------------
-- Per-table backfill, sync, comments, CHECK (if missing), trigger
-- ---------------------------------------------------------------------------
do $$
declare
    cfg record;
    full_name text;
    constraint_name text;
    trigger_name constant text := 'trg_sync_is_verified_from_verification_status';
    has_check boolean;
    invalid_status_count bigint;
begin
    for cfg in
        select
            n.nspname as schema_name,
            c.relname as table_name
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('core', 'core_transport')
          and c.relkind = 'r'
          and exists (
              select 1
              from pg_catalog.pg_attribute a
              where a.attrelid = c.oid
                and a.attname = 'is_verified'
                and a.attnum > 0
                and not a.attisdropped
          )
          and exists (
              select 1
              from pg_catalog.pg_attribute a
              where a.attrelid = c.oid
                and a.attname = 'verification_status'
                and a.attnum > 0
                and not a.attisdropped
          )
        order by n.nspname, c.relname
    loop
        full_name := format('%I.%I', cfg.schema_name, cfg.table_name);
        constraint_name := cfg.table_name || '_verification_status_chk';

        raise notice '079: processing %', full_name;

        -- A1. Normalize legacy alias before CHECK/sync.
        execute format(
            $sql$
            update %s
            set verification_status = 'rejected_after_core_review'
            where verification_status = 'rejected'
            $sql$,
            full_name
        );

        execute format(
            $sql$
            update %s
            set verification_status = 'unverified'
            where verification_status is not null
              and btrim(verification_status) = ''
            $sql$,
            full_name
        );

        -- A2. Backfill NULL verification_status from legacy is_verified.
        execute format(
            $sql$
            update %s
            set verification_status = case
                when is_verified is true then 'verified'
                else 'unverified'
            end
            where verification_status is null
            $sql$,
            full_name
        );

        -- B. Sync derived is_verified from canonical verification_status.
        execute format(
            $sql$
            update %s
            set is_verified = (verification_status = 'verified')
            where is_verified is distinct from (verification_status = 'verified')
            $sql$,
            full_name
        );

        -- Column comments (canonical / derived).
        execute format(
            $sql$
            comment on column %s.verification_status is
                'Canonical reviewer lifecycle status: unverified, verified, needs_fix, questionable, rejected_after_core_review.'
            $sql$,
            full_name
        );

        execute format(
            $sql$
            comment on column %s.is_verified is
                'Derived compatibility flag: true only when verification_status = verified. Maintained by trigger core.sync_is_verified_from_verification_status().'
            $sql$,
            full_name
        );

        -- C. CHECK constraint when missing and data is compatible.
        select exists (
            select 1
            from pg_catalog.pg_constraint con
            where con.conrelid = full_name::regclass
              and con.contype = 'c'
              and (
                  con.conname = constraint_name
                  or pg_get_constraintdef(con.oid) ilike '%verification_status%'
              )
        )
        into has_check;

        if not has_check then
            execute format(
                $sql$
                select count(*)::bigint
                from %s t
                where t.verification_status is not null
                  and t.verification_status not in (
                      'unverified',
                      'verified',
                      'needs_fix',
                      'questionable',
                      'rejected_after_core_review'
                  )
                $sql$,
                full_name
            )
            into invalid_status_count;

            if coalesce(invalid_status_count, 0) > 0 then
                raise notice
                    '079: skipping CHECK on % — % row(s) with non-standard verification_status; normalize manually then re-run.',
                    full_name,
                    invalid_status_count;
            else
                execute format(
                    $sql$
                    alter table %s
                        add constraint %I check (
                            verification_status in (
                                'unverified',
                                'verified',
                                'needs_fix',
                                'questionable',
                                'rejected_after_core_review'
                            )
                        )
                    $sql$,
                    full_name,
                    constraint_name
                );
                raise notice '079: added CHECK % on %', constraint_name, full_name;
            end if;
        end if;

        -- D. Trigger to keep is_verified derived on write.
        execute format(
            'drop trigger if exists %I on %s',
            trigger_name,
            full_name
        );

        execute format(
            $sql$
            create trigger %I
                before insert or update of verification_status
                on %s
                for each row
                execute function core.sync_is_verified_from_verification_status()
            $sql$,
            trigger_name,
            full_name
        );

        raise notice '079: applied trigger % on %', trigger_name, full_name;
    end loop;
end $$;

commit;

-- =============================================================================
-- Tables touched (expected when all prior migrations applied)
-- =============================================================================
--
-- core schema (migration 026):
--   core_addresses
--   core_admin_areas
--   core_bus_route_stops
--   core_bus_route_variants
--   core_bus_routes
--   core_bus_stops
--   core_map_buildings
--   core_map_landuse
--   core_map_water_lines
--   core_map_water_polygons
--   core_places
--   core_streets
--
-- core_transport schema (migration 067):
--   core_transport.operators
--   core_transport.routes
--   core_transport.route_variants
--   core_transport.stops
--   core_transport.terminals
--
-- Actual set is discovered dynamically (both columns present).
--
-- =============================================================================
-- Tables skipped (by design — not in core/core_transport or missing a column)
-- =============================================================================
--
-- core / core_transport — is_verified only (no verification_status):
--   core_transport.fares
--
-- core_transport — no verification columns (not Core Review verification entities):
--   core_transport.route_names
--   core_transport.stop_names
--   core_transport.route_stops
--   core_transport.route_paths
--   core_transport.service_calendars
--   core_transport.frequencies
--   core_transport.route_sources
--   core_transport.route_versions
--
-- Other schemas (out of scope for this migration):
--   routing.routing_barriers  (has both columns; Core Review promotion target
--                            but outside core/core_transport scope here)
--   import_review.*, import_transport.*, ref.*, etc.
--
-- Tables that do not exist in the target DB are skipped silently by the loop.
--
-- =============================================================================
-- Conflict-check queries (run BEFORE migration in prod if unsure)
-- =============================================================================
--
-- 1) Discover all core/core_transport tables with both columns:
--
-- select
--     n.nspname as schema_name,
--     c.relname as table_name
-- from pg_catalog.pg_class c
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where n.nspname in ('core', 'core_transport')
--   and c.relkind = 'r'
--   and exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'is_verified'
--         and a.attnum > 0 and not a.attisdropped
--   )
--   and exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'verification_status'
--         and a.attnum > 0 and not a.attisdropped
--   )
-- order by 1, 2;
--
-- 2) Rows that would block a new CHECK constraint (non-standard status values):
--
-- select 'core.core_places' as rel, verification_status, count(*) as row_count
-- from core.core_places
-- where verification_status is not null
--   and verification_status not in (
--       'unverified', 'verified', 'needs_fix', 'questionable',
--       'rejected_after_core_review', 'rejected'
--   )
-- group by verification_status
-- union all
-- select 'core_transport.routes', verification_status, count(*)
-- from core_transport.routes
-- where verification_status is not null
--   and verification_status not in (
--       'unverified', 'verified', 'needs_fix', 'questionable',
--       'rejected_after_core_review', 'rejected'
--   )
-- group by verification_status;
-- (Repeat per table or generate dynamically.)
--
-- 3) Drift between canonical status and derived flag (should be 0 after migration):
--
-- select verification_status, is_verified, count(*) as row_count
-- from core.core_places
-- where is_verified is distinct from (verification_status = 'verified')
-- group by verification_status, is_verified
-- order by 1, 2;
--
-- Dynamic drift scan across all dual-column tables:
--
-- select format(
--     'select %L as rel, count(*) as drift_rows from %I.%I where is_verified is distinct from (verification_status = ''verified'')',
--     n.nspname || '.' || c.relname,
--     n.nspname,
--     c.relname
-- )
-- from pg_catalog.pg_class c
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where n.nspname in ('core', 'core_transport')
--   and c.relkind = 'r'
--   and exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'is_verified'
--         and a.attnum > 0 and not a.attisdropped
--   )
--   and exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'verification_status'
--         and a.attnum > 0 and not a.attisdropped
--   )
-- order by 1;
-- (Execute each generated statement, or wrap in a DO block.)
--
-- 4) NULL verification_status rows (should be 0 after migration):
--
-- select count(*) from core.core_places where verification_status is null;
--
-- 5) Triggers installed:
--
-- select
--     n.nspname as schema_name,
--     c.relname as table_name,
--     t.tgname as trigger_name
-- from pg_catalog.pg_trigger t
-- join pg_catalog.pg_class c on c.oid = t.tgrelid
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where not t.tgisinternal
--   and t.tgname = 'trg_sync_is_verified_from_verification_status'
-- order by 1, 2;
--
-- 6) is_verified-only tables in core/core_transport (skipped):
--
-- select n.nspname, c.relname
-- from pg_catalog.pg_class c
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where n.nspname in ('core', 'core_transport')
--   and c.relkind = 'r'
--   and exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'is_verified'
--         and a.attnum > 0 and not a.attisdropped
--   )
--   and not exists (
--       select 1 from pg_catalog.pg_attribute a
--       where a.attrelid = c.oid and a.attname = 'verification_status'
--         and a.attnum > 0 and not a.attisdropped
--   )
-- order by 1, 2;
