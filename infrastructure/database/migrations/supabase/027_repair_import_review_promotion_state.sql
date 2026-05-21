-- =============================================================================
-- Supabase migration 027: Repair import-review promotion state (no data deletion)
-- =============================================================================
--
-- Purpose:
--   Reconcile stale promotion statuses, denormalized publish batch counts,
--   candidate promotion_status, and core verification metadata for rows
--   promoted from import_review.
--
-- Scope:
--   Set review_batch_id_filter below (NULL = all review batches).
--   Does NOT delete rows or overwrite stage logs.
--
-- Apply: Supabase SQL Editor. Run after 026_add_core_verification_columns.sql
-- =============================================================================

do $$
declare
    review_batch_id_filter bigint := NULL;  -- e.g. 2 for single batch; NULL = all
    rb_id bigint;
begin
    -- -------------------------------------------------------------------------
    -- Step 1: Core verification backfill for import-review promoted rows
    -- -------------------------------------------------------------------------
    if to_regclass('core.core_map_buildings') is not null then
        update core.core_map_buildings AS c
        set
            is_verified = false,
            verification_status = 'unverified',
            verified_at = null,
            verified_by = null,
            verification_note = null
        where (
            exists (
                select 1 from system.system_publish_items AS spi
                where spi.target_id = c.id
                  and spi.publish_status = 'success'
                  and spi.entity_family = 'buildings'
                  and (review_batch_id_filter is null or exists (
                      select 1 from system.system_publish_batches AS pb
                      where pb.id = spi.publish_batch_id
                        and pb.source_review_batch_id = review_batch_id_filter
                  ))
            )
            or c.source_refs->>'review_candidate_id' is not null
            or c.source_refs->>'publish_batch_id' is not null
        )
          and c.is_verified is distinct from true
          and c.verification_status is distinct from 'verified'
          and c.verified_at is null;
    end if;

    if to_regclass('core.core_places') is not null then
        update core.core_places AS p
        set
            is_verified = false,
            verification_status = 'unverified',
            verified_at = null,
            verified_by = null,
            verification_note = null
        where (
            exists (
                select 1 from system.system_publish_items AS spi
                where spi.target_id = p.id
                  and spi.publish_status = 'success'
                  and spi.entity_family = 'places'
                  and (review_batch_id_filter is null or exists (
                      select 1 from system.system_publish_batches AS pb
                      where pb.id = spi.publish_batch_id
                        and pb.source_review_batch_id = review_batch_id_filter
                  ))
            )
            or p.source_refs->>'review_candidate_id' is not null
            or p.source_refs->>'publish_batch_id' is not null
        )
          and p.is_verified is distinct from true
          and p.verification_status is distinct from 'verified'
          and p.verified_at is null;
    end if;

    raise notice 'Step 1 complete: core verification metadata backfill';

    -- -------------------------------------------------------------------------
    -- Step 2: Reconcile building candidate promotion states
    -- -------------------------------------------------------------------------
    if to_regclass('import_review.building_candidates') is not null then
        with latest_item AS (
            select distinct on (spi.review_candidate_id)
                spi.review_candidate_id,
                spi.publish_status,
                spi.target_id,
                spi.published_at,
                pb.promoted_at
            from system.system_publish_items AS spi
            inner join system.system_publish_batches AS pb on pb.id = spi.publish_batch_id
            where spi.review_candidate_table = 'import_review.building_candidates'
              and (review_batch_id_filter is null or pb.source_review_batch_id = review_batch_id_filter)
            order by spi.review_candidate_id,
                     spi.published_at desc nulls last,
                     pb.promoted_at desc nulls last,
                     spi.id desc
        ),
        core_exists AS (
            select b.id AS candidate_id, b.promoted_core_id
            from import_review.building_candidates AS b
            where (review_batch_id_filter is null or b.review_batch_id = review_batch_id_filter)
              and b.promoted_core_id is not null
              and exists (
                  select 1 from core.core_map_buildings AS c
                  where c.id = b.promoted_core_id
                    and coalesce(c.is_active, true)
                    and c.deleted_at is null
              )
        )
        update import_review.building_candidates AS b
        set
            promotion_status = case
                when ce.candidate_id is not null then 'promoted'
                when li.publish_status = 'success' and li.target_id is not null then 'promoted'
                when li.publish_status = 'failed'
                     and not exists (
                         select 1 from latest_item AS li2
                         where li2.review_candidate_id = b.id
                           and li2.publish_status = 'success'
                     ) then 'failed'
                when b.review_decision = 'approved'
                     and b.review_status = 'approved'
                     and exists (
                         select 1 from system.system_publish_items AS spi
                         inner join system.system_publish_batches AS pb on pb.id = spi.publish_batch_id
                         where spi.review_candidate_id = b.id
                           and spi.review_candidate_table = 'import_review.building_candidates'
                           and pb.status in ('draft', 'validating', 'ready', 'promoting')
                           and (review_batch_id_filter is null or pb.source_review_batch_id = review_batch_id_filter)
                     ) then 'batched'
                when b.review_decision = 'approved'
                     and b.review_status = 'approved'
                     and jsonb_array_length(coalesce(b.validation_errors, '[]'::jsonb)) = 0
                     then 'ready'
                else b.promotion_status
            end,
            review_status = case
                when ce.candidate_id is not null then 'promoted'
                when li.publish_status = 'success' and li.target_id is not null then 'promoted'
                when li.publish_status = 'failed'
                     and not exists (
                         select 1 from latest_item AS li2
                         where li2.review_candidate_id = b.id
                           and li2.publish_status = 'success'
                     ) then 'promotion_failed'
                else b.review_status
            end,
            promoted_core_id = case
                when li.publish_status = 'success' and li.target_id is not null then li.target_id
                when ce.candidate_id is not null then b.promoted_core_id
                else b.promoted_core_id
            end,
            updated_at = now()
        from latest_item AS li
        full join core_exists AS ce on ce.candidate_id = li.review_candidate_id
        where b.id = coalesce(li.review_candidate_id, ce.candidate_id)
          and (review_batch_id_filter is null or b.review_batch_id = review_batch_id_filter);
    end if;

    -- -------------------------------------------------------------------------
    -- Step 2b: Reconcile place candidate promotion states
    -- -------------------------------------------------------------------------
    if to_regclass('import_review.place_candidates') is not null then
        with latest_item AS (
            select distinct on (spi.review_candidate_id)
                spi.review_candidate_id,
                spi.publish_status,
                spi.target_id,
                spi.published_at,
                pb.promoted_at
            from system.system_publish_items AS spi
            inner join system.system_publish_batches AS pb on pb.id = spi.publish_batch_id
            where spi.review_candidate_table = 'import_review.place_candidates'
              and (review_batch_id_filter is null or pb.source_review_batch_id = review_batch_id_filter)
            order by spi.review_candidate_id,
                     spi.published_at desc nulls last,
                     pb.promoted_at desc nulls last,
                     spi.id desc
        ),
        core_exists AS (
            select p.id AS candidate_id, p.promoted_core_id
            from import_review.place_candidates AS p
            where (review_batch_id_filter is null or p.review_batch_id = review_batch_id_filter)
              and p.promoted_core_id is not null
              and exists (
                  select 1 from core.core_places AS c
                  where c.id = p.promoted_core_id
                    and c.deleted_at is null
              )
        )
        update import_review.place_candidates AS p
        set
            promotion_status = case
                when ce.candidate_id is not null then 'promoted'
                when li.publish_status = 'success' and li.target_id is not null then 'promoted'
                when li.publish_status = 'failed'
                     and not exists (
                         select 1 from latest_item AS li2
                         where li2.review_candidate_id = p.id
                           and li2.publish_status = 'success'
                     ) then 'failed'
                when p.review_decision = 'approved'
                     and p.review_status = 'approved'
                     and exists (
                         select 1 from system.system_publish_items AS spi
                         inner join system.system_publish_batches AS pb on pb.id = spi.publish_batch_id
                         where spi.review_candidate_id = p.id
                           and spi.review_candidate_table = 'import_review.place_candidates'
                           and pb.status in ('draft', 'validating', 'ready', 'promoting')
                           and (review_batch_id_filter is null or pb.source_review_batch_id = review_batch_id_filter)
                     ) then 'batched'
                when p.review_decision = 'approved'
                     and p.review_status = 'approved'
                     and jsonb_array_length(coalesce(p.validation_errors, '[]'::jsonb)) = 0
                     then 'ready'
                else p.promotion_status
            end,
            review_status = case
                when ce.candidate_id is not null then 'promoted'
                when li.publish_status = 'success' and li.target_id is not null then 'promoted'
                when li.publish_status = 'failed'
                     and not exists (
                         select 1 from latest_item AS li2
                         where li2.review_candidate_id = p.id
                           and li2.publish_status = 'success'
                     ) then 'promotion_failed'
                else p.review_status
            end,
            promoted_core_id = case
                when li.publish_status = 'success' and li.target_id is not null then li.target_id
                when ce.candidate_id is not null then p.promoted_core_id
                else p.promoted_core_id
            end,
            updated_at = now()
        from latest_item AS li
        full join core_exists AS ce on ce.candidate_id = li.review_candidate_id
        where p.id = coalesce(li.review_candidate_id, ce.candidate_id)
          and (review_batch_id_filter is null or p.review_batch_id = review_batch_id_filter);
    end if;

    raise notice 'Step 2 complete: candidate promotion state reconciliation';

    -- -------------------------------------------------------------------------
    -- Step 3: Recompute publish batch denormalized counts (includes zero-item batches)
    -- -------------------------------------------------------------------------
    update system.system_publish_batches AS pb
    set
        total_item_count = recomputed.total,
        success_count = recomputed.success,
        failed_count = recomputed.failed,
        skipped_count = recomputed.skipped,
        status = case
            when pb.status = 'promoted'
                 and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                 and (
                     recomputed.total = 0
                     or recomputed.success = 0
                     or (
                         pb.summary->'promotion_result' is not null
                         and (
                             coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                         )
                     )
                 )
                then 'failed'
            else pb.status
        end,
        promoted_at = case
            when pb.status = 'promoted'
                 and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                 and (
                     recomputed.total = 0
                     or recomputed.success = 0
                     or (
                         pb.summary->'promotion_result' is not null
                         and (
                             coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                         )
                     )
                 )
                then null
            else pb.promoted_at
        end,
        note = case
            when pb.status = 'promoted'
                 and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                 and (
                     recomputed.total = 0
                     or recomputed.success = 0
                     or (
                         pb.summary->'promotion_result' is not null
                         and (
                             coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                             or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                         )
                     )
                 )
                then coalesce(pb.note, '') || ' [repaired: invalid empty promoted batch]'
            else pb.note
        end,
        summary = coalesce(pb.summary, '{}'::jsonb) || jsonb_build_object(
            'recomputed_at', to_jsonb(now()),
            'recomputed_counts', jsonb_build_object(
                'total_item_count', recomputed.total,
                'success_count', recomputed.success,
                'failed_count', recomputed.failed,
                'skipped_count', recomputed.skipped
            ),
            'derived_status', case
                when pb.status = 'promoted'
                     and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                     and (
                         recomputed.total = 0
                         or recomputed.success = 0
                         or (
                             pb.summary->'promotion_result' is not null
                             and (
                                 coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                             )
                         )
                     )
                    then 'invalid_empty_promoted'
                else coalesce(pb.summary->>'derived_status', pb.status)
            end,
            'derived_status_reason', case
                when pb.status = 'promoted'
                     and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                     and (
                         recomputed.total = 0
                         or recomputed.success = 0
                         or (
                             pb.summary->'promotion_result' is not null
                             and (
                                 coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                             )
                         )
                     )
                    then 'Batch was stored as promoted but no publish items were successfully promoted/verified.'
                else pb.summary->>'derived_status_reason'
            end,
            'repair_note', case
                when pb.status = 'promoted'
                     and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                     and (
                         recomputed.total = 0
                         or recomputed.success = 0
                         or (
                             pb.summary->'promotion_result' is not null
                             and (
                                 coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                             )
                         )
                     )
                    then 'Repair changed invalid promoted batch to failed/blocked because no successful publish items existed.'
                else pb.summary->>'repair_note'
            end,
            'repaired_at', case
                when pb.status = 'promoted'
                     and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                     and (
                         recomputed.total = 0
                         or recomputed.success = 0
                         or (
                             pb.summary->'promotion_result' is not null
                             and (
                                 coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                                 or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                             )
                         )
                     )
                    then to_jsonb(now())
                else pb.summary->'repaired_at'
            end,
            'empty_promoted_invalid', (
                pb.status = 'promoted'
                and coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
                and (
                    recomputed.total = 0
                    or recomputed.success = 0
                    or (
                        pb.summary->'promotion_result' is not null
                        and (
                            coalesce((pb.summary->'promotion_result'->>'total')::integer, 0) = 0
                            or coalesce((pb.summary->'promotion_result'->>'success_count')::integer, 0) = 0
                            or coalesce((pb.summary->'promotion_result'->>'core_verified_count')::integer, 0) = 0
                            or coalesce((pb.summary->'promotion_result'->>'import_review_marked_promoted_count')::integer, 0) = 0
                        )
                    )
                )
            )
        )
    from (
        select
            pb2.id AS publish_batch_id,
            coalesce(stats.total, 0)::integer AS total,
            coalesce(stats.success, 0)::integer AS success,
            coalesce(stats.failed, 0)::integer AS failed,
            coalesce(stats.skipped, 0)::integer AS skipped
        from system.system_publish_batches AS pb2
        left join (
            select
                spi.publish_batch_id,
                count(*)::integer AS total,
                count(*) filter (where spi.publish_status = 'success')::integer AS success,
                count(*) filter (where spi.publish_status = 'failed')::integer AS failed,
                count(*) filter (where spi.publish_status = 'skipped')::integer AS skipped
            from system.system_publish_items AS spi
            group by spi.publish_batch_id
        ) AS stats on stats.publish_batch_id = pb2.id
        where review_batch_id_filter is null or pb2.source_review_batch_id = review_batch_id_filter
    ) AS recomputed
    where pb.id = recomputed.publish_batch_id;

    raise notice 'Step 3 complete: publish batch count repair';

    -- -------------------------------------------------------------------------
    -- Step 4: Recompute review batch summary only (stored status unchanged)
    -- -------------------------------------------------------------------------
    for rb_id in
        select rb.id
        from import_review.review_batches AS rb
        where review_batch_id_filter is null or rb.id = review_batch_id_filter
    loop
        update import_review.review_batches AS rb
        set
            summary = coalesce(rb.summary, '{}'::jsonb) || jsonb_build_object(
                'recomputed_at', to_jsonb(now())
            ),
            updated_at = now()
        where rb.id = rb_id;
    end loop;

    raise notice 'Step 4 complete: review batch summary recompute (stored status unchanged)';
    raise notice 'Repair complete for review_batch_id_filter=%', review_batch_id_filter;
end $$;

-- =============================================================================
-- Verification queries (run after repair)
-- =============================================================================
--
-- Publish batch consistency for review batch 2:
-- SELECT pb.id, pb.status AS stored_status,
--        pb.total_item_count, pb.success_count, pb.failed_count,
--        count(*) FILTER (WHERE spi.publish_status='success') AS live_success,
--        count(*) FILTER (WHERE spi.publish_status='failed') AS live_failed
-- FROM system.system_publish_batches pb
-- LEFT JOIN system.system_publish_items spi ON spi.publish_batch_id = pb.id
-- WHERE pb.source_review_batch_id = 2
-- GROUP BY pb.id, pb.status, pb.total_item_count, pb.success_count, pb.failed_count;
--
-- Candidate states for review batch 2:
-- SELECT review_batch_id, promotion_status, review_status, count(*)
-- FROM import_review.building_candidates WHERE review_batch_id = 2 GROUP BY 1,2,3
-- UNION ALL
-- SELECT review_batch_id, promotion_status, review_status, count(*)
-- FROM import_review.place_candidates WHERE review_batch_id = 2 GROUP BY 1,2,3;
--
-- Core verification for promoted places:
-- SELECT verification_status, is_verified, count(*)
-- FROM core.core_places p
-- WHERE EXISTS (
--   SELECT 1 FROM system.system_publish_items spi
--   WHERE spi.target_id = p.id AND spi.publish_status = 'success'
-- )
-- GROUP BY 1,2;
--
-- Invalid promoted batches (pre-repair):
-- SELECT id, batch_name, status, total_item_count, success_count, failed_count,
--        summary->'promotion_result'->>'total' AS promo_total,
--        summary->>'derived_status' AS derived_status
-- FROM system.system_publish_batches
-- WHERE status = 'promoted'
--   AND (total_item_count = 0 OR success_count = 0);
--
-- Confirm batch 7 repaired:
-- SELECT id, status, total_item_count, success_count,
--        summary->>'derived_status', summary->>'derived_status_reason', summary->>'repair_note'
-- FROM system.system_publish_batches WHERE id = 7;
--
-- Confirm batch 6 unchanged (failed/blocked):
-- SELECT id, status, failed_count, summary->'validation_result'
-- FROM system.system_publish_batches WHERE id = 6;
