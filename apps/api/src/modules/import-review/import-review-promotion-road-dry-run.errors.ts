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
