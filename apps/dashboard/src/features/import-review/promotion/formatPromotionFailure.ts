import type {
    ImportReviewHistoryPublishBatchItem,
    ImportReviewPromotionFailureSample,
} from "@/src/lib/api";

export type PromotionFailureRow = {
    publish_item_id: string;
    entity_family: string;
    review_candidate_id: string | null;
    external_id: string | null;
    target_table: string | null;
    error_code: string;
    error_message: string;
    technical_detail: Record<string, unknown> | null;
};

function targetTableLabel(
    targetSchema: string | null | undefined,
    targetTable: string | null | undefined
): string | null {
    if (!targetTable) {
        return null;
    }
    if (targetTable.includes(".")) {
        return targetTable;
    }
    if (targetSchema) {
        return `${targetSchema}.${targetTable}`;
    }
    return targetTable;
}

export function promotionFailureRowFromSample(
    sample: ImportReviewPromotionFailureSample
): PromotionFailureRow {
    return {
        publish_item_id: sample.publish_item_id,
        entity_family: sample.entity_family,
        review_candidate_id: sample.review_candidate_id,
        external_id: sample.external_id,
        target_table: targetTableLabel(sample.target_schema, sample.target_table),
        error_code: sample.error_code,
        error_message: sample.error_message || sample.reason,
        technical_detail: null,
    };
}

export function promotionFailureRowFromHistoryItem(
    item: ImportReviewHistoryPublishBatchItem
): PromotionFailureRow {
    const afterData =
        item.after_data && typeof item.after_data === "object" && !Array.isArray(item.after_data)
            ? (item.after_data as Record<string, unknown>)
            : null;
    const errorDetail =
        afterData?.error_detail &&
        typeof afterData.error_detail === "object" &&
        !Array.isArray(afterData.error_detail)
            ? (afterData.error_detail as Record<string, unknown>)
            : null;
    const legacyRaw =
        typeof afterData?.error === "string" && afterData.error.trim() ? afterData.error.trim() : null;
    const rawFromDetail =
        typeof errorDetail?.raw_message === "string" && errorDetail.raw_message.trim()
            ? errorDetail.raw_message.trim()
            : legacyRaw;

    const error_code =
        typeof afterData?.error_code === "string" && afterData.error_code.trim()
            ? afterData.error_code.trim()
            : inferErrorCode(item.error_message ?? rawFromDetail);
    const error_message =
        typeof afterData?.error_message === "string" && afterData.error_message.trim()
            ? afterData.error_message.trim()
            : sanitizeOperatorMessage(item.error_message ?? rawFromDetail);

    const technical_detail: Record<string, unknown> | null = afterData
        ? {
              ...afterData,
              ...(rawFromDetail ? { raw_message: rawFromDetail } : {}),
          }
        : rawFromDetail
          ? { raw_message: rawFromDetail }
          : null;

    return {
        publish_item_id: item.id,
        entity_family: item.entity_family,
        review_candidate_id: item.review_candidate_id,
        external_id: item.external_id,
        target_table: targetTableLabel(item.target_schema, item.target_table),
        error_code,
        error_message,
        technical_detail,
    };
}

function inferErrorCode(message: string | null): string {
    if (!message?.trim()) {
        return "PROMOTION_FAILED";
    }
    const trimmed = message.trim();
    if (/this\.prisma\.\$transaction is not a function/i.test(trimmed)) {
        return "PROMOTION_SYSTEM_ERROR";
    }
    if (/^Place promotion failed:\s*/i.test(trimmed)) {
        return inferErrorCode(trimmed.replace(/^Place promotion failed:\s*/i, "").trim());
    }
    const match = /^([A-Z][A-Z0-9_]+):/.exec(trimmed);
    return match?.[1] ?? "PROMOTION_FAILED";
}

export function sanitizeOperatorMessage(message: string | null): string {
    if (!message?.trim()) {
        return "Promotion failed.";
    }
    const text = message.trim();
    if (/prisma\.|is not a function|invocation in/i.test(text)) {
        return "Promotion system error while writing to the database.";
    }
    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : text;
}

export function mergePromotionFailureRows(
    samples: readonly ImportReviewPromotionFailureSample[],
    historyItems: readonly ImportReviewHistoryPublishBatchItem[]
): PromotionFailureRow[] {
    const byId = new Map<string, PromotionFailureRow>();
    for (const sample of samples) {
        byId.set(sample.publish_item_id, promotionFailureRowFromSample(sample));
    }
    for (const item of historyItems) {
        if (item.publish_status !== "failed") {
            continue;
        }
        const row = promotionFailureRowFromHistoryItem(item);
        const existing = byId.get(row.publish_item_id);
        byId.set(row.publish_item_id, {
            ...row,
            technical_detail: row.technical_detail ?? existing?.technical_detail ?? null,
        });
    }
    return [...byId.values()].sort((a, b) => a.publish_item_id.localeCompare(b.publish_item_id));
}
