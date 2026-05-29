import type {
    ImportTransportPromotionBatchProgressRow,
    ImportTransportPromotionEntityValidationSummary,
} from "./import-transport-promotion-validation.types.js";
import {
    ImportTransportPromotionBlockedError,
    ImportTransportPromotionWarningConfirmationRequiredError,
} from "./import-transport-promotion-eligibility.js";
import {
    ImportTransportPromotionBatchNotValidatedError,
    ImportTransportPromotionBatchPromotionInvalidStatusError,
} from "./import-transport-promotion.errors.js";
import { ImportTransportValidationWarningNoteRequiredError } from "./import-transport.errors.js";

export type PromotionBatchItemGateRow = {
    item_validation_status: string;
    promotion_status: string;
};

export type PromoteBatchGateInput = {
    batch: ImportTransportPromotionBatchProgressRow & {
        promotion_status: string;
        summary: Record<string, unknown>;
    };
    items: PromotionBatchItemGateRow[];
    confirm_warnings: boolean;
    review_note?: string | null;
};

export function countItemValidationStatuses(items: PromotionBatchItemGateRow[]): {
    blocked: number;
    warning: number;
    skipped: number;
    pending: number;
    promotable: number;
} {
    let blocked = 0;
    let warning = 0;
    let skipped = 0;
    let pending = 0;
    let promotable = 0;

    for (const item of items) {
        const status = item.item_validation_status;
        if (status === "blocked") {
            blocked += 1;
        } else if (status === "warning") {
            warning += 1;
            promotable += 1;
        } else if (status === "skipped") {
            skipped += 1;
        } else if (status === "pending") {
            pending += 1;
        } else if (status === "valid") {
            promotable += 1;
        }
    }

    return { blocked, warning, skipped, pending, promotable };
}

export function assertBatchReadyForPromotion(input: PromoteBatchGateInput): void {
    const { batch, items, confirm_warnings, review_note } = input;

    if (!batch.validated_at) {
        throw new ImportTransportPromotionBatchNotValidatedError(
            batch.id,
            "Promotion batch must be validated before promotion."
        );
    }

    if (!batch.can_promote) {
        throw new ImportTransportPromotionBatchNotValidatedError(
            batch.id,
            "Promotion batch validation does not allow promotion (can_promote=false)."
        );
    }

    if (!["ready", "failed"].includes(batch.promotion_status)) {
        throw new ImportTransportPromotionBatchPromotionInvalidStatusError(
            batch.id,
            batch.promotion_status,
            "Batch must be in ready or failed status to start promotion."
        );
    }

    const counts = countItemValidationStatuses(items);
    if (counts.blocked > 0) {
        throw new ImportTransportPromotionBlockedError(
            "blocked",
            "Promotion is blocked because the batch contains blocked validation items."
        );
    }

    if (counts.pending > 0) {
        throw new ImportTransportPromotionBatchNotValidatedError(
            batch.id,
            "Promotion is blocked until all batch items are validated."
        );
    }

    if (counts.warning > 0) {
        if (!confirm_warnings) {
            throw new ImportTransportPromotionWarningConfirmationRequiredError();
        }
        if (!review_note?.trim()) {
            throw new ImportTransportValidationWarningNoteRequiredError(
                "A review note is required when promoting items with validation warnings."
            );
        }
    }
}

export function buildPromotionSummaryFromCounts(args: {
    promoted: number;
    failed: number;
    skipped: number;
    by_entity: ImportTransportPromotionEntityValidationSummary[];
    review_note?: string | null;
}): Record<string, unknown> {
    return {
        promotion_result: {
            promoted: args.promoted,
            failed: args.failed,
            skipped: args.skipped,
            finished_at: new Date().toISOString(),
            review_note: args.review_note?.trim() ?? null,
        },
        by_entity: args.by_entity,
    };
}
