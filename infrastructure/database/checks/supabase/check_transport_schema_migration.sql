-- =============================================================================
-- Validation checks: transport schema migration (066–071)
-- =============================================================================
--
-- Read-only script. SELECT queries only — does not change schema or data.
--
-- Run after applying (in order):
--   066_create_import_transport_schema.sql
--   067_create_core_transport_schema.sql
--   068_create_gtfs_export_schema.sql
--   069_core_transport_validation_views.sql
--   070_tiles_bus_views_core_transport.sql
--   071_deprecate_core_bus_tables_comments.sql
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New schemas exist
-- Expected: one row per schema; exists = true for all three.
-- -----------------------------------------------------------------------------
select
    '01_transport_schemas_exist' as check_name,
    s.schema_name,
    (sch.schema_name is not null) as exists
from (
    values
        ('import_transport'),
        ('core_transport'),
        ('gtfs_export')
) as s (schema_name)
left join information_schema.schemata as sch
    on sch.schema_name = s.schema_name
order by s.schema_name;

-- -----------------------------------------------------------------------------
-- 2. Required core_transport tables exist
-- Expected: exists = true for every table_name (14 tables).
-- -----------------------------------------------------------------------------
with required_tables (table_name) as (
    values
        ('operators'),
        ('routes'),
        ('route_names'),
        ('route_variants'),
        ('stops'),
        ('stop_names'),
        ('route_stops'),
        ('route_paths'),
        ('terminals'),
        ('service_calendars'),
        ('frequencies'),
        ('fares'),
        ('route_sources'),
        ('route_versions')
)
select
    '02_core_transport_tables_exist' as check_name,
    required_tables.table_name,
    (t.table_name is not null) as exists
from required_tables
left join information_schema.tables as t
    on t.table_schema = 'core_transport'
   and t.table_name = required_tables.table_name
order by required_tables.table_name;

-- -----------------------------------------------------------------------------
-- 3. Required import_transport tables exist
-- Expected: exists = true for every table_name (14 tables).
-- -----------------------------------------------------------------------------
with required_tables (table_name) as (
    values
        ('source_datasets'),
        ('import_batches'),
        ('raw_operators'),
        ('raw_routes'),
        ('raw_route_variants'),
        ('raw_stops'),
        ('raw_route_stops'),
        ('raw_route_paths'),
        ('raw_terminals'),
        ('raw_fares'),
        ('raw_service_notes'),
        ('validation_issues'),
        ('promotion_batches'),
        ('promotion_items')
)
select
    '03_import_transport_tables_exist' as check_name,
    required_tables.table_name,
    (t.table_name is not null) as exists
from required_tables
left join information_schema.tables as t
    on t.table_schema = 'import_transport'
   and t.table_name = required_tables.table_name
order by required_tables.table_name;

-- -----------------------------------------------------------------------------
-- 4. Required gtfs_export tables exist
-- Expected: exists = true for all three tables.
-- -----------------------------------------------------------------------------
with required_tables (table_name) as (
    values
        ('export_builds'),
        ('export_files'),
        ('validation_issues')
)
select
    '04_gtfs_export_tables_exist' as check_name,
    required_tables.table_name,
    (t.table_name is not null) as exists
from required_tables
left join information_schema.tables as t
    on t.table_schema = 'gtfs_export'
   and t.table_name = required_tables.table_name
order by required_tables.table_name;

-- -----------------------------------------------------------------------------
-- 5. Bus tile views exist
-- Expected: exists = true for both views; view_type = 'VIEW'.
-- -----------------------------------------------------------------------------
select
    '05_bus_tile_views_exist' as check_name,
    v.table_name as view_name,
    (t.table_name is not null) as exists,
    t.table_type
from (
    values
        ('tiles_bus_routes_v'),
        ('tiles_bus_stops_v')
) as v (table_name)
left join information_schema.tables as t
    on t.table_schema = 'tiles'
   and t.table_name = v.table_name
order by v.table_name;

-- -----------------------------------------------------------------------------
-- 6. pg_depend: tile views must NOT reference legacy core.core_bus_* tables
-- Expected: 0 rows (any row = FAIL — view still depends on deprecated tables).
-- -----------------------------------------------------------------------------
select
    '06_tile_views_must_not_depend_on_core_bus' as check_name,
    vn.nspname as view_schema,
    v.relname as view_name,
    refn.nspname as ref_schema,
    ref.relname as ref_name
from pg_depend as d
join pg_class as v on v.oid = d.objid
join pg_namespace as vn on vn.oid = v.relnamespace
join pg_class as ref on ref.oid = d.refobjid
join pg_namespace as refn on refn.oid = ref.relnamespace
where vn.nspname = 'tiles'
  and v.relname in ('tiles_bus_stops_v', 'tiles_bus_routes_v')
  and v.relkind = 'v'
  and d.deptype in ('n', 'a')
  and refn.nspname = 'core'
  and ref.relname in (
      'core_bus_routes',
      'core_bus_route_variants',
      'core_bus_route_names',
      'core_bus_stops',
      'core_bus_stop_names'
  )
order by view_name, ref_name;

-- -----------------------------------------------------------------------------
-- 6b. pg_depend: tile views SHOULD reference core_transport (sanity check)
-- Expected: at least one row per view listing core_transport base tables.
-- -----------------------------------------------------------------------------
select
    '06b_tile_views_depend_on_core_transport' as check_name,
    v.relname as view_name,
    refn.nspname as ref_schema,
    ref.relname as ref_name
from pg_depend as d
join pg_class as v on v.oid = d.objid
join pg_namespace as vn on vn.oid = v.relnamespace
join pg_class as ref on ref.oid = d.refobjid
join pg_namespace as refn on refn.oid = ref.relnamespace
where vn.nspname = 'tiles'
  and v.relname in ('tiles_bus_stops_v', 'tiles_bus_routes_v')
  and v.relkind = 'v'
  and d.deptype in ('n', 'a')
  and refn.nspname = 'core_transport'
  and ref.relkind in ('r', 'v')
order by view_name, ref_name;

-- -----------------------------------------------------------------------------
-- 7. Legacy core bus table row counts (rollback baseline)
-- Expected: query succeeds; row_count >= 0 (often 0 until legacy data migrated).
-- -----------------------------------------------------------------------------
select '07_legacy_core_bus_row_counts' as check_name, 'core.core_bus_routes' as table_name, count(*)::bigint as row_count
from core.core_bus_routes
union all
select '07_legacy_core_bus_row_counts', 'core.core_bus_route_variants', count(*)::bigint
from core.core_bus_route_variants
union all
select '07_legacy_core_bus_row_counts', 'core.core_bus_route_stops', count(*)::bigint
from core.core_bus_route_stops
union all
select '07_legacy_core_bus_row_counts', 'core.core_bus_stops', count(*)::bigint
from core.core_bus_stops
union all
select '07_legacy_core_bus_row_counts', 'core.core_bus_route_names', count(*)::bigint
from core.core_bus_route_names
union all
select '07_legacy_core_bus_row_counts', 'core.core_bus_stop_names', count(*)::bigint
from core.core_bus_stop_names
order by table_name;

-- -----------------------------------------------------------------------------
-- 7b. Deprecated table comments present (071)
-- Expected: description contains 'Deprecated' for all six tables.
-- -----------------------------------------------------------------------------
select
    '07b_legacy_bus_tables_deprecated_comment' as check_name,
    c.relname as table_name,
    coalesce(d.description, '') as table_comment,
    (coalesce(d.description, '') like '%Deprecated%') as has_deprecated_comment
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
left join pg_description as d
    on d.objoid = c.oid
   and d.objsubid = 0
where n.nspname = 'core'
  and c.relname in (
      'core_bus_routes',
      'core_bus_route_variants',
      'core_bus_route_stops',
      'core_bus_stops',
      'core_bus_route_names',
      'core_bus_stop_names'
  )
order by c.relname;

-- -----------------------------------------------------------------------------
-- 8. Validation views are queryable (069)
-- Expected: each query completes; row_count >= 0 (summary returns exactly 1 row).
-- -----------------------------------------------------------------------------
select '08_validation_v_route_variants_with_too_few_stops' as check_name, count(*)::bigint as row_count
from core_transport.v_route_variants_with_too_few_stops;

select '08_validation_v_duplicate_route_stop_sequences' as check_name, count(*)::bigint as row_count
from core_transport.v_duplicate_route_stop_sequences;

select '08_validation_v_stops_without_names' as check_name, count(*)::bigint as row_count
from core_transport.v_stops_without_names;

select '08_validation_v_variants_without_frequency' as check_name, count(*)::bigint as row_count
from core_transport.v_variants_without_frequency;

select '08_validation_v_routes_without_variants' as check_name, count(*)::bigint as row_count
from core_transport.v_routes_without_variants;

select '08_validation_v_route_stops_missing_timing' as check_name, count(*)::bigint as row_count
from core_transport.v_route_stops_missing_timing;

select '08_validation_v_route_paths_missing' as check_name, count(*)::bigint as row_count
from core_transport.v_route_paths_missing;

select '08_validation_v_gtfs_readiness_summary' as check_name, count(*)::bigint as row_count
from core_transport.v_gtfs_readiness_summary;

-- -----------------------------------------------------------------------------
-- 9. GIST geometry indexes exist
-- Expected: has_gist_geom_index = true for every listed table.
-- -----------------------------------------------------------------------------
with required_gist_tables (schema_name, table_name) as (
    values
        ('core_transport', 'stops'),
        ('core_transport', 'route_variants'),
        ('core_transport', 'route_paths'),
        ('import_transport', 'raw_stops'),
        ('import_transport', 'raw_route_variants')
)
select
    '09_gist_geom_indexes_exist' as check_name,
    r.schema_name,
    r.table_name,
    exists (
        select 1
        from pg_indexes as idx
        where idx.schemaname = r.schema_name
          and idx.tablename = r.table_name
          and idx.indexdef ilike '%using gist%'
          and idx.indexdef ilike '%geom%'
    ) as has_gist_geom_index
from required_gist_tables as r
order by r.schema_name, r.table_name;

-- -----------------------------------------------------------------------------
-- 10. confidence_score check constraints enforce 0–100 range
-- Expected: uses_0_100_range = true for every listed constraint (or no column).
-- -----------------------------------------------------------------------------
with confidence_columns as (
    select
        n.nspname as schema_name,
        c.relname as table_name,
        a.attname as column_name,
        con.conname as constraint_name,
        pg_get_constraintdef(con.oid, true) as constraint_def
    from pg_constraint as con
    join pg_class as c on c.oid = con.conrelid
    join pg_namespace as n on n.oid = c.relnamespace
    join pg_attribute as a
        on a.attrelid = c.oid
       and a.attnum = any (con.conkey)
       and a.attnum > 0
       and not a.attisdropped
    where con.contype = 'c'
      and a.attname = 'confidence_score'
      and n.nspname in ('import_transport', 'core_transport')
)
select
    '10_confidence_score_0_100_constraints' as check_name,
    schema_name,
    table_name,
    constraint_name,
    constraint_def,
    (
        constraint_def ilike '%confidence_score%'
        and constraint_def ilike '%<= 100%'
        and constraint_def ilike '%>= 0%'
    ) as uses_0_100_range
from confidence_columns
order by schema_name, table_name, constraint_name;

-- -----------------------------------------------------------------------------
-- 10b. Fail if any confidence constraint does not cap at 100
-- Expected: 0 rows.
-- -----------------------------------------------------------------------------
select
    '10b_confidence_constraints_missing_0_100' as check_name,
    schema_name,
    table_name,
    constraint_name,
    constraint_def
from (
    select
        n.nspname as schema_name,
        c.relname as table_name,
        con.conname as constraint_name,
        pg_get_constraintdef(con.oid, true) as constraint_def
    from pg_constraint as con
    join pg_class as c on c.oid = con.conrelid
    join pg_namespace as n on n.oid = c.relnamespace
    join pg_attribute as a
        on a.attrelid = c.oid
       and a.attnum = any (con.conkey)
       and a.attnum > 0
       and not a.attisdropped
    where con.contype = 'c'
      and a.attname = 'confidence_score'
      and n.nspname in ('import_transport', 'core_transport')
) as defs
where not (
    constraint_def ilike '%<= 100%'
    and constraint_def ilike '%>= 0%'
);

-- -----------------------------------------------------------------------------
-- Optional: tile view column types (070 geometry typing)
-- Expected: tiles_bus_routes_v.geom = geometry(LineString,4326);
--           tiles_bus_stops_v.geom = geometry(Point,4326).
-- -----------------------------------------------------------------------------
select
    'optional_tile_view_geom_types' as check_name,
    c.table_name as view_name,
    c.column_name,
    c.udt_name,
    c.data_type
from information_schema.columns as c
where c.table_schema = 'tiles'
  and c.table_name in ('tiles_bus_routes_v', 'tiles_bus_stops_v')
  and c.column_name = 'geom'
order by c.table_name;
