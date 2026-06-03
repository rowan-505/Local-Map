/** Validation cancel / stale / heartbeat thresholds (milliseconds). */
export const IMPORT_REVIEW_VALIDATION_STALE_MS = 5 * 60 * 1000;
export const IMPORT_REVIEW_VALIDATION_HEARTBEAT_STALL_WARNING_MS = 2 * 60 * 1000;
/** Minimum interval between batch validation_heartbeat_at updates during long chunks. */
export const IMPORT_REVIEW_VALIDATION_HEARTBEAT_INTERVAL_MS = 12 * 1000;

export type ImportReviewValidationAbortReason = "cancelled" | "stale_worker";

export class ImportReviewPublishBatchValidationAbortedError extends Error {
    readonly name = "ImportReviewPublishBatchValidationAbortedError";

    constructor(
        public readonly batchId: string,
        public readonly reason: ImportReviewValidationAbortReason,
        message: string
    ) {
        super(message);
    }
}

export type ImportReviewValidationHeartbeatState = {
    validation_heartbeat_at: Date | null;
    validation_cancel_requested_at: Date | null;
};

export function parseIsoTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

export function heartbeatAnchorAt(
    batch: ImportReviewValidationHeartbeatState,
    stageLogHeartbeatIso: string | null
): Date | null {
    if (batch.validation_heartbeat_at) {
        return batch.validation_heartbeat_at;
    }
    return parseIsoTimestamp(stageLogHeartbeatIso);
}

export function isValidationHeartbeatStale(
    anchor: Date | null,
    nowMs: number = Date.now()
): boolean {
    if (!anchor) {
        return true;
    }
    return nowMs - anchor.getTime() > IMPORT_REVIEW_VALIDATION_STALE_MS;
}

export function isValidationHeartbeatStalled(
    anchor: Date | null,
    nowMs: number = Date.now()
): boolean {
    if (!anchor) {
        return true;
    }
    return nowMs - anchor.getTime() > IMPORT_REVIEW_VALIDATION_HEARTBEAT_STALL_WARNING_MS;
}

export function extractStageLogHeartbeatIso(details: unknown): string | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const last = (details as Record<string, unknown>).last_heartbeat_at;
    return typeof last === "string" ? last : null;
}
