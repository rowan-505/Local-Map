import { isImportReviewRoutingBarrierPromotionEnabled } from "./import-review-config.js";
import type {
    ImportReviewPromotionRoutingBarrierDryRunResult,
    RoutingBarrierDryRunItemResult,
    RoutingBarrierDryRunItemStatus,
    RoutingBarrierDryRunSampleItem,
} from "./import-review-promotion-routing-barrier-dry-run.types.js";

const SAMPLE_SIZE = 10;

const DUPLICATE_CODES = new Set(["DUPLICATE_NEARBY_BARRIER_RISK"]);
const NETWORK_CODES = new Set([
    "NO_NEARBY_CORE_ROAD",
    "NO_NEARBY_REVIEW_ROAD",
    "CORE_STREET_ID_MISSING",
    "FAR_FROM_ROUTABLE_NETWORK",
]);

function increment(map: Record<string, number>, code: string): void {
    map[code] = (map[code] ?? 0) + 1;
}

export function resolveRoutingBarrierDryRunStatus(
    blockers: string[],
    warnings: string[],
    includeWarnings: boolean
): RoutingBarrierDryRunItemStatus {
    if (blockers.length > 0) {
        return "blocked";
    }
    if (warnings.length === 0) {
        return "safe_to_promote";
    }
    return includeWarnings ? "promote_with_warning" : "needs_manual_review";
}

export function routingBarrierDryRunSampleItem(
    item: RoutingBarrierDryRunItemResult
): RoutingBarrierDryRunSampleItem {
    return {
        publish_item_id: item.publish_item_id,
        review_candidate_id: item.review_candidate_id,
        external_id: item.external_id,
        barrier_type: item.barrier_type,
        dry_run_status: item.dry_run_status,
        blocking_reasons: item.blocking_reasons,
        warning_codes: item.warning_codes,
        info_codes: item.info_codes,
    };
}

export function aggregateRoutingBarrierDryRunResult(args: {
    batchId: bigint;
    reviewBatchId: bigint | null;
    items: RoutingBarrierDryRunItemResult[];
}): ImportReviewPromotionRoutingBarrierDryRunResult {
    const byWarningCode: Record<string, number> = {};
    const byErrorCode: Record<string, number> = {};
    const byBarrierType: Record<string, number> = {};
    let safe = 0;
    let withWarning = 0;
    let manual = 0;
    let blocked = 0;
    let warningCount = 0;
    let errorCount = 0;
    let duplicateRisk = 0;
    let networkWarnings = 0;
    let wouldInsert = 0;
    let wouldUpdate = 0;

    for (const item of args.items) {
        if (item.dry_run_status === "safe_to_promote") safe += 1;
        if (item.dry_run_status === "promote_with_warning") withWarning += 1;
        if (item.dry_run_status === "needs_manual_review") manual += 1;
        if (item.dry_run_status === "blocked") blocked += 1;
        if (item.publish_action === "insert" && item.dry_run_status !== "blocked") wouldInsert += 1;
        if (item.publish_action === "update" && item.dry_run_status !== "blocked") wouldUpdate += 1;
        increment(byBarrierType, item.barrier_type?.trim() || "unknown");
        for (const code of item.warning_codes) {
            increment(byWarningCode, code);
            warningCount += 1;
        }
        for (const code of item.blocking_reasons) {
            increment(byErrorCode, code);
            errorCount += 1;
        }
        if (item.warning_codes.some((code) => DUPLICATE_CODES.has(code))) duplicateRisk += 1;
        if (item.warning_codes.some((code) => NETWORK_CODES.has(code))) networkWarnings += 1;
    }

    const blockedItems = args.items.filter((item) => item.dry_run_status === "blocked");
    const warningItems = args.items.filter(
        (item) =>
            item.dry_run_status === "promote_with_warning" ||
            item.dry_run_status === "needs_manual_review"
    );

    return {
        batch_id: args.batchId.toString(),
        review_batch_id: args.reviewBatchId?.toString() ?? null,
        total_count: args.items.length,
        safe_to_promote_count: safe,
        promote_with_warning_count: withWarning,
        needs_manual_review_count: manual,
        blocked_count: blocked,
        warning_count: warningCount,
        error_count: errorCount,
        duplicate_risk_count: duplicateRisk,
        network_warning_count: networkWarnings,
        would_insert_count: wouldInsert,
        would_update_count: wouldUpdate,
        by_warning_code: byWarningCode,
        by_error_code: byErrorCode,
        by_barrier_type: byBarrierType,
        sample_blocked_items: blockedItems.slice(0, SAMPLE_SIZE).map(routingBarrierDryRunSampleItem),
        sample_warning_items: warningItems.slice(0, SAMPLE_SIZE).map(routingBarrierDryRunSampleItem),
        disabled_because_env_flag_false: !isImportReviewRoutingBarrierPromotionEnabled(),
        items: args.items,
        finished_at: new Date().toISOString(),
        message: "Routing barrier dry-run complete. No routing graph rows were changed.",
    };
}
