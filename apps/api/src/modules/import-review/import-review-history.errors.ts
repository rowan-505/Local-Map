export class ImportReviewHistoryReviewBatchNotFoundError extends Error {
    readonly code = "IMPORT_REVIEW_HISTORY_REVIEW_BATCH_NOT_FOUND";

    constructor(id: string) {
        super(`Review batch not found: ${id}`);
        this.name = "ImportReviewHistoryReviewBatchNotFoundError";
    }
}
