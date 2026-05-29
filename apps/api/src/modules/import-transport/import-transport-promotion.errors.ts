export class ImportTransportPromotionBatchNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "PROMOTION_BATCH_NOT_FOUND";

    constructor(public readonly batchId: string) {
        super(`Import transport promotion batch not found: ${batchId}`);
        this.name = "ImportTransportPromotionBatchNotFoundError";
    }
}

export class ImportTransportPromotionInvalidModeError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "PROMOTION_INVALID_MODE";

    constructor(message: string) {
        super(message);
        this.name = "ImportTransportPromotionInvalidModeError";
    }
}

export class ImportTransportPromotionNoEligibleCandidatesError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_NO_ELIGIBLE_CANDIDATES";

    constructor(message = "No eligible candidates match the promotion batch criteria.") {
        super(message);
        this.name = "ImportTransportPromotionNoEligibleCandidatesError";
    }
}

export class ImportTransportPromotionBatchValidationConflictError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BATCH_VALIDATION_CONFLICT";

    constructor(
        public readonly batchId: string,
        message: string
    ) {
        super(message);
        this.name = "ImportTransportPromotionBatchValidationConflictError";
    }
}

export class ImportTransportPromotionBatchValidationInvalidStatusError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BATCH_VALIDATION_INVALID_STATUS";

    constructor(
        public readonly batchId: string,
        public readonly status: string
    ) {
        super(`Promotion batch ${batchId} cannot be validated while status is ${status}.`);
        this.name = "ImportTransportPromotionBatchValidationInvalidStatusError";
    }
}

export class ImportTransportPromotionBatchNotValidatedError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BATCH_NOT_VALIDATED";

    constructor(
        public readonly batchId: string,
        message: string
    ) {
        super(message);
        this.name = "ImportTransportPromotionBatchNotValidatedError";
    }
}

export class ImportTransportPromotionBatchPromotionInvalidStatusError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BATCH_INVALID_STATUS";

    constructor(
        public readonly batchId: string,
        public readonly status: string,
        message: string
    ) {
        super(message);
        this.name = "ImportTransportPromotionBatchPromotionInvalidStatusError";
    }
}

export class ImportTransportPromotionBatchPromotionConflictError extends Error {
    readonly statusCode = 409;
    readonly errorCode = "PROMOTION_BATCH_PROMOTION_CONFLICT";

    constructor(
        public readonly batchId: string,
        message: string
    ) {
        super(message);
        this.name = "ImportTransportPromotionBatchPromotionConflictError";
    }
}
