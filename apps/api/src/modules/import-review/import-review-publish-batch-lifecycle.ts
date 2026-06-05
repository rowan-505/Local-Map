/** Publish batch statuses allowed by system_publish_batches_status_irr_chk (086-style). */

export const PUBLISH_BATCH_DB_STATUSES = [
    "draft",
    "validating",
    "ready",
    "partial",
    "promoting",
    "promoted",
    "failed",
    "blocked",
    "archived",
    "cancelled",
] as const;

export type PublishBatchDbStatus = (typeof PUBLISH_BATCH_DB_STATUSES)[number];

const DB_STATUS_SET = new Set<string>(PUBLISH_BATCH_DB_STATUSES);

/** Map stored or legacy API statuses to a DB-safe status for writes and comparisons. */
export function normalizePublishBatchStoredStatus(status: string): string {
    const s = status.trim().toLowerCase();
    if (DB_STATUS_SET.has(s)) {
        return s;
    }
    if (s === "validated" || s === "dry_run_passed" || s === "dry_run_running") {
        return "ready";
    }
    if (s === "partially_promoted") {
        return "partial";
    }
    return status;
}

/** @deprecated Alias for dashboard workflow helpers. */
export function normalizePublishBatchLifecycleStatus(status: string): string {
    return normalizePublishBatchStoredStatus(status);
}

export function isPublishBatchDbStatus(status: string): status is PublishBatchDbStatus {
    return DB_STATUS_SET.has(status.trim().toLowerCase());
}

export function batchStatusAllowsDryRun(status: string): boolean {
    const s = normalizePublishBatchStoredStatus(status);
    return s === "ready" || s === "partial";
}

export function batchStatusAllowsPromote(status: string): boolean {
    const s = normalizePublishBatchStoredStatus(status);
    return s === "ready" || s === "partial" || s === "blocked";
}

/** Terminal batches must not be reused for dry-run or promote. */
export const PUBLISH_BATCH_CLOSED_FOR_REUSE_STATUSES = new Set<PublishBatchDbStatus>([
    "failed",
    "promoted",
    "cancelled",
    "archived",
]);

export function isPublishBatchClosedForReuse(status: string): boolean {
    const s = normalizePublishBatchStoredStatus(status);
    return PUBLISH_BATCH_CLOSED_FOR_REUSE_STATUSES.has(s as PublishBatchDbStatus);
}

export function publishBatchClosedForReuseMessage(status: string): string {
    const s = normalizePublishBatchStoredStatus(status);
    if (s === "failed") {
        return "This batch failed and is closed. Create a new retry batch.";
    }
    if (s === "promoted") {
        return "This batch is already promoted and closed.";
    }
    return "This batch is closed and cannot be reused for promotion.";
}

export function canValidatePublishBatch(status: string): boolean {
    const s = normalizePublishBatchStoredStatus(status);
    return s === "draft" || s === "ready" || s === "partial";
}

/** @param actualPromotableCount pending publish items with validation_result ready/valid (warnings excluded). */
export function canDryRunPublishBatch(status: string, actualPromotableCount: number): boolean {
    if (isPublishBatchClosedForReuse(status)) {
        return false;
    }
    return batchStatusAllowsDryRun(status) && actualPromotableCount > 0;
}

export function canPromotePublishBatch(
    status: string,
    actualPromotableCount: number,
    dryRunPassed = false
): boolean {
    if (isPublishBatchClosedForReuse(status)) {
        return false;
    }
    return batchStatusAllowsPromote(status) && dryRunPassed && actualPromotableCount > 0;
}

export function shouldPollPublishBatchLifecycle(status: string): boolean {
    const s = normalizePublishBatchStoredStatus(status);
    return s === "validating" || s === "promoting";
}

export const PUBLISH_BATCH_POLL_TERMINAL_STATUSES = new Set([
    "ready",
    "partial",
    "promoted",
    "failed",
    "cancelled",
    "draft",
    "blocked",
    "archived",
]);
