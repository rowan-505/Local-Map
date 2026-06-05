export const PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_ERROR_CODE = "not_batched";

export const PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE =
    "Batch lifecycle error: candidate was released before validation. Recreate or repair batch.";

export function publishBatchLifecycleErrorFromValidation(
    errorCode: string | null | undefined,
    fallbackMessage: string | null | undefined
): string | null {
    if (errorCode?.trim() === PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_ERROR_CODE) {
        return PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE;
    }
    return fallbackMessage ?? null;
}

export function validationErrorCodeFromItem(
    validationResult: unknown
): string | null {
    if (!validationResult || typeof validationResult !== "object" || Array.isArray(validationResult)) {
        return null;
    }
    const errors = (validationResult as Record<string, unknown>).errors;
    if (!Array.isArray(errors) || errors.length === 0) {
        return null;
    }
    const first = errors[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
        return null;
    }
    const code = (first as Record<string, unknown>).code;
    return typeof code === "string" && code.trim() ? code.trim() : null;
}
