export class ImportTransportHistoryImportBatchNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "IMPORT_BATCH_NOT_FOUND";

    constructor(public readonly batchId: string) {
        super(`Import transport import batch not found: ${batchId}`);
        this.name = "ImportTransportHistoryImportBatchNotFoundError";
    }
}

export class ImportTransportHistoryPromotionBatchNotFoundError extends Error {
    readonly statusCode = 404;
    readonly errorCode = "PROMOTION_BATCH_NOT_FOUND";

    constructor(public readonly batchId: string) {
        super(`Import transport promotion batch not found: ${batchId}`);
        this.name = "ImportTransportHistoryPromotionBatchNotFoundError";
    }
}
