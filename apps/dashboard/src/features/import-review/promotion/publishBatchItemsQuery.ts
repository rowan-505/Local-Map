import type { ImportReviewHistoryPublishBatchItemsParams } from "@/src/lib/api";

/** Matches API `PUBLISH_BATCH_ITEMS_MAX_LIMIT` for failed-item detail panels. */
export const IMPORT_REVIEW_PUBLISH_BATCH_FAILED_ITEMS_LIMIT = 200;

export const PUBLISH_BATCH_ITEM_FILTER_OPTIONS = [
    "failed",
    "pending",
    "skipped",
    "promoted",
    "blocked",
    "skipped_blocked",
] as const;

/** Query params for the promotion failed-items panel (uses API-accepted filters only). */
export function buildPublishBatchFailedItemsQuery(): ImportReviewHistoryPublishBatchItemsParams {
    return {
        publish_status: "failed",
        limit: IMPORT_REVIEW_PUBLISH_BATCH_FAILED_ITEMS_LIMIT,
        offset: 0,
    };
}

/** Query params for validation-blocked publish items on the batch detail page. */
export function buildPublishBatchBlockedItemsQuery(): ImportReviewHistoryPublishBatchItemsParams {
    return {
        publish_status: "blocked",
        limit: IMPORT_REVIEW_PUBLISH_BATCH_FAILED_ITEMS_LIMIT,
        offset: 0,
    };
}
