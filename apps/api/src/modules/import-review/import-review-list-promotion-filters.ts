import type { CandidateListFilters } from "./import-review-candidate-sql.js";
import type { ImportReviewPromotionStateFilter } from "./import-review.schema.js";

export function resolveListPromotionFilters(query: {
    promotion_state?: ImportReviewPromotionStateFilter;
    retry_needed?: boolean;
    include_promoted?: boolean;
}): Required<Pick<CandidateListFilters, "promotion_state" | "include_promoted" | "retry_needed">> {
    if (query.retry_needed) {
        return {
            promotion_state: "retry_needed",
            include_promoted: false,
            retry_needed: true,
        };
    }
    if (query.include_promoted && (query.promotion_state ?? "all_active") === "all_active") {
        return {
            promotion_state: "all_active",
            include_promoted: true,
            retry_needed: false,
        };
    }
    return {
        promotion_state: query.promotion_state ?? "all_active",
        include_promoted: query.include_promoted ?? false,
        retry_needed: false,
    };
}
