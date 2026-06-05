export class ImportReviewPromotionRoadDryRunNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchId: string) {
        super(`Road dry-run result not found for publish batch ${batchId}. Run POST road-dry-run first.`);
        this.name = "ImportReviewPromotionRoadDryRunNotFoundError";
    }
}

export class ImportReviewPromotionRoadDryRunNoItemsError extends Error {
    readonly statusCode = 400;

    constructor(public readonly batchId: string) {
        super(`Publish batch ${batchId} has no road publish items.`);
        this.name = "ImportReviewPromotionRoadDryRunNoItemsError";
    }
}

export class ImportReviewPromotionRoadDryRunValidationIncompleteError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly validationPercent: number
    ) {
        super(
            `Publish batch ${batchId} must complete validation (validation_percent=100) before road dry-run. Current: ${validationPercent}.`
        );
        this.name = "ImportReviewPromotionRoadDryRunValidationIncompleteError";
    }
}

export class ImportReviewPromotionRoadDryRunNoEligibleItemsError extends Error {
    readonly statusCode = 400;

    constructor(public readonly batchId: string) {
        super(
            `Publish batch ${batchId} has no pending ready road publish items to dry-run.`
        );
        this.name = "ImportReviewPromotionRoadDryRunNoEligibleItemsError";
    }
}
