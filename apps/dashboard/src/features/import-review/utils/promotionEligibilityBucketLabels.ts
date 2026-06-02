import type { ImportReviewPromotionEligibilityBucket } from "@/src/lib/api";

const BUCKET_LABEL: Record<ImportReviewPromotionEligibilityBucket, string> = {
    ready: "Ready",
    warnings: "Warning",
    blocked: "Blocked",
    batched: "Batched",
    promoted: "Promoted",
};

export function promotionEligibilityBucketLabel(bucket: ImportReviewPromotionEligibilityBucket): string {
    return BUCKET_LABEL[bucket];
}

export function promotionEligibilityDetailsTitle(
    familyLabel: string,
    bucket: ImportReviewPromotionEligibilityBucket
): string {
    return `${familyLabel} — ${BUCKET_LABEL[bucket]} candidates`;
}
