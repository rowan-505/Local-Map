/** Detect validation-phase failures (not promotion-phase). */

export function publishItemErrorCodeFromAfterData(afterData: unknown): string | null {
    if (!afterData || typeof afterData !== "object" || Array.isArray(afterData)) {
        return null;
    }
    const code = (afterData as Record<string, unknown>).error_code;
    return typeof code === "string" && code.trim() ? code.trim() : null;
}

export function isValidationTerminalErrorCode(errorCode: string | null | undefined): boolean {
    if (!errorCode?.trim()) {
        return false;
    }
    const code = errorCode.trim().toUpperCase();
    return code === "VALIDATION_SYSTEM_ERROR" || code.startsWith("VALIDATION_");
}

const PROMOTION_PHASE_STATUSES = new Set([
    "promotion_failed",
    "promoted",
    "partially_promoted",
    "partial",
    "promoting",
]);

export function isPublishBatchValidationSystemFailure(input: {
    batchStatus: string;
    promotionStatus?: string | null;
    publishItemSuccessCount?: number;
    publishItemFailedCount?: number;
    summary?: Record<string, unknown> | null;
    publishItemFailedErrorCodes?: readonly (string | null | undefined)[];
}): boolean {
    const batchStatus = input.batchStatus.trim().toLowerCase();
    if (batchStatus !== "failed") {
        return false;
    }
    const promotionStatus = (input.promotionStatus ?? "").trim().toLowerCase();
    if (PROMOTION_PHASE_STATUSES.has(promotionStatus)) {
        return false;
    }
    if ((input.publishItemSuccessCount ?? 0) > 0) {
        return false;
    }

    const summary = input.summary ?? null;
    if (summary && typeof summary.validation_error === "string" && summary.validation_error.trim()) {
        return true;
    }

    for (const code of input.publishItemFailedErrorCodes ?? []) {
        if (isValidationTerminalErrorCode(code)) {
            return true;
        }
    }

    // Batch failed before any promotion attempt (e.g. validation SQL crash).
    return (input.publishItemFailedCount ?? 0) > 0;
}

export function publishBatchValidationFailureHeadline(
    validationSystemFailure: boolean
): string {
    return validationSystemFailure ? "Validation failed" : "Promotion failed";
}

export function publishBatchValidationSystemFailureMessage(): string {
    return "Validation system error. Items were released for retry.";
}

export function publishBatchClosedFailureMessage(input: {
    batchStatus: string;
    validationSystemFailure: boolean;
}): string {
    if (input.validationSystemFailure) {
        return "Validation failed on this batch. Items were released for retry — fix data or create a new batch.";
    }
    return "This batch failed and is closed. Create a new retry batch.";
}
