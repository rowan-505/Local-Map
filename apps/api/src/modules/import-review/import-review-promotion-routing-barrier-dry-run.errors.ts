export class ImportReviewPromotionRoutingBarrierDryRunNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchId: string) {
        super(`Routing barrier dry-run result not found for publish batch ${batchId}. Run POST routing-barrier-dry-run first.`);
        this.name = "ImportReviewPromotionRoutingBarrierDryRunNotFoundError";
    }
}

export class ImportReviewPromotionRoutingBarrierDryRunNoItemsError extends Error {
    readonly statusCode = 400;

    constructor(public readonly batchId: string) {
        super(`Publish batch ${batchId} has no routing barrier publish items.`);
        this.name = "ImportReviewPromotionRoutingBarrierDryRunNoItemsError";
    }
}
