/** Mirrors API stall warning threshold (2 minutes). */
export const IMPORT_REVIEW_VALIDATION_HEARTBEAT_STALL_WARNING_MS = 2 * 60 * 1000;

export function canCancelImportReviewPublishBatchValidation(status: string): boolean {
    return status === "validating";
}

export type ValidationResetEligibility = {
    heartbeatStaleWarning?: boolean;
    cancelRequested?: boolean;
};

export function canResetImportReviewPublishBatchValidation(
    status: string,
    options?: ValidationResetEligibility
): boolean {
    if (status === "promoted" || status === "promoting") {
        return false;
    }
    if (status === "validating") {
        return Boolean(options?.heartbeatStaleWarning || options?.cancelRequested);
    }
    return true;
}

export function formatValidationHeartbeatAt(iso: string | null | undefined): string | null {
    if (!iso) {
        return null;
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toLocaleString();
}
