import type {
    ImportReviewPublishBatchValidationResultSummary,
    ImportReviewRoadPromotionGatesResult,
} from "@/src/lib/api";
import {
    resolveRoadBulkPromotionUxPolicy,
    type RoadBulkPromotionUxPolicy,
} from "@/src/features/import-review/promotion/roadBulkPromotionUx";
import {
    batchRequiresDryRunBeforePromote,
} from "@/src/features/import-review/promotion/publishBatchWorkflowUi";
import {
    isPublishBatchClosedForReuse,
    normalizePublishBatchLifecycleStatus,
    publishBatchDryRunPassed,
} from "@/src/features/import-review/promotion/publishBatchLifecycle";
import {
    isPublishBatchValidationSystemFailure,
    publishBatchClosedFailureMessage,
    publishBatchValidationFailureHeadline,
    publishBatchValidationSystemFailureMessage,
} from "@/src/features/import-review/promotion/publishBatchValidationFailure";
import {
    resolveRoadPromotionGatesForPromoteUi,
    roadPromotionBlocksPromote,
    roadPromotionPrimaryBlockerMessage,
} from "@/src/features/import-review/promotion/roadPromotionGates";

export type ImportReviewPublishItemStatusCounts = {
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    total: number;
};

export type PromotionPromoteUiInput = {
    batchStatus: string;
    workflowBlocked: boolean;
    validatedAt: string | null | undefined;
    validationPercent?: number;
    validation: ImportReviewPublishBatchValidationResultSummary | null | undefined;
    /** Batch summary JSON (validation_error marks validation-phase SQL failures). */
    batchSummary?: Record<string, unknown> | null;
    /** Live count: pending items with validation_result ready (or warning when confirmed). */
    currentPromotableCount?: number;
    validationPromotableCount?: number | null;
    publishItemStatus?: ImportReviewPublishItemStatusCounts;
    /** Eligible failed+ready items for a new retry batch (from progress API). */
    failedReadyRetryCount?: number;
    promotionStatus?: string | null;
    /** Raw gates from GET progress (may be omitted by API serialization). */
    roadPromotionGates?: ImportReviewRoadPromotionGatesResult | null;
    dryRunResult?: { status: string } | null;
    hasRoadItems?: boolean;
    roadsItemCount?: number;
    /** Publish batch entity families (roads/routing_barriers require dry-run before promote). */
    entityFamilies?: readonly string[];
};

export type PromotionPromoteUiState = {
    validationSystemFailure: boolean;
    validationFailureHeadline: string;
    readyCount: number;
    warningCount: number;
    blockedCount: number;
    /** Snapshot at validation time (ready + warning). */
    validationPromotableCount: number;
    /** Items that can be promoted on the next run. */
    currentPromotableCount: number;
    publishItemFailedCount: number;
    publishItemSuccessCount: number;
    promotionAttemptExhausted: boolean;
    promotionFailed: boolean;
    validationComplete: boolean;
    canPromote: boolean;
    promoteButtonLabel: string;
    promoteDisabledReason: string | null;
    exhaustedBatchMessage: string | null;
    retryBatchMessage: string | null;
    canCreateRetryBatch: boolean;
    retryBatchButtonLabel: string | null;
    blockedWarningMessage: string | null;
    showWarningNoteField: boolean;
    blockedDetailsFamily: string | null;
    roadBulkUx: RoadBulkPromotionUxPolicy | null;
};

function readyCountFromValidation(
    validation: ImportReviewPublishBatchValidationResultSummary
): number {
    return validation.ready_count ?? validation.valid_count ?? 0;
}

export function validationOutcomeAllowsPromotion(
    validation: ImportReviewPublishBatchValidationResultSummary | null | undefined
): boolean {
    if (!validation || validation.can_promote === false) {
        return false;
    }
    const outcome = validation.outcome;
    return outcome === "passed" || outcome === "partial" || outcome === "ready";
}

export function batchValidationCompleteForPromotion(input: {
    validatedAt?: string | null | undefined;
    validationPercent?: number;
    validation: ImportReviewPublishBatchValidationResultSummary | null | undefined;
}): boolean {
    const percent = input.validationPercent ?? 0;
    return percent >= 100 && input.validation !== null;
}

export function promotionPromoteUiState(input: PromotionPromoteUiInput): PromotionPromoteUiState {
    const validation = input.validation ?? null;
    const readyCount = validation ? readyCountFromValidation(validation) : 0;
    const warningCount = validation?.warning_count ?? 0;
    const blockedCount = validation?.blocked_count ?? 0;
    const validationPromotableCount =
        input.validationPromotableCount ??
        validation?.promotable_count ??
        Math.max(0, readyCount + warningCount);

    const currentPromotableCount =
        input.currentPromotableCount ??
        (input.publishItemStatus
            ? Math.max(0, input.publishItemStatus.pending)
            : validationPromotableCount);

    const publishItemFailedCount = input.publishItemStatus?.failed ?? 0;
    const publishItemSuccessCount = input.publishItemStatus?.success ?? 0;
    const failedReadyRetryCount = Math.max(0, input.failedReadyRetryCount ?? 0);

    const promotionStatus = (input.promotionStatus ?? "").trim();
    const validationSystemFailure = isPublishBatchValidationSystemFailure({
        batchStatus: input.batchStatus,
        promotionStatus: input.promotionStatus,
        publishItemSuccessCount,
        publishItemFailedCount,
        summary: input.batchSummary ?? null,
    });
    const validationFailureHeadline = publishBatchValidationFailureHeadline(validationSystemFailure);
    const promotionFailed =
        !validationSystemFailure &&
        (promotionStatus === "promotion_failed" ||
            (input.batchStatus.trim().toLowerCase() === "failed" &&
                publishItemFailedCount > 0 &&
                publishItemSuccessCount > 0));

    const promotionAttemptExhausted =
        validationSystemFailure ||
        promotionFailed ||
        (validationPromotableCount > 0 &&
            currentPromotableCount === 0 &&
            publishItemFailedCount > 0);

    const validationComplete = batchValidationCompleteForPromotion({
        validatedAt: input.validatedAt,
        validationPercent: input.validationPercent,
        validation,
    });

    const batchStatus = input.batchStatus.trim().toLowerCase();
    const batchClosed = isPublishBatchClosedForReuse(batchStatus);
    const inFlight = batchStatus === "validating" || batchStatus === "promoting";

    const validationAllowsRun = validationOutcomeAllowsPromotion(validation);
    const resolvedRoadPromotionGates = resolveRoadPromotionGatesForPromoteUi({
        apiGates: input.roadPromotionGates,
        hasRoadItems: input.hasRoadItems,
        roadsItemCount: input.roadsItemCount,
    });
    const requiresDryRunBeforePromote = batchRequiresDryRunBeforePromote(
        input.entityFamilies?.length
            ? input.entityFamilies
            : input.hasRoadItems
              ? ["roads"]
              : []
    );
    const batchDryRunPassedForPromote = publishBatchDryRunPassed(input.dryRunResult ?? null);
    const dryRunGateOk = !requiresDryRunBeforePromote || batchDryRunPassedForPromote;
    const roadBlocksPromote =
        requiresDryRunBeforePromote &&
        dryRunGateOk &&
        roadPromotionBlocksPromote(resolvedRoadPromotionGates);
    const roadBlockerMessage = roadPromotionPrimaryBlockerMessage(resolvedRoadPromotionGates);

    let canPromote =
        !input.workflowBlocked &&
        !batchClosed &&
        !inFlight &&
        validationComplete &&
        validationAllowsRun &&
        dryRunGateOk &&
        currentPromotableCount > 0 &&
        !roadBlocksPromote;

    let promoteDisabledReason: string | null = null;
    if (input.workflowBlocked) {
        promoteDisabledReason = null;
    } else if (batchClosed) {
        promoteDisabledReason = publishBatchClosedFailureMessage({
            batchStatus,
            validationSystemFailure,
        });
    } else if (roadBlocksPromote) {
        promoteDisabledReason = roadBlockerMessage;
    } else if (inFlight) {
        promoteDisabledReason =
            batchStatus === "validating"
                ? "Validation is still running."
                : "Promotion is already running.";
    } else if (!validationComplete || validation === null) {
        promoteDisabledReason = "Run batch validation first.";
    } else if (requiresDryRunBeforePromote && !batchDryRunPassedForPromote) {
        promoteDisabledReason = "Run dry-run before promotion.";
    } else if (!validationAllowsRun) {
        promoteDisabledReason = "No promotable items at validation. Resolve blocked items or re-validate.";
    } else if (currentPromotableCount <= 0) {
        promoteDisabledReason = promotionAttemptExhausted
            ? "No currently promotable items in this batch. Create a new batch after fixing the error."
            : "No currently promotable items in this batch.";
    }

    let promoteButtonLabel = "Promote";
    if (currentPromotableCount > 0) {
        const readyNow = Math.min(readyCount, currentPromotableCount);
        const warningsNow =
            warningCount > 0 ? Math.max(0, currentPromotableCount - readyNow) : 0;
        if (readyNow > 0 && warningsNow > 0) {
            promoteButtonLabel = `Promote ${readyNow.toLocaleString()} ready + ${warningsNow.toLocaleString()} warning${warningsNow === 1 ? "" : "s"}`;
        } else if (readyNow > 0) {
            promoteButtonLabel = `Promote ${readyNow.toLocaleString()} ready item${readyNow === 1 ? "" : "s"}`;
        } else if (warningsNow > 0) {
            promoteButtonLabel = `Promote ${warningsNow.toLocaleString()} warning item${warningsNow === 1 ? "" : "s"}`;
        } else {
            promoteButtonLabel = `Promote ${currentPromotableCount.toLocaleString()} item${currentPromotableCount === 1 ? "" : "s"}`;
        }
    } else if (promotionAttemptExhausted) {
        promoteButtonLabel = "No items to promote";
    }

    const canCreateRetryBatch = promotionAttemptExhausted && failedReadyRetryCount > 0;
    const retryBatchButtonLabel = canCreateRetryBatch
        ? `Create retry batch from ${failedReadyRetryCount.toLocaleString()} failed+ready item${failedReadyRetryCount === 1 ? "" : "s"}`
        : null;

    const roadBulkUx = resolveRoadBulkPromotionUxPolicy({
        hasRoadItems: input.hasRoadItems,
        roadsItemCount: input.roadsItemCount,
        gates: resolvedRoadPromotionGates ?? input.roadPromotionGates,
        validationReadyCount: readyCount,
        currentPromotableCount,
        publishItemFailedCount,
        publishItemSuccessCount,
        blockedCount,
        canCreateRetryBatch,
        failedReadyRetryCount,
    });

    let exhaustedBatchMessage: string | null = null;
    let retryBatchMessage: string | null = null;
    if (promotionAttemptExhausted) {
        exhaustedBatchMessage = validationSystemFailure
            ? publishBatchValidationSystemFailureMessage()
            : promotionFailed
              ? "Promotion failed. Create a new retry batch after fixing the error."
              : `Validation recorded ${validationPromotableCount.toLocaleString()} promotable item${validationPromotableCount === 1 ? "" : "s"}, but ${publishItemFailedCount.toLocaleString()} already failed during promotion. None are pending now — create a new publish batch after fixing the errors.`;
        retryBatchMessage = validationSystemFailure
            ? "Fix validation blockers or data issues, then create a new publish batch and run validation again."
            : canCreateRetryBatch
              ? "Create a new draft publish batch from the failed ready items, then run validation on that batch before promoting again."
              : promotionFailed
                ? "Fix the underlying error, then use retry batch when eligible items are available."
                : "No failed ready items are eligible for a retry batch (already promoted or blocked in another batch).";
    } else if (
        validationPromotableCount > 0 &&
        currentPromotableCount === 0 &&
        publishItemSuccessCount > 0
    ) {
        exhaustedBatchMessage = `All promotable items from validation were already promoted (${publishItemSuccessCount.toLocaleString()} success).`;
    }

    let blockedWarningMessage: string | null = null;
    if (currentPromotableCount > 0 && blockedCount > 0) {
        const readyToPromoteNow =
            warningCount > 0
                ? Math.min(readyCount, currentPromotableCount)
                : currentPromotableCount;
        blockedWarningMessage = `${readyToPromoteNow.toLocaleString()} ready item${readyToPromoteNow === 1 ? "" : "s"} can be promoted. ${blockedCount.toLocaleString()} blocked item${blockedCount === 1 ? "" : "s"} will be left in import-review.`;
    }

    let blockedDetailsFamily: string | null = null;
    if (blockedCount > 0 && validation?.by_entity) {
        let maxBlocked = 0;
        for (const [family, counts] of Object.entries(validation.by_entity)) {
            const n = counts.blocked ?? 0;
            if (n > maxBlocked) {
                maxBlocked = n;
                blockedDetailsFamily = family;
            }
        }
    }

    return {
        validationSystemFailure,
        validationFailureHeadline,
        readyCount,
        warningCount,
        blockedCount,
        validationPromotableCount,
        currentPromotableCount,
        publishItemFailedCount,
        publishItemSuccessCount,
        promotionAttemptExhausted,
        promotionFailed,
        validationComplete,
        canPromote,
        promoteButtonLabel,
        promoteDisabledReason,
        exhaustedBatchMessage,
        retryBatchMessage,
        canCreateRetryBatch,
        retryBatchButtonLabel,
        blockedWarningMessage,
        showWarningNoteField: warningCount > 0 && canPromote,
        blockedDetailsFamily,
        roadBulkUx: roadBulkUx.isRoadBatch ? roadBulkUx : null,
    };
}
