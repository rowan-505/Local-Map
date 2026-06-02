-- =============================================================================
-- Read-only inspection: migration 084 blocker on building_candidates
-- Target file: tools/import-review/inspect-084-building-review-overrides-blocker.sql
-- Supabase SQL Editor compatible
-- =============================================================================
--
-- Purpose:
-- Diagnose why 084 stops on:
--   import_review.building_candidates.review_overrides non-empty rows
--
-- Rules:
-- - READ ONLY (no INSERT/UPDATE/DELETE/ALTER/DROP)
-- - Safe existence guards for optional columns/tables
--
-- =============================================================================

-- 0) Context / existence checks
with cte as (
    select
        to_regclass('import_review.building_candidates') is not null as has_building_candidates,
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides'
        ) as has_review_overrides_col,
        exists (
            select 1
            from information_schema.columns
            where table_schema = 'import_review'
              and table_name = 'building_candidates'
              and column_name = 'review_overrides_archive'
        ) as has_review_overrides_archive_col,
        to_regclass('import_review.review_overrides_archive') is not null as has_central_archive_table
)
select *
from cte;

-- 1) Count of non-empty review_overrides in building_candidates
select count(*)::bigint as non_empty_review_overrides_count
from import_review.building_candidates b
where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

-- 2) Count where per-row review_overrides_archive column exists and is non-empty
do $$
declare
    has_archive_col boolean;
begin
    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides_archive'
    )
    into has_archive_col;

    if has_archive_col then
        raise notice '2) review_overrides_archive column exists; run next SELECT result set.';
    else
        raise notice '2) review_overrides_archive column does not exist on import_review.building_candidates.';
    end if;
end $$;

select count(*)::bigint as non_empty_review_overrides_archive_column_count
from import_review.building_candidates b
where exists (
    select 1
    from information_schema.columns
    where table_schema = 'import_review'
      and table_name = 'building_candidates'
      and column_name = 'review_overrides_archive'
)
  and coalesce(b.review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb;

-- 3) Central archive table existence + matching count
with cte as (
    select to_regclass('import_review.review_overrides_archive') is not null as has_central_archive_table
)
select *
from cte;

do $$
declare
    has_central_archive boolean;
    central_count bigint;
begin
    select to_regclass('import_review.review_overrides_archive') is not null
    into has_central_archive;

    if has_central_archive then
        execute $sql$
            select count(*)::bigint
            from import_review.review_overrides_archive
            where candidate_table = 'building_candidates'
        $sql$
        into central_count;

        raise notice '3) central archive table exists; building_candidates rows=%', central_count;
    else
        raise notice '3) central archive table import_review.review_overrides_archive does not exist.';
    end if;
end $$;

-- 4) Top review_overrides keys by frequency
select
    k.key as override_key,
    count(*)::bigint as row_count
from import_review.building_candidates b
cross join lateral jsonb_object_keys(coalesce(b.review_overrides, '{}'::jsonb)) as k(key)
group by k.key
order by row_count desc, override_key asc
limit 100;

-- 5) Sample 50 rows with requested columns (guarding optional cols)
with col_flags as (
    select
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='review_batch_id'
        ) as has_review_batch_id,
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='promotion_status'
        ) as has_promotion_status,
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='review_status'
        ) as has_review_status,
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='name_mm'
        ) as has_name_mm,
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='name_en'
        ) as has_name_en,
        exists (
            select 1 from information_schema.columns
            where table_schema='import_review' and table_name='building_candidates' and column_name='review_overrides_archive'
        ) as has_review_overrides_archive
)
select
    b.id,
    case when f.has_review_batch_id then b.review_batch_id::text else null end as review_batch_id,
    case when f.has_promotion_status then b.promotion_status else null end as promotion_status,
    case when f.has_review_status then b.review_status else null end as review_status,
    b.name,
    case when f.has_name_mm then b.name_mm else null end as name_mm,
    case when f.has_name_en then b.name_en else null end as name_en,
    b.building_type_id,
    b.levels,
    b.height_m,
    b.confidence_score,
    b.review_overrides,
    case when f.has_review_overrides_archive then b.review_overrides_archive else null end as review_overrides_archive
from import_review.building_candidates b
cross join col_flags f
where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
order by b.id desc
limit 50;

-- 6) Mapped field comparison snapshot (typed value vs override value)
select
    b.id,
    b.name as typed_name,
    nullif(trim(coalesce(b.review_overrides->>'name', '')), '') as ov_name,
    b.name_mm as typed_name_mm,
    nullif(trim(coalesce(b.review_overrides->>'name_mm', '')), '') as ov_name_mm,
    b.name_en as typed_name_en,
    nullif(trim(coalesce(b.review_overrides->>'name_en', '')), '') as ov_name_en,
    b.building_type_id as typed_building_type_id,
    case
        when (b.review_overrides->>'building_type_id') ~ '^[0-9]+$'
            then (b.review_overrides->>'building_type_id')::bigint
        else null::bigint
    end as ov_building_type_id,
    b.levels as typed_levels,
    case
        when (b.review_overrides->>'levels') ~ '^-?[0-9]+$'
            then (b.review_overrides->>'levels')::integer
        else null::integer
    end as ov_levels,
    b.height_m as typed_height_m,
    case
        when (b.review_overrides->>'height_m') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (b.review_overrides->>'height_m')::numeric
        else null::numeric
    end as ov_height_m,
    b.confidence_score as typed_confidence_score,
    case
        when (b.review_overrides->>'confidence_score') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (b.review_overrides->>'confidence_score')::numeric
        else null::numeric
    end as ov_confidence_score
from import_review.building_candidates b
where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
order by b.id desc
limit 200;

-- 7) Count rows where typed columns already equal override values
select
    count(*)::bigint as inspected_rows,
    count(*) filter (
        where nullif(trim(coalesce(b.review_overrides->>'name', '')), '') is not null
          and b.name is not distinct from nullif(trim(coalesce(b.review_overrides->>'name', '')), '')
    )::bigint as name_matches_override_count,
    count(*) filter (
        where nullif(trim(coalesce(b.review_overrides->>'name_mm', '')), '') is not null
          and b.name_mm is not distinct from nullif(trim(coalesce(b.review_overrides->>'name_mm', '')), '')
    )::bigint as name_mm_matches_override_count,
    count(*) filter (
        where nullif(trim(coalesce(b.review_overrides->>'name_en', '')), '') is not null
          and b.name_en is not distinct from nullif(trim(coalesce(b.review_overrides->>'name_en', '')), '')
    )::bigint as name_en_matches_override_count,
    count(*) filter (
        where (b.review_overrides->>'building_type_id') ~ '^[0-9]+$'
          and b.building_type_id is not distinct from (b.review_overrides->>'building_type_id')::bigint
    )::bigint as building_type_id_matches_override_count,
    count(*) filter (
        where (b.review_overrides->>'levels') ~ '^-?[0-9]+$'
          and b.levels is not distinct from (b.review_overrides->>'levels')::integer
    )::bigint as levels_matches_override_count,
    count(*) filter (
        where (b.review_overrides->>'height_m') ~ '^-?[0-9]+(\.[0-9]+)?$'
          and b.height_m is not distinct from (b.review_overrides->>'height_m')::numeric
    )::bigint as height_m_matches_override_count,
    count(*) filter (
        where (b.review_overrides->>'confidence_score') ~ '^-?[0-9]+(\.[0-9]+)?$'
          and b.confidence_score is not distinct from (b.review_overrides->>'confidence_score')::numeric
    )::bigint as confidence_score_matches_override_count
from import_review.building_candidates b
where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

-- 8) Count invalid building_type_id overrides (numeric but missing in ref.ref_building_types)
select count(*)::bigint as invalid_building_type_id_override_count
from import_review.building_candidates b
where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
  and (b.review_overrides->>'building_type_id') ~ '^[0-9]+$'
  and not exists (
      select 1
      from ref.ref_building_types bt
      where bt.id = (b.review_overrides->>'building_type_id')::bigint
  );

-- 9) Count rows where override contains geometry key
select count(*)::bigint as override_contains_geom_key_count
from import_review.building_candidates b
where coalesce(b.review_overrides, '{}'::jsonb) ? 'geom';

