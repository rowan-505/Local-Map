import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import {
    parseCanPromoteFromSummary,
    parseDryRunFromSummary,
    parseValidationOutcomeFromSummary,
} from "./import-review-publish-batch-summary.js";
import type { ImportReviewHistoryPublishBatchListItem, ImportReviewHistoryReviewBatchListItem } from "./import-review-history.types.js";
import type { PublishBatchHistoryListRowDb, ReviewBatchRowDb } from "./import-review-history.repo.js";
import {
    deriveResumableActions,
    parsePipelineFromSummary,
    clampPipelinePercent,
} from "./import-review-promotion-progress.js";
import { parsePromotionHeartbeatFromSummary } from "./import-review-promotion-promote-progress.js";
import { isValidationHeartbeatStalled } from "./import-review-promotion-validation-control.js";
import { isPromotionHeartbeatStalled } from "./import-review-promotion-promote-progress.js";

function n(v: bigint | number): number {
    return typeof v === "bigint" ? Number(v) : v;
}

function toIso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
}

function bigStr(v: bigint | null | undefined): string | null {
    return v != null ? v.toString() : null;
}

function parseValidationCountsFromSummary(summary: unknown): {
    ready_count: number;
    warning_count: number;
    blocked_count: number;
    failed_count: number;
} {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return { ready_count: 0, warning_count: 0, blocked_count: 0, failed_count: 0 };
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return { ready_count: 0, warning_count: 0, blocked_count: 0, failed_count: 0 };
    }
    const o = vr as Record<string, unknown>;
    return {
        ready_count: Number(o.ready_count ?? o.valid_count ?? 0),
        warning_count: Number(o.warning_count ?? 0),
        blocked_count: Number(o.blocked_count ?? 0),
        failed_count: Number(o.failed_count ?? 0),
    };
}

export function mapReviewBatchHistoryListItemLight(row: ReviewBatchRowDb): ImportReviewHistoryReviewBatchListItem {
    const uploaded = row.uploaded_candidate_count;
    const total = row.total_candidate_count;
    const preserved = row.preserved_reviewed_count;
    const skipped = row.skipped_count;

    return {
        id: row.id.toString(),
        public_id: row.public_id,
        batch_name: row.batch_name,
        source_snapshot_version: row.source_snapshot_version,
        source_snapshot_id_local: bigStr(row.source_snapshot_id_local),
        region_code: row.region_code,
        status: row.status,
        derived_status: row.status,
        derived_status_reason: null,
        stored_status_recommendation: null,
        status_note: null,
        created_at: row.created_at.toISOString(),
        uploaded_at: row.uploaded_at.toISOString(),
        validated_at: toIso(row.latest_validated_at),
        promoted_at: toIso(row.latest_promoted_at),
        total_candidate_count: total,
        entity_families: [...row.entity_families],
        counts: {
            batch_total_candidates: total,
            active_candidates: Math.max(0, uploaded - skipped),
            pending_review_candidates: Math.max(0, total - preserved),
            approved_candidates: preserved,
            rejected_candidates: 0,
            promoted_candidates: 0,
            promotion_failed_candidates: n(row.promotion_fail_count),
        },
        counts_by_entity_family: [],
        publish_batches: {
            publish_batch_count: n(row.publish_batch_count),
            validated_at: toIso(row.latest_validated_at),
            promoted_at: toIso(row.latest_promoted_at),
            validation_success_count: n(row.validation_success_count),
            validation_fail_count: n(row.validation_fail_count),
            promotion_success_count: n(row.promotion_success_count),
            promotion_fail_count: n(row.promotion_fail_count),
        },
        latest_publish_batch: null,
    };
}

export function mapPublishBatchHistoryListItemLight(
    row: PublishBatchHistoryListRowDb
): ImportReviewHistoryPublishBatchListItem {
    const pipeline = parsePipelineFromSummary(row.summary);
    const validationCounts = parseValidationCountsFromSummary(row.summary);
    const summaryReady = validationCounts.ready_count + validationCounts.warning_count;
    const itemReady = n(row.item_ready_count) + n(row.item_warning_count);
    const readyCount = itemReady > 0 ? itemReady : summaryReady;
    const warningCount = n(row.item_warning_count) || validationCounts.warning_count;
    const blockedCount = n(row.item_blocked_count) || validationCounts.blocked_count;
    const promotablePending = n(row.item_promotable_pending_count);

    const dryRunPassed =
        publishBatchDryRunPassed(parsePublishBatchDryRunResultFromSummary(row.summary)) ||
        parseDryRunFromSummary(row.summary) === true;

    const promotionHeartbeat = parsePromotionHeartbeatFromSummary(row.summary);
    const validationHeartbeat = row.validation_heartbeat_at;
    const resumable_actions = deriveResumableActions({
        status: row.status,
        summary: row.summary,
        pipeline,
        validatedAt: row.validated_at,
        validationPercent: row.validation_percent,
        pendingPublishItemCount: n(row.item_pending_count),
        promotablePendingCount: promotablePending > 0 ? promotablePending : readyCount + warningCount,
        dryRunPassed,
        validationHeartbeatStale:
            row.status === "validating" &&
            isValidationHeartbeatStalled(validationHeartbeat, Date.now()),
        promotionHeartbeatStale:
            row.status === "promoting" &&
            isPromotionHeartbeatStalled(promotionHeartbeat, Date.now()),
    });

    const pipelinePercent = pipeline?.percent ?? clampPipelinePercent(row.validation_percent);
    const promotionPercent =
        pipeline?.current_stage === "promote_items"
            ? pipeline.percent
            : row.promoted_at
              ? 100
              : null;

    const validationOutcome = parseValidationOutcomeFromSummary(row.summary);
    const canPromote = parseCanPromoteFromSummary(row.summary);

    return {
        id: row.id.toString(),
        public_id: row.public_id,
        batch_name: row.batch_name,
        status: row.status,
        derived_status: row.status,
        derived_status_reason: validationOutcome ? `validation_${validationOutcome}` : null,
        stored_status_recommendation: null,
        status_note: null,
        source_review_batch_id: bigStr(row.source_review_batch_id),
        source_snapshot_version: row.source_snapshot_version,
        region_code: row.region_code,
        total_item_count: row.total_item_count,
        success_count: row.success_count,
        failed_count: row.failed_count,
        skipped_count: row.skipped_count,
        core_verified_count: 0,
        import_review_marked_promoted_count: row.success_count,
        inserted_count: 0,
        updated_count: 0,
        validation_total: row.validation_total,
        validation_done: row.validation_done,
        validation_percent: row.validation_percent,
        validated_at: toIso(row.validated_at),
        created_at: row.created_at.toISOString(),
        published_at: toIso(row.published_at),
        promoted_at: toIso(row.promoted_at),
        validation_success_count:
            row.validated_at != null && row.status !== "failed" && row.status !== "blocked" ? 1 : 0,
        validation_fail_count:
            row.status === "failed" || row.status === "blocked" || validationOutcome === "blocked" ? 1 : 0,
        item_validation_counts: {
            ready: readyCount,
            warning: warningCount,
            blocked: blockedCount,
            failed: validationCounts.failed_count,
        },
        publish_status_counts: {
            success: row.success_count,
            failed: row.failed_count,
            pending: n(row.item_pending_count),
            skipped: row.skipped_count,
        },
        current_stage: pipeline?.current_stage ?? null,
        current_stage_label: pipeline?.current_stage_label ?? null,
        pipeline_percent: pipelinePercent,
        promotion_percent: promotionPercent,
        resumable_actions,
        can_promote: canPromote ?? undefined,
    };
}
