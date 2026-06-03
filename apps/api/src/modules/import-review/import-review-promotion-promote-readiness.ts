import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";

export type PublishBatchPromotionReadinessBatch = {
    status: string;
    validation_percent: number;
    validated_at: Date | string | null;
};

export function batchValidatedForPromotion(batch: PublishBatchPromotionReadinessBatch): boolean {
    return batch.validation_percent === 100;
}

export function validationSummaryAllowsPromotion(
    validation: PromotionPreflightValidation | null
): boolean {
    if (!validation || validation.promotable_count <= 0 || validation.can_promote === false) {
        return false;
    }
    const outcome = validation.outcome;
    return outcome === "passed" || outcome === "partial" || outcome === "ready";
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
    return (
        batchStatusAllowsPromotionAttempt(args.batch.status) &&
        batchValidatedForPromotion(args.batch) &&
        validationSummaryAllowsPromotion(args.validation)
    );
}
