import {
    isRoadApiBulkPromotionEnabled,
    ROAD_API_BULK_PROMOTION_PUBLIC_ENV,
} from "./roadBulkPromotionUx";
import { publishBatchDryRunPassed, type PublishBatchDryRunResult } from "./publishBatchDryRun";
import { normalizePublishBatchLifecycleStatus } from "./publishBatchLifecycle";

export type PromoteGate = {
    canPromote: boolean;
    reason: string | null;
};

const PROMOTABLE_STATUSES = new Set(["ready", "partial", "dry_run_passed"]);

const HIGH_RISK_PROMOTE_FAMILIES = new Set([
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
]);

const LARGE_BATCH_ITEM_THRESHOLD = 200;

export type PublishBatchPromoteGateInput = {
    batchId: string;
    status: string;
    validationPercent: number;
    dryRunResult?: PublishBatchDryRunResult | null;
    promotableNow: number;
    totalItems: number;
    families: readonly string[];
    busy: boolean;
    highRiskConfirmed: boolean;
    largeBatchConfirmed: boolean;
};

export function isRoadPromoteBatch(families: readonly string[]): boolean {
    return families.includes("roads");
}

export function isHighRiskPromoteBatch(families: readonly string[]): boolean {
    return families.some((f) => HIGH_RISK_PROMOTE_FAMILIES.has(f));
}

export function isLargePromoteBatch(promotableNow: number, totalItems: number): boolean {
    return promotableNow > LARGE_BATCH_ITEM_THRESHOLD || totalItems > LARGE_BATCH_ITEM_THRESHOLD;
}

export function validationPassedForPromote(status: string, validationPercent: number): boolean {
    const normalized = normalizePublishBatchLifecycleStatus(status);
    const statusOk =
        PROMOTABLE_STATUSES.has(status.trim().toLowerCase()) ||
        PROMOTABLE_STATUSES.has(normalized);
    return validationPercent >= 100 && statusOk;
}

export function getPublishBatchPromoteGate(input: PublishBatchPromoteGateInput): PromoteGate {
    const validationPassed = validationPassedForPromote(
        input.status,
        input.validationPercent
    );
    const dryRunPassed = publishBatchDryRunPassed(input.dryRunResult ?? null);
    const isRoadBatch = isRoadPromoteBatch(input.families);
    const isHighRiskBatch = isHighRiskPromoteBatch(input.families);
    const isLargeBatch = isLargePromoteBatch(input.promotableNow, input.totalItems);
    const lifecycle = normalizePublishBatchLifecycleStatus(input.status);
    const readyCount = input.promotableNow;

    let reason: string | null = null;

    if (input.busy) {
        reason =
            lifecycle === "promoting"
                ? "Promotion already running."
                : "Another action is running. Wait for it to finish.";
    } else if (!validationPassed) {
        reason = "Run validation first.";
    } else if (input.promotableNow <= 0) {
        reason = "No pending ready items to promote.";
    } else if (isRoadBatch && !dryRunPassed) {
        reason = "Run dry-run first.";
    } else if (isHighRiskBatch && !input.highRiskConfirmed) {
        reason = "Check high-risk confirmation.";
    } else if (isLargeBatch && !input.largeBatchConfirmed) {
        reason = "Check large-batch confirmation.";
    }

    const canPromote = reason === null;

    return { canPromote, reason };
}

export function envRoadPromotionEnabledForUi(): boolean {
    return process.env.NEXT_PUBLIC_ENABLE_IMPORT_REVIEW_ROAD_PROMOTION === "true";
}

export function logPublishBatchPromoteGateDebug(
    input: PublishBatchPromoteGateInput,
    gate: PromoteGate
): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    const validationPassed = validationPassedForPromote(
        input.status,
        input.validationPercent
    );
    const dryRunPassed = publishBatchDryRunPassed(input.dryRunResult ?? null);
    console.debug("[publish-batch] promote gate", {
        batchId: input.batchId,
        readyCount: input.promotableNow,
        isRoadBatch: isRoadPromoteBatch(input.families),
        dryRunPassed,
        envRoadPromotion: envRoadPromotionEnabledForUi(),
        envRoadBulkPromotion: isRoadApiBulkPromotionEnabled(),
        envRoadBulkPromotionVar: ROAD_API_BULK_PROMOTION_PUBLIC_ENV,
        allowHighRisk: input.highRiskConfirmed,
        confirmLargeBatch: input.largeBatchConfirmed,
        canPromote: gate.canPromote,
        reason: gate.reason,
    });
}
