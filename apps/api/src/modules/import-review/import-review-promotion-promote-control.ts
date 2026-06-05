import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import {
    isPromotionHeartbeatStale,
    type ImportReviewPromotionAbortReason,
} from "./import-review-promotion-promote-progress.js";

export function isImportReviewPromotionWorkerRunning(
    batchId: bigint,
    runningBatchIds: ReadonlySet<bigint>
): boolean {
    return runningBatchIds.has(batchId);
}

export async function recoverStalePromotionBatchIfNeeded(args: {
    batchId: bigint;
    batchStatus: string;
    summary: unknown;
    workerInProcess: boolean;
    repo: ImportReviewPromotionPromoteRepository;
}): Promise<{ recovered: boolean; reason: ImportReviewPromotionAbortReason | null }> {
    if (args.batchStatus !== "promoting" || args.workerInProcess) {
        return { recovered: false, reason: null };
    }
    const anchor = args.repo.parsePromotionHeartbeatAnchor(args.summary);
    if (!isPromotionHeartbeatStale(anchor)) {
        return { recovered: false, reason: null };
    }
    await args.repo.finalizePromotionAborted({
        batchId: args.batchId,
        reason: "stale_worker",
        message:
            "Promotion stopped: no worker heartbeat (stale_worker). Use reset-promotion to try again.",
    });
    return { recovered: true, reason: "stale_worker" };
}
