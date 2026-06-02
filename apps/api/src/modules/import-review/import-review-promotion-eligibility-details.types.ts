import type { ImportReviewPromotionAllowedFamily } from "./import-review-promotion-config.js";
import type { PromotionEligibilityBucket } from "./import-review-promotion-eligibility.js";

export type ImportReviewPromotionEligibilityDetailItem = {
    id: number;
    external_id: string | null;
    display_name: string | null;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    confidence_score: number | null;
    reason_codes: string[];
    reason_messages: string[];
    validation_errors: unknown;
    validation_warnings: unknown;
    target: string;
    publish_batch_id: number | null;
    publish_batch_status: string | null;
    promoted_core_id: number | null;
    created_at: string | null;
    updated_at: string | null;
};

export type ImportReviewPromotionEligibilityDetailsResponse = {
    review_batch_id: number;
    family: ImportReviewPromotionAllowedFamily;
    bucket: PromotionEligibilityBucket;
    target: string;
    total: number;
    limit: number;
    offset: number;
    items: ImportReviewPromotionEligibilityDetailItem[];
};
