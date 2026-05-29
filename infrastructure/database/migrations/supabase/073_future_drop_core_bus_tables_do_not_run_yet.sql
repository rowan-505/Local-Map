-- =============================================================================
-- Supabase migration 073: FUTURE — drop legacy core.core_bus_* tables
-- =============================================================================
--
-- ████████████████████████████████████████████████████████████████████████████
-- ██  DO NOT RUN THIS MIGRATION YET                                           ██
-- ██  Filename: 073_future_drop_core_bus_tables_do_not_run_yet.sql            ██
-- ██  Status:   PREPARED ONLY — not part of current deploy sequence           ██
-- ████████████████████████████████████████████████████████████████████████████
--
-- Purpose (when eventually approved):
--   Remove deprecated legacy bus tables after core_transport is the sole
--   production source for transit map data, GTFS export, and API paths.
--
-- Run only after ALL of the following are true:
--   [ ] apps/api build / typecheck passes with no core.core_bus_* SQL
--   [ ] apps/dashboard build passes with no core.core_bus_* dependencies
--   [ ] apps/web map loads bus layers from core_transport-backed tiles/API
--   [ ] tiles.tiles_bus_stops_v and tiles.tiles_bus_routes_v use core_transport
--   [ ] tiles.tiles_bus_route_variants_v repointed or removed (still on core today)
--   [ ] tools/transit/import promote path no longer targets core.core_bus_*
--   [ ] tools/transit/gtfs-export reads only core_transport
--   [ ] import_review promotion no longer writes core.core_bus_* (or retired)
--   [ ] Legacy row counts are ALL zero (see check below)
--   [ ] pg_depend shows NO views depending on core.core_bus_* tables
--   [ ] No foreign keys from other tables reference core.core_bus_* (see check)
--   [ ] Backup / rollback window agreed with operators
--
-- Safety:
--   - Does NOT use DROP ... CASCADE.
--   - Aborts with RAISE EXCEPTION if any guard fails.
--   - Drops in explicit FK-safe child-first order.
--
-- Depends on: 071_deprecate_core_bus_tables_comments.sql (comments only).
-- Replaces:     nothing until manually applied in a future maintenance window.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Guard 1: all legacy tables must be empty
-- ---------------------------------------------------------------------------
do $$
declare
    tbl text;
    row_count bigint;
    legacy_tables text[] := array[
        'core_bus_route_stops',
        'core_bus_route_names',
        'core_bus_stop_names',
        'core_bus_route_variants',
        'core_bus_routes',
        'core_bus_stops'
    ];
begin
    foreach tbl in array legacy_tables
    loop
        if to_regclass('core.' || tbl) is null then
            raise notice 'Skipping row-count guard — table core.% does not exist', tbl;
            continue;
        end if;

        execute format('select count(*)::bigint from core.%I', tbl) into row_count;

        if row_count > 0 then
            raise exception
                'BLOCKED: core.% still has % row(s). Migrate or archive data before drop.',
                tbl, row_count;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Guard 2: no views may depend on legacy core_bus tables
-- ---------------------------------------------------------------------------
do $$
declare
    blocker record;
begin
    for blocker in
        select
            vn.nspname as view_schema,
            v.relname as view_name,
            refn.nspname as ref_schema,
            ref.relname as ref_name
        from pg_depend as d
        join pg_class as v on v.oid = d.objid
        join pg_namespace as vn on vn.oid = v.relnamespace
        join pg_class as ref on ref.oid = d.refobjid
        join pg_namespace as refn on refn.oid = ref.namespace
        where v.relkind = 'v'
          and d.deptype in ('n', 'a')
          and refn.nspname = 'core'
          and ref.relname in (
              'core_bus_route_stops',
              'core_bus_route_names',
              'core_bus_stop_names',
              'core_bus_route_variants',
              'core_bus_routes',
              'core_bus_stops'
          )
    loop
        raise exception
            'BLOCKED: view %.% depends on %.%. Repoint or drop the view first (e.g. tiles_bus_route_variants_v).',
            blocker.view_schema,
            blocker.view_name,
            blocker.ref_schema,
            blocker.ref_name;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Guard 3: no foreign keys from OUTSIDE legacy bus tables reference them
-- (internal FKs between core_bus_* tables are allowed; drop order handles them)
-- ---------------------------------------------------------------------------
do $$
declare
    legacy_tables text[] := array[
        'core_bus_route_stops',
        'core_bus_route_names',
        'core_bus_stop_names',
        'core_bus_route_variants',
        'core_bus_routes',
        'core_bus_stops'
    ];
    blocker record;
begin
    for blocker in
        select
            srcn.nspname as source_schema,
            src.relname as source_table,
            c.conname as constraint_name,
            tgtn.nspname as target_schema,
            tgt.relname as target_table
        from pg_constraint as c
        join pg_class as src on src.oid = c.conrelid
        join pg_namespace as srcn on srcn.oid = src.relnamespace
        join pg_class as tgt on tgt.oid = c.confrelid
        join pg_namespace as tgtn on tgtn.oid = tgt.relnamespace
        where c.contype = 'f'
          and tgtn.nspname = 'core'
          and tgt.relname = any (legacy_tables)
          and not (
              srcn.nspname = 'core'
              and src.relname = any (legacy_tables)
          )
    loop
        raise exception
            'BLOCKED: %.%.% references core.%. Drop or repoint FK before dropping legacy bus tables.',
            blocker.source_schema,
            blocker.source_table,
            blocker.constraint_name,
            blocker.target_table;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Guard 4: all six tables must exist (avoid silent no-op on wrong database)
-- ---------------------------------------------------------------------------
do $$
declare
    tbl text;
    legacy_tables text[] := array[
        'core_bus_route_stops',
        'core_bus_route_names',
        'core_bus_stop_names',
        'core_bus_route_variants',
        'core_bus_routes',
        'core_bus_stops'
    ];
begin
    foreach tbl in array legacy_tables
    loop
        if to_regclass('core.' || tbl) is null then
            raise exception
                'BLOCKED: expected table core.% to exist before controlled drop.',
                tbl;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Drop legacy tables (explicit order — NO CASCADE)
-- ---------------------------------------------------------------------------

drop table if exists core.core_bus_route_stops;
drop table if exists core.core_bus_route_names;
drop table if exists core.core_bus_stop_names;
drop table if exists core.core_bus_route_variants;
drop table if exists core.core_bus_routes;
drop table if exists core.core_bus_stops;

commit;

-- =============================================================================
-- Post-drop verification (run manually after approved execution)
-- =============================================================================
-- select to_regclass('core.core_bus_stops') as core_bus_stops_still_exists;
-- Expected: NULL
