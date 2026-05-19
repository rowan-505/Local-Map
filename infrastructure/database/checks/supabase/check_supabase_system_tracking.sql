-- =============================================================================
-- Validation checks: Supabase system tracking
-- =============================================================================
--
-- Read-only script. SELECT queries only.
-- Expected naming convention: system.system_* tables.
--
-- Run after:
--   1. infrastructure/database/migrations/supabase/021_system_import_lineage_tracking.sql
--   2. infrastructure/database/migrations/supabase/022_upgrade_supabase_system_tracking.sql
--   3. infrastructure/database/seeds/supabase/001_seed_system_source_registry.sql
--
-- =============================================================================

-- 1. system schema exists
select
    '01_system_schema_exists' as check_name,
    exists (
        select 1
        from information_schema.schemata
        where schema_name = 'system'
    ) as passed;

-- 2. required system tables exist
with required_tables(table_name) as (
    values
        ('system_source_registry'),
        ('system_import_batches'),
        ('system_source_snapshots'),
        ('system_diff_runs'),
        ('system_diff_items'),
        ('system_review_logs'),
        ('system_conflict_queue'),
        ('system_review_tasks'),
        ('system_publish_batches'),
        ('system_publish_items')
)
select
    '02_required_system_tables_exist' as check_name,
    required_tables.table_name,
    (tables.table_name is not null) as exists
from required_tables
left join information_schema.tables as tables
    on tables.table_schema = 'system'
   and tables.table_name = required_tables.table_name
order by required_tables.table_name;

-- 3. required source codes exist
with required_sources(source_code) as (
    values
        ('osm_myanmar'),
        ('manual_dashboard'),
        ('gtfs_ybs'),
        ('government_data'),
        ('partner_data')
)
select
    '03_required_source_codes_exist' as check_name,
    required_sources.source_code,
    (registry.source_code is not null) as exists
from required_sources
left join system.system_source_registry as registry
    on registry.source_code = required_sources.source_code
order by required_sources.source_code;

-- 4. import batches connect to source registry (should return 0 rows)
select
    '04_orphan_import_batches' as check_name,
    batches.*
from system.system_import_batches as batches
left join system.system_source_registry as registry
    on registry.id = batches.source_registry_id
where registry.id is null;

-- 5. source snapshots connect to import batches and source registry (should return 0 rows)
select
    '05_orphan_source_snapshots' as check_name,
    snapshots.*
from system.system_source_snapshots as snapshots
left join system.system_source_registry as registry
    on registry.id = snapshots.source_registry_id
left join system.system_import_batches as batches
    on batches.id = snapshots.import_batch_id
where registry.id is null
   or (snapshots.import_batch_id is not null and batches.id is null);

-- 6. diff runs connect to source snapshots (should return 0 rows)
select
    '06_orphan_diff_runs' as check_name,
    diff_runs.*
from system.system_diff_runs as diff_runs
left join system.system_source_snapshots as current_snapshot
    on current_snapshot.id = diff_runs.current_snapshot_id
left join system.system_source_snapshots as previous_snapshot
    on previous_snapshot.id = diff_runs.previous_snapshot_id
where current_snapshot.id is null
   or (diff_runs.previous_snapshot_id is not null and previous_snapshot.id is null);

-- 7. diff items connect to diff runs (should return 0 rows)
select
    '07_orphan_diff_items' as check_name,
    diff_items.*
from system.system_diff_items as diff_items
left join system.system_diff_runs as diff_runs
    on diff_runs.id = diff_items.diff_run_id
where diff_runs.id is null;

-- 8. publish items connect to publish batches (should return 0 rows)
select
    '08_orphan_publish_items' as check_name,
    publish_items.*
from system.system_publish_items as publish_items
left join system.system_publish_batches as publish_batches
    on publish_batches.id = publish_items.publish_batch_id
where publish_batches.id is null;

-- 9. review logs have entity_family/action_type (should return 0 rows)
select
    '09_invalid_review_logs' as check_name,
    review_logs.*
from system.system_review_logs as review_logs
where nullif(btrim(review_logs.entity_family), '') is null
   or nullif(btrim(review_logs.action_type), '') is null;

-- 10. important indexes exist
with required_indexes(indexname) as (
    values
        ('system_import_batches_source_registry_id_idx'),
        ('system_source_snapshots_source_registry_id_idx'),
        ('system_source_snapshots_snapshot_version_idx'),
        ('system_diff_runs_previous_snapshot_id_idx'),
        ('system_diff_runs_current_snapshot_id_idx'),
        ('system_diff_items_diff_run_id_idx'),
        ('system_diff_items_entity_family_diff_type_idx'),
        ('system_diff_items_external_id_idx'),
        ('system_review_logs_entity_family_entity_id_idx'),
        ('system_publish_items_entity_family_entity_id_idx')
)
select
    '10_important_indexes_exist' as check_name,
    required_indexes.indexname,
    (indexes.indexname is not null) as exists
from required_indexes
left join pg_indexes as indexes
    on indexes.schemaname = 'system'
   and indexes.indexname = required_indexes.indexname
order by required_indexes.indexname;

-- 11. unique source_code exists
select
    '11_unique_source_code_exists' as check_name,
    exists (
        select 1
        from pg_constraint
        where conrelid = 'system.system_source_registry'::regclass
          and contype = 'u'
          and conname = 'system_source_registry_source_code_key'
    ) as passed;

-- 12. unique snapshot_version exists
select
    '12_unique_snapshot_version_exists' as check_name,
    exists (
        select 1
        from pg_constraint
        where conrelid = 'system.system_source_snapshots'::regclass
          and contype = 'u'
          and conname = 'system_source_snapshots_snapshot_version_key'
    ) as passed;

-- 13. count rows in each system table
select '13_row_count_system_source_registry' as check_name, count(*) as row_count from system.system_source_registry
union all select '13_row_count_system_import_batches', count(*) from system.system_import_batches
union all select '13_row_count_system_source_snapshots', count(*) from system.system_source_snapshots
union all select '13_row_count_system_diff_runs', count(*) from system.system_diff_runs
union all select '13_row_count_system_diff_items', count(*) from system.system_diff_items
union all select '13_row_count_system_review_logs', count(*) from system.system_review_logs
union all select '13_row_count_system_conflict_queue', count(*) from system.system_conflict_queue
union all select '13_row_count_system_review_tasks', count(*) from system.system_review_tasks
union all select '13_row_count_system_publish_batches', count(*) from system.system_publish_batches
union all select '13_row_count_system_publish_items', count(*) from system.system_publish_items
order by check_name;

-- 14. detect running import_batches older than 1 day
select
    '14_running_import_batches_older_than_1_day' as check_name,
    batches.*
from system.system_import_batches as batches
where batches.status = 'running'
  and batches.started_at < now() - interval '1 day'
order by batches.started_at;

-- 15. detect diff_runs with status running older than 1 day
select
    '15_running_diff_runs_older_than_1_day' as check_name,
    diff_runs.*
from system.system_diff_runs as diff_runs
where diff_runs.status = 'running'
  and diff_runs.started_at < now() - interval '1 day'
order by diff_runs.started_at;

-- 16. detect source_snapshots with duplicate snapshot_version (should return 0 rows)
select
    '16_duplicate_snapshot_versions' as check_name,
    snapshot_version,
    count(*) as duplicate_count
from system.system_source_snapshots
where snapshot_version is not null
group by snapshot_version
having count(*) > 1
order by duplicate_count desc, snapshot_version;

-- 17. detect null source codes or snapshot versions
select
    '17_null_or_blank_source_codes' as check_name,
    id,
    source_code
from system.system_source_registry
where nullif(btrim(source_code), '') is null;

select
    '17_null_or_blank_snapshot_versions' as check_name,
    id,
    source_registry_id,
    snapshot_ref,
    snapshot_version
from system.system_source_snapshots
where nullif(btrim(snapshot_version), '') is null;
