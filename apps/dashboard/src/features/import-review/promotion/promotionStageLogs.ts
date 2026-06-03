import type { ImportReviewPublishStageLogItem } from "@/src/lib/api";

const PROMOTION_STAGE_KEY_PREFIXES = [
    "promote_preflight",
    "promote_",
    "mark_import_review_promoted",
    "verify_core_rows",
    "update_batch_summary",
    "promotion_final_response",
] as const;

export function isPromotionStageLogKey(stageKey: string): boolean {
    return PROMOTION_STAGE_KEY_PREFIXES.some(
        (prefix) => stageKey === prefix || stageKey.startsWith(prefix)
    );
}

export function filterPromotionStageLogs<T extends { stage_key: string }>(items: T[]): T[] {
    return items.filter((item) => isPromotionStageLogKey(item.stage_key));
}

export function hasUnsettledPromotionStageLogs(
    items: ReadonlyArray<Pick<ImportReviewPublishStageLogItem, "stage_status" | "stage_key">>
): boolean {
    return filterPromotionStageLogs([...items]).some(
        (item) => item.stage_status === "pending" || item.stage_status === "running"
    );
}

export function sortPromotionStageLogs<T extends { progress_percent?: number; started_at: string }>(
    items: T[]
): T[] {
    return [...items].sort((a, b) => {
        const progressDiff = (a.progress_percent ?? 0) - (b.progress_percent ?? 0);
        if (progressDiff !== 0) {
            return progressDiff;
        }
        return a.started_at.localeCompare(b.started_at);
    });
}
