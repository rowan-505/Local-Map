-- =============================================================================
-- Supabase migration 097: standardize Myanmar language_code mm -> my
-- =============================================================================
--
-- ISO 639-1 Myanmar/Burmese is `my`. Legacy rows used `mm` in some tables.
-- This migration updates persisted rows and tightens CHECK constraints.
--
-- Notes:
--   - Not all *_names tables have updated_at (e.g. core_street_names).
--   - Helper below sets updated_at only when the column exists.
--   - Does not add created_at/updated_at columns.
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helper: mm -> my on one names table (skip missing tables)
-- ---------------------------------------------------------------------------
create or replace function core._migrate_myanmar_language_code_mm_to_my(
    p_schema text,
    p_table text
)
returns bigint
language plpgsql
as $$
declare
    v_regclass regclass;
    v_has_updated_at boolean;
    v_sql text;
    v_updated bigint;
begin
    v_regclass := to_regclass(format('%I.%I', p_schema, p_table));
    if v_regclass is null then
        raise notice '097 skip: %.% does not exist', p_schema, p_table;
        return 0;
    end if;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = p_schema
          and table_name = p_table
          and column_name = 'updated_at'
    )
    into v_has_updated_at;

    if v_has_updated_at then
        v_sql := format(
            'update %I.%I
             set language_code = %L, updated_at = now()
             where lower(trim(coalesce(language_code, %L))) = %L',
            p_schema,
            p_table,
            'my',
            '',
            'mm'
        );
    else
        v_sql := format(
            'update %I.%I
             set language_code = %L
             where lower(trim(coalesce(language_code, %L))) = %L',
            p_schema,
            p_table,
            'my',
            '',
            'mm'
        );
    end if;

    execute v_sql;
    get diagnostics v_updated = row_count;

    raise notice '097 updated % rows in %.%; updated_at=%',
        v_updated, p_schema, p_table, v_has_updated_at;

    return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Data: convert legacy mm rows to my across core / core_transport *_names
-- ---------------------------------------------------------------------------
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_street_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_place_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_admin_area_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_map_building_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_map_landuse_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_map_water_line_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_map_water_polygon_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_bus_route_names');
select core._migrate_myanmar_language_code_mm_to_my('core', 'core_bus_stop_names');
select core._migrate_myanmar_language_code_mm_to_my('core_transport', 'route_names');
select core._migrate_myanmar_language_code_mm_to_my('core_transport', 'stop_names');

drop function core._migrate_myanmar_language_code_mm_to_my(text, text);

-- ---------------------------------------------------------------------------
-- Constraints: allow my, not mm (tables that still permit mm in CHECK)
-- ---------------------------------------------------------------------------
alter table core.core_map_building_names
    drop constraint if exists core_map_building_names_language_code_chk;

alter table core.core_map_building_names
    add constraint core_map_building_names_language_code_chk
        check (language_code in ('my', 'en', 'und'));

alter table core.core_map_water_line_names
    drop constraint if exists core_map_water_line_names_language_code_chk;

alter table core.core_map_water_line_names
    add constraint core_map_water_line_names_language_code_chk
        check (language_code in ('my', 'en', 'und'));

alter table core.core_map_water_polygon_names
    drop constraint if exists core_map_water_polygon_names_language_code_chk;

alter table core.core_map_water_polygon_names
    add constraint core_map_water_polygon_names_language_code_chk
        check (language_code in ('my', 'en', 'und'));

do $$
begin
    if to_regclass('core_transport.route_names') is not null then
        alter table core_transport.route_names
            drop constraint if exists route_names_language_code_chk;

        alter table core_transport.route_names
            add constraint route_names_language_code_chk
                check (language_code in ('my', 'en', 'und'));
    end if;

    if to_regclass('core_transport.stop_names') is not null then
        alter table core_transport.stop_names
            drop constraint if exists stop_names_language_code_chk;

        alter table core_transport.stop_names
            add constraint stop_names_language_code_chk
                check (language_code in ('my', 'en', 'und'));
    end if;
end $$;

commit;
