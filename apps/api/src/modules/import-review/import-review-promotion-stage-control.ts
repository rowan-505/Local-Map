import type { PrismaClient } from "@prisma/client";

import {
    canDryRunPublishBatch,
    canPromotePublishBatch,
    canValidatePublishBatch,
    isPublishBatchClosedForReuse,
    normalizePublishBatchStoredStatus,
} from "./import-review-publish-batch-lifecycle.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import { batchHasSuccessfulPromotion } from "./import-review-promotion-batch-status.js";
import { classifyPublishItemsForPromotion } from "./import-review-promotion-execution.js";
import { parsePipelineFromSummary } from "./import-review-promotion-progress.js";
import { publishItemValidationResultIsComplete } from "./import-review-promotion-validation-resume.js";

export type PromotionStageResumeAction =
    | "already_complete"
    | "resume_validation"
    | "resume_dry_run"
    | "resume_promotion";

export type PromotionStageCancelTarget =
    | "validation"
    | "promotion"
    | "dry_run_pipeline"
    | "none";

export type PromotionStageSnapshot = {
    status: string;
    validationPercent: number;
    validatedAt: Date | null;
    successCount: number;
    summary: unknown;
    incompleteValidationItemCount: number;
    pendingPromotableCount: number;
    dryRunPassed: boolean;
    validationWorkerInProcess: boolean;
    promotionWorkerInProcess: boolean;
};

export async function countIncompleteValidationItems(
    prisma: PrismaClient,
    batchId: bigint
): Promise<number> {
    const rows = await prisma.$queryRaw<{ publish_item_id: bigint; validation_result: unknown }[]>`
        SELECT id AS publish_item_id, validation_result
        FROM system.system_publish_items
        WHERE publish_batch_id = ${batchId}
    `;
    let incomplete = 0;
    for (const row of rows) {
        if (!publishItemValidationResultIsComplete(row.validation_result)) {
            incomplete += 1;
        }
    }
    return incomplete;
}

export async function countPendingPromotableItems(
    prisma: PrismaClient,
    batchId: bigint
): Promise<number> {
    const rows = await prisma.$queryRaw<
        { publish_item_id: bigint; validation_result: unknown }[]
    >`
        SELECT id AS publish_item_id, validation_result
        FROM system.system_publish_items
        WHERE publish_batch_id = ${batchId}
          AND publish_status = 'pending'
    `;
    return classifyPublishItemsForPromotion(rows).promotableIds.length;
}

export function resolvePromotionStageResumeAction(
    snapshot: PromotionStageSnapshot
): PromotionStageResumeAction {
    const status = normalizePublishBatchStoredStatus(snapshot.status);

    if (
        status === "validating" ||
        (canValidatePublishBatch(status) && snapshot.incompleteValidationItemCount > 0)
    ) {
        return "resume_validation";
    }

    if (canValidatePublishBatch(status) && snapshot.validationPercent < 100 && snapshot.validatedAt == null) {
        return "resume_validation";
    }

    if (isPublishBatchClosedForReuse(status)) {
        return "already_complete";
    }

    if (status === "promoting") {
        return "resume_promotion";
    }

    const validationComplete =
        snapshot.validatedAt != null ||
        snapshot.validationPercent >= 100 ||
        status === "ready" ||
        status === "partial";

    if (!validationComplete) {
        return "resume_validation";
    }

    const dryRunRequired =
        canDryRunPublishBatch(status, snapshot.pendingPromotableCount) && !snapshot.dryRunPassed;

    if (dryRunRequired) {
        return "resume_dry_run";
    }

    if (
        canPromotePublishBatch(status, snapshot.pendingPromotableCount, snapshot.dryRunPassed) ||
        (batchHasSuccessfulPromotion({
            success_count: snapshot.successCount,
            summary: snapshot.summary,
        }) &&
            snapshot.pendingPromotableCount > 0)
    ) {
        return "resume_promotion";
    }

    if (status === "promoted" || (status === "partial" && snapshot.pendingPromotableCount === 0)) {
        return "already_complete";
    }

    return "already_complete";
}

export function resolvePromotionStageCancelTarget(snapshot: {
    status: string;
    summary: unknown;
    validationWorkerInProcess: boolean;
    promotionWorkerInProcess: boolean;
}): PromotionStageCancelTarget {
    const status = normalizePublishBatchStoredStatus(snapshot.status);
    const pipeline = parsePipelineFromSummary(snapshot.summary);

    if (status === "validating" || snapshot.validationWorkerInProcess) {
        return "validation";
    }
    if (status === "promoting" || snapshot.promotionWorkerInProcess) {
        return "promotion";
    }
    if (pipeline?.stage_status === "running" && pipeline.current_stage === "dry_run_items") {
        return "dry_run_pipeline";
    }
    if (pipeline?.stage_status === "running" && pipeline.current_stage === "validate_items") {
        return "validation";
    }
    if (pipeline?.stage_status === "running" && pipeline.current_stage === "promote_items") {
        return "promotion";
    }
    return "none";
}

export function promotionResetBlocksUnpromoteSuccessItems(args: {
    success_count: number | null;
    summary?: unknown;
}): boolean {
    return batchHasSuccessfulPromotion({
        success_count: args.success_count,
        summary: args.summary,
    });
}
