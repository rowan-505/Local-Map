-- =============================================================================
-- Repeatable seed: system source registry
-- =============================================================================
--
-- Targets:
--   - Local database
--   - Supabase database
--
-- Current naming convention in both environments:
--   system.system_source_registry
--
-- Safe to run multiple times.
--
-- This script standardizes stable source registry records used for long-term
-- lineage, imports, snapshots, diffs, reviews, and publishing.
--
-- It intentionally does NOT delete or modify unrelated legacy/demo rows such as:
--   - osm_myanmar_core_demo
--   - geofabrik_myanmar_osm_pbf
--
-- If old/demo source rows exist, review them manually and decide whether they
-- should stay as historical lineage records, be marked inactive, or be mapped in
-- documentation. Do not delete them automatically.
--
-- Optional manual review query:
--
-- select id, source_code, source_name, is_active, config, created_at, updated_at
-- from system.system_source_registry
-- where source_code in ('osm_myanmar_core_demo', 'geofabrik_myanmar_osm_pbf')
--    or source_code like '%demo%'
-- order by id;
--
-- =============================================================================

-- Ensure source type lookup rows exist first.
insert into ref.ref_source_types (code, name)
values
    ('osm', 'OpenStreetMap'),
    ('manual', 'Manual'),
    ('gtfs', 'GTFS'),
    ('government', 'Government'),
    ('partner', 'Partner')
on conflict (code) do update
set
    name = excluded.name;

-- Standardize stable source registry rows.
insert into system.system_source_registry (
    source_code,
    source_name,
    source_type_id,
    source_uri,
    is_active,
    config
)
select
    seed.source_code,
    seed.source_name,
    source_types.id as source_type_id,
    seed.source_uri,
    true as is_active,
    seed.config
from (
    values
        (
            'osm_myanmar',
            'OpenStreetMap Myanmar Extract',
            'osm',
            'https://download.geofabrik.de/asia/myanmar-latest.osm.pbf',
            '{"provider":"geofabrik","dataset":"myanmar","format":"osm_pbf"}'::jsonb
        ),
        (
            'manual_dashboard',
            'Manual Dashboard Edits',
            'manual',
            null::text,
            '{"channel":"dashboard","description":"Human edits from admin dashboard"}'::jsonb
        ),
        (
            'gtfs_ybs',
            'Yangon Bus GTFS / Transit Source',
            'gtfs',
            null::text,
            '{"operator":"ybs","region":"yangon","format":"gtfs"}'::jsonb
        ),
        (
            'government_data',
            'Government / Official Data',
            'government',
            null::text,
            '{"description":"Official government or municipal datasets"}'::jsonb
        ),
        (
            'partner_data',
            'Partner Data Source',
            'partner',
            null::text,
            '{"description":"Datasets supplied by trusted partners"}'::jsonb
        )
) as seed (source_code, source_name, source_type_code, source_uri, config)
join ref.ref_source_types as source_types
    on source_types.code = seed.source_type_code
on conflict (source_code) do update
set
    source_name = excluded.source_name,
    source_type_id = excluded.source_type_id,
    source_uri = excluded.source_uri,
    is_active = true,
    config = excluded.config,
    updated_at = now();

-- Verification query:
--
-- select
--     registry.source_code,
--     registry.source_name,
--     source_types.code as source_type_code,
--     registry.source_uri,
--     registry.is_active,
--     registry.config
-- from system.system_source_registry as registry
-- left join ref.ref_source_types as source_types
--     on source_types.id = registry.source_type_id
-- where registry.source_code in (
--     'osm_myanmar',
--     'manual_dashboard',
--     'gtfs_ybs',
--     'government_data',
--     'partner_data'
-- )
-- order by registry.source_code;
