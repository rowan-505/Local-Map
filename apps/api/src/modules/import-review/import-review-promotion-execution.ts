import {
    canPromotePublishItem,
    parsePublishItemValidationResult,
    type PublishItemPromotionGateInput,
} from "./import-review-promotion-publish-item-validation.js";

export type PublishItemValidationRow = {
    publish_item_id: bigint;
    validation_result: unknown;
};

export type PublishItemPromotionSelection = {
    promotableIds: bigint[];
    skipped_blocked_count: number;
    skipped_warning_count: number;
    skipped_other_count: number;
};

/** Classify pending publish items for a promotion run (never includes blocked). */
export function classifyPublishItemsForPromotion(
    rows: readonly PublishItemValidationRow[],
    gate: PublishItemPromotionGateInput = {}
): PublishItemPromotionSelection {
    const promotableIds: bigint[] = [];
    let skipped_blocked_count = 0;
    let skipped_warning_count = 0;
    let skipped_other_count = 0;

    for (const row of rows) {
        if (canPromotePublishItem(row.validation_result, gate)) {
            promotableIds.push(row.publish_item_id);
            continue;
        }
        const parsed = parsePublishItemValidationResult(row.validation_result);
        if (parsed.status === "blocked") {
            skipped_blocked_count += 1;
        } else if (parsed.status === "warning") {
            skipped_warning_count += 1;
        } else {
            skipped_other_count += 1;
        }
    }

    return {
        promotableIds,
        skipped_blocked_count,
        skipped_warning_count,
        skipped_other_count,
    };
}

export type PromotionRunCounts = {
    promoted_count: number;
    failed_count: number;
    skipped_blocked_count: number;
    skipped_warning_count: number;
    pending_after_count: number;
    total_batch_items: number;
    system_error: boolean;
};

export {
    computePromotionRunFinalize,
    type PromotionRunFinalize,
} from "./import-review-promotion-batch-status.js";
