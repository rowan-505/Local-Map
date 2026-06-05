import type { ImportReviewBuildingListItem } from "@/src/lib/api";

export const IMPORT_REVIEW_PROMOTION_STATE_OPTIONS = [
    { value: "all_active", label: "All active" },
    { value: "ready_not_ready", label: "Ready / not_ready" },
    { value: "retry_needed", label: "Retry needed" },
    { value: "active_locked", label: "Active locked" },
    { value: "promoted", label: "Promoted" },
] as const;

export type ImportReviewPromotionStateFilter =
    (typeof IMPORT_REVIEW_PROMOTION_STATE_OPTIONS)[number]["value"];

export function readPromotionStateFromSearchParams(
    sp: URLSearchParams
): ImportReviewPromotionStateFilter {
    const raw = sp.get("promotion_state")?.trim();
    if (
        raw === "ready_not_ready" ||
        raw === "retry_needed" ||
        raw === "active_locked" ||
        raw === "promoted"
    ) {
        return raw;
    }
    if (sp.get("retry_needed") === "true" || sp.get("retry_needed") === "1") {
        return "retry_needed";
    }
    if (sp.get("include_promoted") === "true" || sp.get("include_promoted") === "1") {
        return "promoted";
    }
    return "all_active";
}

export function isCandidateRetryNeeded(row: ImportReviewBuildingListItem): boolean {
    if ((row.promotion_status ?? "").trim().toLowerCase() === "promoted") {
        return false;
    }
    if (row.promotion_retry_needed === true) {
        return true;
    }
    const reviewStatus = (row.review_status ?? "").trim().toLowerCase();
    const promotionStatus = (row.promotion_status ?? "").trim().toLowerCase();
    if (promotionStatus === "failed" || reviewStatus === "promotion_failed") {
        return true;
    }
    return Boolean(row.latest_promotion_failure_message?.trim());
}

export function isCandidateActiveLockedBatched(row: ImportReviewBuildingListItem): boolean {
    return (
        (row.promotion_status ?? "").trim().toLowerCase() === "batched" &&
        !isCandidateRetryNeeded(row)
    );
}
