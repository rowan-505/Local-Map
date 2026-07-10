-- =============================================================================
-- 132_search_failed_search_logs_quality.sql
-- Extend zero-result search telemetry for V2 quality management:
-- aggregation, filter context, coarse map area, and resolution workflow.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- New columns (reuse query / normalized_query / lang / types / result_count)
-- ---------------------------------------------------------------------------
alter table search.failed_search_logs
    add column if not exists first_seen_at timestamptz,
    add column if not exists last_seen_at timestamptz,
    add column if not exists occurrence_count integer not null default 1,
    add column if not exists category text,
    add column if not exists transport_type text,
    add column if not exists transport_mode text,
    add column if not exists entity_types_key text,
    add column if not exists area_context_key text not null default '',
    add column if not exists dedupe_key text,
    add column if not exists resolved_at timestamptz,
    add column if not exists resolution_type text,
    add column if not exists linked_alias_id bigint;

comment on column search.failed_search_logs.query is
    'Latest raw query text from the client (not every keystroke — completed searches only).';

comment on column search.failed_search_logs.area_context_key is
    'Coarse map context bucket (~11 km) from lat/lng rounded to one decimal; empty when no location supplied.';

comment on column search.failed_search_logs.dedupe_key is
    'Stable aggregation key for unresolved zero-result queries.';

comment on column search.failed_search_logs.entity_types_key is
    'Sorted comma-separated entity type filter signature; all when unfiltered.';

-- Backfill timing from legacy created_at.
update search.failed_search_logs
set
    first_seen_at = coalesce(first_seen_at, created_at),
    last_seen_at = coalesce(last_seen_at, created_at)
where first_seen_at is null
   or last_seen_at is null;

alter table search.failed_search_logs
    alter column first_seen_at set default now(),
    alter column first_seen_at set not null,
    alter column last_seen_at set default now(),
    alter column last_seen_at set not null;

-- Backfill entity type signature from legacy types[].
update search.failed_search_logs
set entity_types_key = coalesce(
    nullif(
        (
            select string_agg(value, ',' order by value)
            from unnest(coalesce(types, '{}'::text[])) as value
        ),
        ''
    ),
    'all'
)
where entity_types_key is null;

alter table search.failed_search_logs
    alter column entity_types_key set default 'all';

update search.failed_search_logs
set entity_types_key = 'all'
where entity_types_key is null;

alter table search.failed_search_logs
    alter column entity_types_key set not null;

-- Backfill coarse area bucket from legacy precise lat/lng (one decimal ~11 km).
update search.failed_search_logs
set area_context_key = coalesce(
    nullif(area_context_key, ''),
    case
        when lat is not null and lng is not null
            then round(lat::numeric, 1)::text || ',' || round(lng::numeric, 1)::text
        else ''
    end
)
where area_context_key is null
   or area_context_key = '';

-- Build dedupe keys for existing rows (treat legacy rows as category=all).
update search.failed_search_logs
set dedupe_key = lower(coalesce(nullif(btrim(normalized_query), ''), btrim(query)))
    || '|' || coalesce(lang, '')
    || '|' || coalesce(category, 'all')
    || '|' || coalesce(transport_type, 'all')
    || '|' || coalesce(transport_mode, 'all')
    || '|' || coalesce(entity_types_key, 'all')
    || '|' || coalesce(area_context_key, '')
where dedupe_key is null;

-- Merge duplicate unresolved rows before adding the partial unique index.
with grouped as (
    select
        dedupe_key,
        min(id) as keep_id,
        count(*)::integer as row_count,
        min(first_seen_at) as first_seen_at,
        max(last_seen_at) as last_seen_at,
        max(query) as latest_query
    from search.failed_search_logs
    where resolved_at is null
      and dedupe_key is not null
    group by dedupe_key
    having count(*) > 1
)
update search.failed_search_logs target
set
    occurrence_count = grouped.row_count,
    first_seen_at = grouped.first_seen_at,
    last_seen_at = grouped.last_seen_at,
    query = grouped.latest_query
from grouped
where target.id = grouped.keep_id;

with grouped as (
    select
        dedupe_key,
        min(id) as keep_id
    from search.failed_search_logs
    where resolved_at is null
      and dedupe_key is not null
    group by dedupe_key
    having count(*) > 1
)
delete from search.failed_search_logs target
using grouped
where target.dedupe_key = grouped.dedupe_key
  and target.id <> grouped.keep_id
  and target.resolved_at is null;

-- Resolution workflow constraints.
alter table search.failed_search_logs
    drop constraint if exists failed_search_logs_resolution_type_chk;

alter table search.failed_search_logs
    add constraint failed_search_logs_resolution_type_chk
        check (
            resolution_type is null
            or resolution_type in ('alias', 'data_fix', 'duplicate', 'ignored', 'other')
        );

alter table search.failed_search_logs
    drop constraint if exists failed_search_logs_linked_alias_fk;

alter table search.failed_search_logs
    add constraint failed_search_logs_linked_alias_fk
        foreign key (linked_alias_id)
        references search.search_aliases (id)
        on delete set null;

-- One open row per dedupe key; resolved rows are kept for history.
drop index if exists search.failed_search_logs_open_dedupe_key_uidx;

create unique index failed_search_logs_open_dedupe_key_uidx
    on search.failed_search_logs (dedupe_key)
    where resolved_at is null and dedupe_key is not null;

create index if not exists failed_search_logs_last_seen_at_idx
    on search.failed_search_logs (last_seen_at desc);

create index if not exists failed_search_logs_unresolved_last_seen_idx
    on search.failed_search_logs (last_seen_at desc)
    where resolved_at is null;

create index if not exists failed_search_logs_occurrence_count_idx
    on search.failed_search_logs (occurrence_count desc)
    where resolved_at is null;

commit;

-- =============================================================================
-- Rollback (manual):
--   begin;
--     drop index if exists search.failed_search_logs_occurrence_count_idx;
--     drop index if exists search.failed_search_logs_unresolved_last_seen_idx;
--     drop index if exists search.failed_search_logs_last_seen_at_idx;
--     drop index if exists search.failed_search_logs_open_dedupe_key_uidx;
--     alter table search.failed_search_logs drop constraint if exists failed_search_logs_linked_alias_fk;
--     alter table search.failed_search_logs drop constraint if exists failed_search_logs_resolution_type_chk;
--     alter table search.failed_search_logs
--       drop column if exists linked_alias_id,
--       drop column if exists resolution_type,
--       drop column if exists resolved_at,
--       drop column if exists dedupe_key,
--       drop column if exists area_context_key,
--       drop column if exists entity_types_key,
--       drop column if exists transport_mode,
--       drop column if exists transport_type,
--       drop column if exists category,
--       drop column if exists occurrence_count,
--       drop column if exists last_seen_at,
--       drop column if exists first_seen_at;
--   commit;
-- =============================================================================
