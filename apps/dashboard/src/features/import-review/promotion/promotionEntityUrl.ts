import { buildImportReviewEntityUrl } from "@/src/features/import-review/navigation/buildImportReviewEntityUrl";
import { getImportReviewEntitySlugByApiFamily } from "@/src/features/import-review/config/importReviewEntityConfigs";
import type { ImportReviewEntitySlug } from "@/src/features/import-review/config/types";

export function importReviewPromotionEntitySlug(family: string): ImportReviewEntitySlug | null {
    return getImportReviewEntitySlugByApiFamily(family);
}

export function importReviewPromotionEntityHref(
    family: string,
    reviewBatchId: string
): string | null {
    const slug = importReviewPromotionEntitySlug(family);
    if (!slug || !reviewBatchId.trim()) {
        return null;
    }
    return buildImportReviewEntityUrl(slug, {
        review_batch_id: reviewBatchId,
        filters: { review_decision: "approved" },
    });
}
