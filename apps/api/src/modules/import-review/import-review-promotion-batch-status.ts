import type { PublishBatchStoredStatus } from "./import-review-publish-batch-summary.js";
import {
    parsePromotionResultFieldsFromSummary,
    parsePromotionStatusFromSummary,
} from "./import-review-publish-batch-summary.js";
import type { PromotionRunCounts } from "./import-review-promotion-execution.js";

/** Promotion run outcome stored in batch summary (separate from validation_result.outcome). */
export type PromotionOutcomeStatus =
    | "not_started"
    | "promoting"
    | "promoted"
    | "partially_promoted"
    | "promotion_failed";

export type PromotionRunFinalize = {
    /** Stored system.system_publish_batches.status after this promotion run. */
    stored_batch_status: PublishBatchStoredStatus;
    /** Value for summary.promotion_status and promotion_result mapping. */
    promotion_status: PromotionOutcomeStatus;
    promotion_result_status: "promoted" | "partial" | "failed";
    partial_promotion: boolean;
    logs_summary: string;
    /** Set promoted_at on the batch only when true. */
    set_promoted_at: boolean;
};

export function parsePromotionOutcomeStatus(value: unknown): PromotionOutcomeStatus | null {
    if (typeof value !== "string") {
        return null;
    }
    const v = value.trim();
    if (
        v === "not_started" ||
        v === "promoting" ||
        v === "promoted" ||
        v === "partially_promoted" ||
        v === "promotion_failed"
    ) {
        return v;
    }
    return null;
}

/** Whether the batch has at least one successfully promoted publish item (never promoted_at alone). */
export function batchHasSuccessfulPromotion(args: {
    success_count?: number | null;
    summary?: unknown;
}): boolean {
    if ((args.success_count ?? 0) > 0) {
        return true;
    }
    const fields = parsePromotionResultFieldsFromSummary(args.summary);
    if (fields != null && (fields.success_count ?? 0) > 0) {
        return true;
    }
    if (!args.summary || typeof args.summary !== "object" || Array.isArray(args.summary)) {
        return false;
    }
    const root = args.summary as Record<string, unknown>;
    const pr = root.promotion_result;
    if (pr && typeof pr === "object" && !Array.isArray(pr)) {
        const promoted = Number((pr as Record<string, unknown>).promoted_count ?? 0);
        if (promoted > 0) {
            return true;
        }
    }
    return false;
}

export function batchPromotionBlocksValidationReset(args: {
    status: string;
    promoted_at: Date | null;
    success_count?: number | null;
    summary?: unknown;
}): boolean {
    if (args.status === "promoting") {
        return true;
    }
    if (batchHasSuccessfulPromotion(args)) {
        return true;
    }
    const promotionStatus = parsePromotionStatusFromSummary(args.summary);
    if (promotionStatus === "promoted" || promotionStatus === "partially_promoted") {
        return true;
    }
    if (args.status === "promoted" || args.status === "partially_promoted") {
        return batchHasSuccessfulPromotion(args);
    }
    if (args.status === "failed" && promotionStatus === "promotion_failed") {
        return false;
    }
    return false;
}

function validationStoredStatus(
    validationOutcome: "passed" | "partial" | "blocked" | null,
    previousStoredStatus: string | null | undefined
): PublishBatchStoredStatus {
    const prev = (previousStoredStatus ?? "").trim();
    if (prev === "partial" || prev === "ready" || prev === "blocked" || prev === "failed") {
        return prev;
    }
    if (validationOutcome === "partial") {
        return "partial";
    }
    if (validationOutcome === "blocked") {
        return "blocked";
    }
    if (validationOutcome === "passed") {
        return "ready";
    }
    return "partial";
}

function promotionResultStatusFromOutcome(
    status: PromotionOutcomeStatus
): PromotionRunFinalize["promotion_result_status"] {
    if (status === "promoted") {
        return "promoted";
    }
    if (status === "partially_promoted") {
        return "partial";
    }
    return "failed";
}

/** Derive stored batch status and summary promotion_status after a promotion run. */
export function computePromotionRunFinalize(
    counts: PromotionRunCounts,
    options: {
        validation_outcome: "passed" | "partial" | "blocked" | null;
        previous_stored_status?: string | null;
    }
): PromotionRunFinalize {
    const { promoted_count, failed_count, skipped_blocked_count, skipped_warning_count } = counts;

    if (counts.system_error && promoted_count === 0) {
        const promotion_status: PromotionOutcomeStatus = "promotion_failed";
        return {
            stored_batch_status: "failed",
            promotion_status,
            promotion_result_status: promotionResultStatusFromOutcome(promotion_status),
            partial_promotion: false,
            logs_summary: "Promotion failed due to a system error. Create a new retry batch after fixing the error.",
            set_promoted_at: false,
        };
    }

    if (promoted_count === 0) {
        const promotion_status: PromotionOutcomeStatus = "promotion_failed";
        return {
            stored_batch_status: "failed",
            promotion_status,
            promotion_result_status: promotionResultStatusFromOutcome(promotion_status),
            partial_promotion: false,
            logs_summary:
                failed_count > 0
                    ? "Promotion failed. Create a new retry batch after fixing the error."
                    : "Promotion failed. No items were promoted.",
            set_promoted_at: false,
        };
    }

    const partialPromotion =
        skipped_blocked_count > 0 ||
        skipped_warning_count > 0 ||
        failed_count > 0 ||
        counts.pending_after_count > 0;

    if (partialPromotion) {
        const promotion_status: PromotionOutcomeStatus = "partially_promoted";
        const parts = [`Promoted ${promoted_count} item(s)`];
        if (skipped_blocked_count > 0) {
            parts.push(`${skipped_blocked_count} blocked item(s) left unpromoted`);
        }
        if (skipped_warning_count > 0) {
            parts.push(`${skipped_warning_count} warning item(s) skipped (confirmation required)`);
        }
        if (failed_count > 0) {
            parts.push(`${failed_count} failed`);
        }
        return {
            stored_batch_status: "partial",
            promotion_status,
            promotion_result_status: "partial",
            partial_promotion: true,
            logs_summary: `${parts.join("; ")}.`,
            set_promoted_at: true,
        };
    }

    const promotion_status: PromotionOutcomeStatus = "promoted";
    return {
        stored_batch_status: "promoted",
        promotion_status,
        promotion_result_status: "promoted",
        partial_promotion: false,
        logs_summary: `Promotion completed. ${promoted_count} item(s) promoted.`,
        set_promoted_at: true,
    };
}
