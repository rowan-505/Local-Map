import type { ImportReviewPublishBatchValidationResult } from "./import-review-promotion-validation.types.js";
import { publishItemStatusCountsAsLegacy } from "./import-review-promotion-publish-item-validation.js";

export type PublishBatchValidationSummaryCounts = {
    readyCount: number;
    warningCount: number;
    blockedCount: number;
    skippedCount: number;
    totalCount: number;
};

export type PublishBatchValidationFinalizeInput = PublishBatchValidationSummaryCounts & {
    promotableFamiliesCount: number;
    by_publish_action: ImportReviewPublishBatchValidationResult["by_publish_action"];
    by_entity: ImportReviewPublishBatchValidationResult["by_entity"];
    selected_entity_families: string[];
    promotable_entity_families: string[];
};

export type PublishBatchValidationFinalizeResult = {
    batchStatus: "ready" | "partial" | "blocked";
    stageStatus: "success" | "warning";
    logsSummary: string;
    validationResult: ImportReviewPublishBatchValidationResult;
};

/** Derive stored batch status and summary.validation_result from per-item counts. */
export function computePublishBatchValidationFinalize(
    input: PublishBatchValidationFinalizeInput
): PublishBatchValidationFinalizeResult {
    const promotableCount = input.readyCount + input.warningCount;
    const canPromote = promotableCount > 0 && input.promotableFamiliesCount > 0;
    const requiresWarningConfirmation = input.warningCount > 0;
    const legacyCounts = publishItemStatusCountsAsLegacy(
        input.readyCount,
        input.warningCount,
        input.blockedCount
    );

    const baseResult: Omit<ImportReviewPublishBatchValidationResult, "outcome" | "can_promote"> = {
        requires_warning_confirmation: requiresWarningConfirmation,
        ready_count: legacyCounts.ready_count,
        valid_count: legacyCounts.valid_count,
        warning_count: input.warningCount,
        blocked_count: input.blockedCount,
        skipped_count: input.skippedCount,
        total_items: input.totalCount,
        total_count: input.totalCount,
        promotable_count: promotableCount,
        by_publish_action: input.by_publish_action,
        by_entity: input.by_entity,
        selected_entity_families: input.selected_entity_families,
        promotable_entity_families: input.promotable_entity_families,
    };

    if (promotableCount === 0 && input.blockedCount > 0) {
        return {
            batchStatus: "blocked",
            stageStatus: "warning",
            logsSummary: `Validation blocked. ${input.blockedCount} item(s) have errors.`,
            validationResult: {
                ...baseResult,
                outcome: "blocked",
                can_promote: false,
            },
        };
    }

    if (promotableCount > 0 && (input.blockedCount > 0 || input.warningCount > 0)) {
        const logsSummary = buildPartialLogsSummary(input, promotableCount);
        return {
            batchStatus: "partial",
            stageStatus: "warning",
            logsSummary,
            validationResult: {
                ...baseResult,
                outcome: "partial",
                can_promote: canPromote,
            },
        };
    }

    if (promotableCount > 0) {
        return {
            batchStatus: "ready",
            stageStatus: "success",
            logsSummary: "Validation passed. Batch is ready for promotion.",
            validationResult: {
                ...baseResult,
                outcome: "passed",
                can_promote: canPromote,
            },
        };
    }

    return {
        batchStatus: "blocked",
        stageStatus: "warning",
        logsSummary: "Validation finished with no promotable items.",
        validationResult: {
            ...baseResult,
            outcome: "blocked",
            can_promote: false,
        },
    };
}

function buildPartialLogsSummary(
    input: PublishBatchValidationFinalizeInput,
    promotableCount: number
): string {
    const parts = [`Partial: ${promotableCount} promotable`];
    if (input.blockedCount > 0) {
        parts.push(`${input.blockedCount} blocked`);
    }
    if (input.warningCount > 0) {
        parts.push(
            `${input.warningCount} warning${input.warningCount === 1 ? "" : "s"} (confirmation required before promotion)`
        );
    }
    return `${parts.join(", ")}.`;
}
