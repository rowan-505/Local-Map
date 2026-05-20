-- =============================================================================
-- Supabase migration 026: core verification columns for import-review promotion
-- =============================================================================
--
-- Purpose:
--   Add consistent verification metadata to core tables that receive data
--   promoted from import_review. Supports dashboard filtering and future
--   post-promotion verification workflows without changing promotion logic.
--
-- Safety:
--   - Non-destructive: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--   - Does NOT modify import_review.* tables.
--   - Does NOT drop or rewrite existing rows (backfill syncs verification_status
--     from existing is_verified only).
--   - Skips tables that do not exist in the target database.
--   - Child/name tables (place_names, street_names, etc.) are intentionally excluded.
--
-- Apply: Supabase SQL Editor (paste full file). Do not run from CI without review.
--
-- =============================================================================

do $$
declare
    cfg record;
    full_name text;
    constraint_name text;
begin
    for cfg in
        select *
        from (values
            ('core_addresses', true),
            ('core_map_buildings', true),
            ('core_places', true),
            ('core_streets', true),
            ('core_admin_areas', true),
            ('core_bus_stops', true),
            ('core_bus_routes', true),
            ('core_bus_route_variants', false),
            ('core_bus_route_stops', false),
            ('core_map_landuse', true),
            ('core_map_water_lines', true),
            ('core_map_water_polygons', true)
        ) as v(table_name, has_updated_at)
    loop
        full_name := 'core.' || cfg.table_name;
        constraint_name := cfg.table_name || '_verification_status_chk';

        if to_regclass(full_name) is null then
            raise notice 'Skipping % — table does not exist', full_name;
            continue;
        end if;

        -- ---------------------------------------------------------------------
        -- Columns (idempotent)
        -- ---------------------------------------------------------------------
        execute format(
            'alter table core.%I
                add column if not exists is_verified boolean not null default false,
                add column if not exists verification_status text not null default ''unverified'',
                add column if not exists verified_at timestamptz null,
                add column if not exists verified_by bigint null,
                add column if not exists verification_note text null',
            cfg.table_name
        );

        -- Sync verification_status from legacy is_verified flag (no verified_at backfill).
        execute format(
            'update core.%I
             set verification_status = ''verified''
             where is_verified = true
               and verification_status = ''unverified''',
            cfg.table_name
        );

        -- ---------------------------------------------------------------------
        -- Check constraint (idempotent)
        -- ---------------------------------------------------------------------
        if not exists (
            select 1
            from pg_constraint
            where conname = constraint_name
              and conrelid = full_name::regclass
        ) then
            execute format(
                'alter table core.%I
                    add constraint %I check (
                        verification_status in (
                            ''unverified'',
                            ''verified'',
                            ''needs_fix'',
                            ''questionable'',
                            ''rejected_after_core_review''
                        )
                    )',
                cfg.table_name,
                constraint_name
            );
        end if;

        -- ---------------------------------------------------------------------
        -- Column comments
        -- ---------------------------------------------------------------------
        execute format(
            'comment on column core.%I.is_verified is
                ''True when a reviewer has confirmed this core row is accurate.''',
            cfg.table_name
        );
        execute format(
            'comment on column core.%I.verification_status is
                ''Review lifecycle: unverified, verified, needs_fix, questionable, rejected_after_core_review.''',
            cfg.table_name
        );
        execute format(
            'comment on column core.%I.verified_at is
                ''Timestamp when verification_status last became verified (set by reviewers, not import).''',
            cfg.table_name
        );
        execute format(
            'comment on column core.%I.verified_by is
                ''Reviewer user id when verification was recorded (dashboard/API actor).''',
            cfg.table_name
        );
        execute format(
            'comment on column core.%I.verification_note is
                ''Optional reviewer note explaining verification outcome or follow-up.''',
            cfg.table_name
        );

        -- ---------------------------------------------------------------------
        -- Indexes for dashboard filtering (idempotent)
        -- ---------------------------------------------------------------------
        execute format(
            'create index if not exists %I on core.%I (is_verified)',
            cfg.table_name || '_is_verified_idx',
            cfg.table_name
        );
        execute format(
            'create index if not exists %I on core.%I (verification_status)',
            cfg.table_name || '_verification_status_idx',
            cfg.table_name
        );

        if cfg.has_updated_at then
            execute format(
                'create index if not exists %I on core.%I (is_verified, updated_at desc)',
                cfg.table_name || '_is_verified_updated_at_idx',
                cfg.table_name
            );
        end if;

        raise notice 'Applied verification columns to %', full_name;
    end loop;
end $$;

-- =============================================================================
-- Manual verification query (run in Supabase SQL Editor after migration)
-- =============================================================================
--
-- Inspect verification columns on all promotion-target core tables:
--
-- select
--     n.nspname as schema_name,
--     c.relname as table_name,
--     a.attname as column_name,
--     pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
--     a.attnotnull as not_null,
--     pg_get_expr(ad.adbin, ad.adrelid) as column_default
-- from pg_catalog.pg_class c
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- join pg_catalog.pg_attribute a on a.attrelid = c.oid
-- left join pg_catalog.pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
-- where n.nspname = 'core'
--   and c.relname in (
--       'core_addresses',
--       'core_map_buildings',
--       'core_places',
--       'core_streets',
--       'core_admin_areas',
--       'core_bus_stops',
--       'core_bus_routes',
--       'core_bus_route_variants',
--       'core_bus_route_stops',
--       'core_map_landuse',
--       'core_map_water_lines',
--       'core_map_water_polygons'
--   )
--   and a.attname in (
--       'is_verified',
--       'verification_status',
--       'verified_at',
--       'verified_by',
--       'verification_note'
--   )
--   and a.attnum > 0
--   and not a.attisdropped
-- order by c.relname, a.attname;
--
-- Row counts by verification state (example for one table):
--
-- select
--     verification_status,
--     is_verified,
--     count(*) as row_count
-- from core.core_places
-- group by verification_status, is_verified
-- order by verification_status, is_verified;
--
-- Check constraints present:
--
-- select
--     c.relname as table_name,
--     con.conname as constraint_name,
--     pg_get_constraintdef(con.oid) as constraint_def
-- from pg_catalog.pg_constraint con
-- join pg_catalog.pg_class c on c.oid = con.conrelid
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'core'
--   and con.conname like '%\_verification_status\_chk' escape '\'
-- order by c.relname;
