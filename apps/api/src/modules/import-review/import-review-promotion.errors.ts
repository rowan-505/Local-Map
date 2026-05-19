export class ImportReviewPublishBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchId: string) {
        super(`Publish batch not found: ${batchId}`);
        this.name = "ImportReviewPublishBatchNotFoundError";
    }
}

export class ImportReviewPublishBatchNameConflictError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchName: string) {
        super(`Publish batch name already exists: ${batchName}`);
        this.name = "ImportReviewPublishBatchNameConflictError";
    }
}

export class ImportReviewPromotionNoEligibleCandidatesError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly readyCount: number,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPromotionNoEligibleCandidatesError";
    }
}

export class ImportReviewPublishBatchValidationConflictError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchValidationConflictError";
    }
}

export class ImportReviewPublishBatchInvalidStatusError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly batchId: string,
        public readonly status: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchInvalidStatusError";
    }
}

export class ImportReviewPublishBatchPromotionConflictError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchPromotionConflictError";
    }
}

export class ImportReviewPublishBatchPromotionConfirmationError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchPromotionConfirmationError";
    }
}
