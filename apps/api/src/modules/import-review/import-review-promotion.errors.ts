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

export type ImportReviewPromotionSkippedReasonCount = {
    reason: string;
    count: number;
};

export type ImportReviewPromotionFamilySkipSummary = {
    entity_family: string;
    included: number;
    skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
};

export class ImportReviewPromotionNoEligibleCandidatesError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly readyCount: number,
        public readonly messageDetail: string,
        public readonly byFamily?: ImportReviewPromotionFamilySkipSummary[]
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

export class ImportReviewPublishBatchCreationTimeoutError extends Error {
    readonly statusCode = 504;

    constructor() {
        super(
            "Publish batch creation timed out. Try fewer entity families or smaller chunk size."
        );
        this.name = "ImportReviewPublishBatchCreationTimeoutError";
    }
}

export class ImportReviewPublishInvalidStageStatusError extends Error {
    readonly statusCode = 500;

    constructor(public readonly stageStatus: string) {
        super(
            `Invalid publish stage_status "${stageStatus}". Allowed values: pending, running, success, warning, failed, skipped.`
        );
        this.name = "ImportReviewPublishInvalidStageStatusError";
    }
}

export class ImportReviewRoadPromotionDisabledError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchId: string) {
        super(
            "Road promotion is disabled. Run road dry-run and enable ENABLE_IMPORT_REVIEW_ROAD_PROMOTION only after routing validation is stable."
        );
        this.name = "ImportReviewRoadPromotionDisabledError";
    }
}
