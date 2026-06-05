import {
    batchStatusAllowsPromote,
    isPublishBatchClosedForReuse,
    normalizePublishBatchStoredStatus,
} from "./import-review-publish-batch-lifecycle.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";

export type PublishBatchPromotionReadinessBatch = {
    status: string;
    validation_percent: number;
    validated_at: Date | string | null;
    summary?: unknown;
};

export function batchValidatedForPromotion(batch: PublishBatchPromotionReadinessBatch): boolean {
    return batch.validation_percent === 100;
}

export function validationSummaryAllowsPromotion(
    validation: PromotionPreflightValidation | null
): boolean {
    if (!validation || validation.can_promote === false) {
        return false;
    }
    return validation.promotable_count > 0;
}

export function batchStatusAllowsPromotionAttempt(batchStatus: string): boolean {
    const status = batchStatus.trim().toLowerCase();
    return status !== "validating" && status !== "promoting";
}

/** Whether promote API may run for this batch (validation summary is authoritative). */
export function publishBatchReadyForPromotion(args: {
    batch: PublishBatchPromotionReadinessBatch;
    validation: PromotionPreflightValidation | null;
}): boolean {
    const status = normalizePublishBatchStoredStatus(args.batch.status);
    if (isPublishBatchClosedForReuse(status)) {
        return false;
    }
    if (!batchStatusAllowsPromote(status)) {
        return false;
    }
    const dryRun = parsePublishBatchDryRunResultFromSummary(args.batch.summary);
    if (!publishBatchDryRunPassed(dryRun)) {
        return false;
    }
    return (
        batchStatusAllowsPromotionAttempt(args.batch.status) &&
        batchValidatedForPromotion(args.batch) &&
        validationSummaryAllowsPromotion(args.validation)
    );
}
