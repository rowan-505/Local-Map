export class ImportReviewCleanupDisabledError extends Error {
    readonly statusCode = 403;

    constructor() {
        super(
            "Permanent import_review cleanup is disabled. Set ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true to enable execute."
        );
        this.name = "ImportReviewCleanupDisabledError";
    }
}

export class ImportReviewCleanupConfirmationError extends Error {
    readonly statusCode = 400;

    constructor(messageDetail: string) {
        super(messageDetail);
        this.name = "ImportReviewCleanupConfirmationError";
    }
}

export class ImportReviewCleanupNoEligibleRowsError extends Error {
    readonly statusCode = 400;

    constructor() {
        super("No eligible promoted import_review rows to delete for the given scope.");
        this.name = "ImportReviewCleanupNoEligibleRowsError";
    }
}

export class ImportReviewCleanupReviewBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly reviewBatchId: string) {
        super(`Review batch not found: ${reviewBatchId}`);
        this.name = "ImportReviewCleanupReviewBatchNotFoundError";
    }
}

export class ImportReviewCleanupPublishBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly publishBatchId: string) {
        super(`Publish batch not found: ${publishBatchId}`);
        this.name = "ImportReviewCleanupPublishBatchNotFoundError";
    }
}
