import type { PromotablePublishEntityFamily } from "./import-review-promotion-config.js";
import { promotionStageLabelForFamily } from "./import-review-promotion-promote-api.js";
import {
    PROMOTION_STAGE_FINAL,
    PROMOTION_STAGE_MARK_IMPORTED,
    PROMOTION_STAGE_PREFLIGHT,
    PROMOTION_STAGE_UPDATE_SUMMARY,
    PROMOTION_STAGE_VERIFY_CORE,
    type PromotionStagePlan,
} from "./import-review-promotion-promote-stages.js";
import type { PublishStageStatus } from "./import-review-promotion-stage-status.js";

export type PromotionStageLogSnapshot = {
    stage_key: string;
    stage_status: string;
    finished_at: unknown;
    message?: string | null;
};

export type PromotionStageReconcileUpdate = {
    stageKey: string;
    stageStatus: PublishStageStatus;
    message: string;
    progressPercent: number;
    finished: true;
};

const TERMINAL_BATCH_STATUSES = new Set(["promoted", "partial", "failed"]);

export function isUnsettledPromotionStageStatus(status: string): boolean {
    return status === "pending" || status === "running";
}

export function isTerminalPromotionBatchStatus(status: string): boolean {
    return TERMINAL_BATCH_STATUSES.has(status);
}

export function hasUnsettledPromotionStageLogs(
    logs: ReadonlyArray<PromotionStageLogSnapshot>,
    stagePlan: PromotionStagePlan
): boolean {
    const planned = new Set(stagePlan.stages.map((s) => s.key));
    return logs.some(
        (log) =>
            planned.has(log.stage_key) && isUnsettledPromotionStageStatus(log.stage_status)
    );
}

function familyFromPromoteStageKey(stageKey: string): PromotablePublishEntityFamily | null {
    const match = /^promote_(.+)_to_core$/.exec(stageKey);
    if (!match?.[1]) {
        return null;
    }
    return match[1] as PromotablePublishEntityFamily;
}

function formatFamilyPromotedMessage(entityFamily: string, count: number): string {
    const label = promotionStageLabelForFamily(entityFamily as PromotablePublishEntityFamily)
        .replace(/^Promote /i, "")
        .toLowerCase();
    const unit = count === 1 ? label.replace(/s$/, "") : label;
    return `Promoted ${count} ${unit} item(s).`;
}

/**
 * Build stage-log updates for any planned promotion stage still pending/running after the run ends.
 */
export function buildPromotionStageReconcileUpdates(
    stagePlan: PromotionStagePlan,
    logs: ReadonlyArray<PromotionStageLogSnapshot>,
    args: {
        batchStatus: string;
        failedStageKey?: string | null;
        failureMessage?: string | null;
        promotionLogsSummary?: string | null;
        familyPromotedCounts?: Readonly<Record<string, number>>;
    }
): PromotionStageReconcileUpdate[] {
    if (!isTerminalPromotionBatchStatus(args.batchStatus)) {
        return [];
    }

    const logsByKey = new Map(logs.map((log) => [log.stage_key, log]));
    const failedStageKey = args.failedStageKey ?? null;
    const failedIndex = failedStageKey
        ? stagePlan.stages.findIndex((s) => s.key === failedStageKey)
        : -1;
    const batchFailed = args.batchStatus === "failed";
    const updates: PromotionStageReconcileUpdate[] = [];

    for (let index = 0; index < stagePlan.stages.length; index += 1) {
        const stage = stagePlan.stages[index]!;
        const log = logsByKey.get(stage.key);
        const status = log?.stage_status ?? "pending";
        if (!isUnsettledPromotionStageStatus(status)) {
            continue;
        }

        if (failedStageKey === stage.key) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "failed",
                message: args.failureMessage ?? log?.message ?? "Stage failed.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (batchFailed && failedIndex >= 0 && index > failedIndex) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "skipped",
                message: "Promotion failed before this stage completed.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (batchFailed) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "skipped",
                message: "Promotion failed before this stage completed.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        const family = familyFromPromoteStageKey(stage.key);
        if (family) {
            const count = args.familyPromotedCounts?.[family] ?? 0;
            updates.push({
                stageKey: stage.key,
                stageStatus: "success",
                message: formatFamilyPromotedMessage(family, count),
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (stage.key === PROMOTION_STAGE_PREFLIGHT) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "success",
                message: log?.message ?? "Preflight passed.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (stage.key === PROMOTION_STAGE_MARK_IMPORTED) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "success",
                message: log?.message ?? "Import-review candidates marked as promoted.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (stage.key === PROMOTION_STAGE_VERIFY_CORE) {
            updates.push({
                stageKey: stage.key,
                stageStatus: status === "running" ? "success" : "skipped",
                message: log?.message ?? "Core rows verified.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (stage.key === PROMOTION_STAGE_UPDATE_SUMMARY) {
            updates.push({
                stageKey: stage.key,
                stageStatus: "success",
                message: "Batch summary updated.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        if (stage.key === PROMOTION_STAGE_FINAL) {
            updates.push({
                stageKey: stage.key,
                stageStatus: batchFailed ? "failed" : "success",
                message: args.promotionLogsSummary ?? "Promotion completed.",
                progressPercent: stage.progressEnd,
                finished: true,
            });
            continue;
        }

        updates.push({
            stageKey: stage.key,
            stageStatus: "skipped",
            message: "Promotion finished without executing this stage.",
            progressPercent: stage.progressEnd,
            finished: true,
        });
    }

    return updates;
}
