import type { ImportReviewHistoryPublishBatchItem } from "@/src/lib/api";

import { promotionFailureRowFromHistoryItem, type PromotionFailureRow } from "./formatPromotionFailure";

export function validationStatusFromPublishItem(
    validationResult: unknown
): string | null {
    if (!validationResult || typeof validationResult !== "object" || Array.isArray(validationResult)) {
        return null;
    }
    const status = (validationResult as Record<string, unknown>).status;
    return typeof status === "string" && status.trim() ? status.trim() : null;
}

export function publishItemErrorDetailJson(item: ImportReviewHistoryPublishBatchItem): unknown {
    const afterData =
        item.after_data && typeof item.after_data === "object" && !Array.isArray(item.after_data)
            ? (item.after_data as Record<string, unknown>)
            : null;
    if (afterData?.error_detail && typeof afterData.error_detail === "object") {
        return afterData.error_detail;
    }
    if (afterData && Object.keys(afterData).length > 0) {
        return afterData;
    }
    return item.error_message ? { message: item.error_message } : null;
}

export type PublishBatchFailedItemDetailRow = PromotionFailureRow & {
    publish_status: string;
    validation_status: string | null;
    error_detail_json: unknown;
};

export function publishBatchFailedItemDetailRow(
    item: ImportReviewHistoryPublishBatchItem
): PublishBatchFailedItemDetailRow {
    const base = promotionFailureRowFromHistoryItem(item);
    return {
        ...base,
        publish_status: item.publish_status,
        validation_status: validationStatusFromPublishItem(item.validation_result),
        error_detail_json: publishItemErrorDetailJson(item),
    };
}
