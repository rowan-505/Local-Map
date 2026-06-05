import type {
    ImportReviewPromotionRoadDryRunResult,
    RoadDryRunItemResult,
    RoadDryRunItemStatus,
    RoadDryRunSampleItem,
} from "./import-review-promotion-road-dry-run.types.js";
import { isImportReviewRoadPromotionEnabled } from "./import-review-config.js";

export const MAX_ROAD_LENGTH_M = 50_000;
export const ROAD_DRY_RUN_SAMPLE_SIZE = 10;

export const DUPLICATE_RISK_CODES = new Set([
    "POSSIBLE_DUPLICATE_CORE_ROAD",
    "POSSIBLE_DUPLICATE_REVIEW_ROAD",
    "DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH",
    "DUPLICATE_EXTERNAL_ID_IN_CORE",
    "LIKELY_NAME_CLASS_DUPLICATE",
]);

export const CONNECTIVITY_WARNING_CODES = new Set([
    "START_ENDPOINT_ISOLATED",
    "END_ENDPOINT_ISOLATED",
    "ROAD_ISLAND",
    "IMPORTANT_ROAD_ISOLATED",
    "POSSIBLE_UNSNAPPED_ENDPOINT",
    "NO_CANDIDATE_CONNECTIONS",
    "CANDIDATE_NETWORK_ISLAND",
]);

export const INFO_CODES = new Set([
    "NEW_REGION_NO_CORE_ROADS",
    "CROSSING_ALLOWED_BY_LAYER",
    "SPEED_KPH_MISSING",
]);

export function resolveItemStatus(
    blockingReasons: string[],
    warningCodes: string[],
    _includeWarnings: boolean
): RoadDryRunItemStatus {
    if (blockingReasons.length > 0) {
        return "blocked";
    }
    if (warningCodes.length === 0) {
        return "safe_to_promote";
    }
    return "promote_with_warning";
}

export function toSampleItem(item: RoadDryRunItemResult): RoadDryRunSampleItem {
    return {
        publish_item_id: item.publish_item_id,
        review_candidate_id: item.review_candidate_id,
        external_id: item.external_id,
        canonical_name: item.canonical_name,
        dry_run_status: item.dry_run_status,
        blocking_reasons: item.blocking_reasons,
        warning_codes: item.warning_codes,
        info_codes: item.info_codes,
    };
}

export function incrementCount(map: Record<string, number>, code: string): void {
    map[code] = (map[code] ?? 0) + 1;
}

export function aggregateRoadDryRunResult(args: {
    batchId: bigint;
    reviewBatchId: bigint | null;
    items: RoadDryRunItemResult[];
}): ImportReviewPromotionRoadDryRunResult {
    const { batchId, reviewBatchId, items } = args;

    let safeToPromote = 0;
    let promoteWithWarning = 0;
    let needsManualReview = 0;
    let blocked = 0;
    let duplicateRisk = 0;
    let connectivityWarning = 0;
    let unsplitIntersection = 0;
    let wouldInsert = 0;
    let wouldUpdate = 0;
    let totalWarnings = 0;
    let totalErrors = 0;

    const byWarningCode: Record<string, number> = {};
    const byErrorCode: Record<string, number> = {};
    const byRoadClass: Record<string, number> = {};

    for (const item of items) {
        switch (item.dry_run_status) {
            case "safe_to_promote":
                safeToPromote += 1;
                break;
            case "promote_with_warning":
                promoteWithWarning += 1;
                break;
            case "needs_manual_review":
                needsManualReview += 1;
                break;
            case "blocked":
                blocked += 1;
                break;
        }

        if (item.publish_action === "insert" && item.dry_run_status !== "blocked") {
            wouldInsert += 1;
        }
        if (item.publish_action === "update" && item.dry_run_status !== "blocked") {
            wouldUpdate += 1;
        }

        for (const code of item.warning_codes) {
            incrementCount(byWarningCode, code);
            totalWarnings += 1;
        }
        for (const code of item.blocking_reasons) {
            incrementCount(byErrorCode, code);
            totalErrors += 1;
        }

        const roadClassKey = item.routing_summary?.road_class_code?.trim() || "unknown";
        incrementCount(byRoadClass, roadClassKey);

        if (
            item.warning_codes.some((c) => DUPLICATE_RISK_CODES.has(c)) ||
            item.duplicate_summary?.duplicate_core_external_id ||
            item.duplicate_summary?.likely_name_class_duplicate
        ) {
            duplicateRisk += 1;
        }
        if (item.warning_codes.some((c) => CONNECTIVITY_WARNING_CODES.has(c))) {
            connectivityWarning += 1;
        }
        if (item.warning_codes.includes("POSSIBLE_UNSPLIT_INTERSECTION")) {
            unsplitIntersection += 1;
        }
    }

    const blockedItems = items.filter((i) => i.dry_run_status === "blocked");
    const warningItems = items.filter(
        (i) =>
            i.dry_run_status === "promote_with_warning" ||
            i.dry_run_status === "needs_manual_review"
    );

    return {
        batch_id: batchId.toString(),
        review_batch_id: reviewBatchId?.toString() ?? null,
        total_count: items.length,
        safe_to_promote_count: safeToPromote,
        promote_with_warning_count: promoteWithWarning,
        needs_manual_review_count: needsManualReview,
        blocked_count: blocked,
        warning_count: totalWarnings,
        error_count: totalErrors,
        duplicate_risk_count: duplicateRisk,
        connectivity_warning_count: connectivityWarning,
        unsplit_intersection_count: unsplitIntersection,
        would_insert_count: wouldInsert,
        would_update_count: wouldUpdate,
        by_warning_code: byWarningCode,
        by_error_code: byErrorCode,
        by_road_class: byRoadClass,
        sample_blocked_items: blockedItems.slice(0, ROAD_DRY_RUN_SAMPLE_SIZE).map(toSampleItem),
        sample_warning_items: warningItems.slice(0, ROAD_DRY_RUN_SAMPLE_SIZE).map(toSampleItem),
        disabled_because_env_flag_false: !isImportReviewRoadPromotionEnabled(),
        items,
        finished_at: new Date().toISOString(),
        message: "Road dry-run complete. No core rows were written.",
    };
}
