-- =============================================================================
-- Supabase migration 083b: clear legacy review_overrides on building_candidates
-- =============================================================================
--
-- Purpose:
--   Unblock 084 by clearing remaining non-empty JSON overrides on
--   import_review.building_candidates after Phases 0-8.
--
-- Scope (strict):
--   - ONLY updates import_review.building_candidates.review_overrides
--   - Does NOT drop any column
--   - Does NOT modify review_overrides_archive
--   - Does NOT modify normalized_data / source_refs
--   - Does NOT modify typed columns
--
-- Safety:
--   - Asserts archive coverage before clearing:
--       A) row-level review_overrides_archive column pattern
--       B) central import_review.review_overrides_archive table pattern
--     Supports whichever exists in current DB.
--   - Logs:
--       rows_to_clear
--       distinct override keys
--       invalid building_type_id override count
--   - Raises EXCEPTION on missing/incomplete archive coverage.
--   - Asserts zero non-empty review_overrides after update.
--
-- Rollback notes:
--   - If row-level archive exists:
--       update import_review.building_candidates
--       set review_overrides = review_overrides_archive
--       where review_overrides_archive <> '{}'::jsonb;
--   - If central archive exists:
--       restore by joining archived payload for candidate_table='building_candidates'
--       and candidate_id -> building_candidates.id.
--
-- =============================================================================

begin;

do $$
declare
    has_building_candidates boolean;
    has_review_overrides_col boolean;
    has_row_archive_col boolean;
    has_central_archive_table boolean;

    rows_to_clear bigint;
    distinct_keys bigint;
    invalid_building_type_id_count bigint;

    row_archive_coverage_count bigint;
    central_archive_coverage_count bigint;

    rows_cleared bigint;
    remaining_non_empty bigint;
begin
    select to_regclass('import_review.building_candidates') is not null
    into has_building_candidates;

    if not has_building_candidates then
        raise exception '083b STOP: import_review.building_candidates does not exist.';
    end if;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides'
    )
    into has_review_overrides_col;

    if not has_review_overrides_col then
        raise exception '083b STOP: import_review.building_candidates.review_overrides does not exist.';
    end if;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'building_candidates'
          and column_name = 'review_overrides_archive'
    )
    into has_row_archive_col;

    select to_regclass('import_review.review_overrides_archive') is not null
    into has_central_archive_table;

    -- Rows that would be cleared
    select count(*)::bigint
    into rows_to_clear
    from import_review.building_candidates b
    where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

    -- Distinct keys across rows_to_clear
    select count(distinct k.key)::bigint
    into distinct_keys
    from import_review.building_candidates b
    cross join lateral jsonb_object_keys(coalesce(b.review_overrides, '{}'::jsonb)) as k(key)
    where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

    -- Invalid building_type_id overrides (numeric but not in ref)
    select count(*)::bigint
    into invalid_building_type_id_count
    from import_review.building_candidates b
    where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
      and (b.review_overrides->>'building_type_id') ~ '^[0-9]+$'
      and not exists (
          select 1
          from ref.ref_building_types bt
          where bt.id = (b.review_overrides->>'building_type_id')::bigint
      );

    raise notice '083b: rows_to_clear=%', rows_to_clear;
    raise notice '083b: distinct_override_keys=%', coalesce(distinct_keys, 0);
    raise notice '083b: invalid_building_type_id_override_count=%', coalesce(invalid_building_type_id_count, 0);

    if rows_to_clear = 0 then
        raise notice '083b: no rows to clear; exiting with no-op.';
        return;
    end if;

    -- Must have at least one archive pattern available
    if not has_row_archive_col and not has_central_archive_table then
        raise exception
            '083b STOP: archive missing. Neither row-level review_overrides_archive column nor central import_review.review_overrides_archive table exists.';
    end if;

    -- Validate row-level archive coverage if available
    if has_row_archive_col then
        select count(*)::bigint
        into row_archive_coverage_count
        from import_review.building_candidates b
        where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
          and coalesce(b.review_overrides_archive, '{}'::jsonb) <> '{}'::jsonb;

        raise notice '083b: row_archive_coverage_count=%', row_archive_coverage_count;

        if row_archive_coverage_count <> rows_to_clear then
            raise exception
                '083b STOP: incomplete row-level archive coverage. rows_to_clear=% covered=%',
                rows_to_clear,
                row_archive_coverage_count;
        end if;
    end if;

    -- Validate central archive coverage if available
    if has_central_archive_table then
        -- candidate_id may be bigint or text depending on deployment; compare as text.
        select count(distinct b.id)::bigint
        into central_archive_coverage_count
        from import_review.building_candidates b
        where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb
          and exists (
              select 1
              from import_review.review_overrides_archive a
              where a.candidate_table = 'building_candidates'
                and (
                    (a.candidate_id)::text = (b.id)::text
                    or (a.id)::text = (b.id)::text
                )
          );

        raise notice '083b: central_archive_coverage_count=%', central_archive_coverage_count;

        if central_archive_coverage_count <> rows_to_clear then
            raise exception
                '083b STOP: incomplete central archive coverage. rows_to_clear=% covered=%',
                rows_to_clear,
                central_archive_coverage_count;
        end if;
    end if;

    -- Clear only non-empty live review_overrides (legacy blocker data)
    update import_review.building_candidates b
    set review_overrides = '{}'::jsonb
    where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

    get diagnostics rows_cleared = row_count;
    raise notice '083b: rows_cleared=%', rows_cleared;

    -- Post-condition: zero non-empty review_overrides for building_candidates
    select count(*)::bigint
    into remaining_non_empty
    from import_review.building_candidates b
    where coalesce(b.review_overrides, '{}'::jsonb) <> '{}'::jsonb;

    if remaining_non_empty <> 0 then
        raise exception
            '083b STOP: post-clear assertion failed; remaining_non_empty=%',
            remaining_non_empty;
    end if;

    raise notice '083b: SUCCESS. building_candidates.review_overrides fully cleared.';
end $$;

commit;

