import { getImportReviewEntitySlugByApiFamily } from "@/src/features/import-review/config";
import { importReviewPath } from "@/src/lib/dashboardPaths";

/** Entity list page scoped to batch and candidate (drawer may not auto-open yet). */
export function promotionEligibilityReviewHref(
    apiFamily: string,
    reviewBatchId: string,
    candidateId: number
): string | null {
    const slug = getImportReviewEntitySlugByApiFamily(apiFamily);
    if (!slug) {
        return null;
    }
    const params = new URLSearchParams();
    const batch = reviewBatchId.trim();
    if (batch) {
        params.set("review_batch_id", batch);
    }
    params.set("candidate_id", String(candidateId));
    return `${importReviewPath(slug)}?${params.toString()}`;
}
