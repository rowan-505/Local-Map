import {
    canDryRunPublishBatch,
    canPromotePublishBatch,
    canValidatePublishBatch,
    dryRunDisplayStatus,
    dryRunResultFromApiResponse,
    isPublishBatchClosedForReuse,
    normalizePublishBatchLifecycleStatus,
    publishBatchClosedForReuseMessage,
    publishBatchDryRunPassed,
    shouldPollPublishBatchLifecycle,
} from "@/src/features/import-review/promotion/publishBatchLifecycle";
import type { PublishBatchDryRunResult } from "@/src/features/import-review/promotion/publishBatchDryRun";

export {
    canDryRunPublishBatch,
    canPromotePublishBatch,
    canValidatePublishBatch,
    dryRunDisplayStatus,
    dryRunResultFromApiResponse,
    isPublishBatchClosedForReuse,
    normalizePublishBatchLifecycleStatus,
    publishBatchClosedForReuseMessage,
    publishBatchDryRunPassed,
    shouldPollPublishBatchLifecycle,
};

export function canPromotePublishBatchFromProgress(
    status: string,
    pendingReadyCount: number,
    dryRunResult: PublishBatchDryRunResult | null | undefined
): boolean {
    return canPromotePublishBatch(status, pendingReadyCount, dryRunResult);
}

export type PublishBatchSimpleCounts = {
    total: number;
    validationReady: number;
    validationBlocked: number;
    publishPending: number;
    publishFailed: number;
    publishPromoted: number;
    actualPromotable: number;
};

export function resolvePublishBatchSimpleCounts(args: {
    totalItems: number;
    validationReady?: number;
    validationBlocked?: number;
    publishPending?: number;
    publishFailed?: number;
    publishPromoted?: number;
    currentPromotable?: number;
}): PublishBatchSimpleCounts {
    return {
        total: Math.max(0, args.totalItems),
        validationReady: Math.max(0, args.validationReady ?? 0),
        validationBlocked: Math.max(0, args.validationBlocked ?? 0),
        publishPending: Math.max(0, args.publishPending ?? 0),
        publishFailed: Math.max(0, args.publishFailed ?? 0),
        publishPromoted: Math.max(0, args.publishPromoted ?? 0),
        actualPromotable: Math.max(0, args.currentPromotable ?? 0),
    };
}
