export class ImportReviewAddressPromotionDisabledError extends Error {
    constructor() {
        super("Address promotion is disabled (ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION is not true).");
        this.name = "ImportReviewAddressPromotionDisabledError";
    }
}
