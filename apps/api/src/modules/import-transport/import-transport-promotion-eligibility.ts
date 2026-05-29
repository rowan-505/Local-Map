import type { ImportTransportCandidateValidationStatus } from "./import-transport-validation.types.js";

export class ImportTransportPromotionBlockedError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BLOCKED";

    constructor(
        public readonly validationStatus: string,
        message = "Promotion is blocked until validation errors are resolved."
    ) {
        super(message);
        this.name = "ImportTransportPromotionBlockedError";
    }
}

export class ImportTransportPromotionWarningConfirmationRequiredError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_WARNING_CONFIRMATION_REQUIRED";

    constructor(
        message = "Promotion requires confirmation and a review note when validation warnings are present."
    ) {
        super(message);
        this.name = "ImportTransportPromotionWarningConfirmationRequiredError";
    }
}

export function assertCandidateEligibleForPromotion(input: {
    validation_status: string | null | undefined;
    review_note?: string | null | undefined;
}): void {
    const status = (input.validation_status ?? "not_validated").trim().toLowerCase();

    if (status === "blocked") {
        throw new ImportTransportPromotionBlockedError(status);
    }

    if (status === "not_validated") {
        throw new ImportTransportPromotionBlockedError(
            status,
            "Promotion is blocked until the candidate has been validated."
        );
    }

    if (status === "warning" && !input.review_note?.trim()) {
        throw new ImportTransportPromotionWarningConfirmationRequiredError();
    }
}

export function isPromotionAllowedValidationStatus(
    status: ImportTransportCandidateValidationStatus | string | null | undefined,
    reviewNote?: string | null
): boolean {
    try {
        assertCandidateEligibleForPromotion({
            validation_status: status,
            review_note: reviewNote,
        });
        return true;
    } catch {
        return false;
    }
}
