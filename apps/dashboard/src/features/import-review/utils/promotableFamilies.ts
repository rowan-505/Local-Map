import { IMPORT_REVIEW_PROMOTION_FAMILY_META } from "@/src/features/import-review/config/importReviewPromotionFamilies";
import { resolveImportReviewApiFamily } from "@/src/features/import-review/utils/importReviewApiFamily";

const PROMOTABLE_API_FAMILIES = new Set(
    IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => row.family)
);

const HIGH_RISK_PROMOTABLE = new Set(
    IMPORT_REVIEW_PROMOTION_FAMILY_META.filter((row) => row.riskLevel === "high_risk").map(
        (row) => row.family
    )
);

export function isImportReviewPromotableApiFamily(apiFamily: string): boolean {
    const normalized = resolveImportReviewApiFamily(apiFamily);
    return PROMOTABLE_API_FAMILIES.has(normalized);
}

export function isHighRiskPromotableFamily(apiFamily: string): boolean {
    const normalized = resolveImportReviewApiFamily(apiFamily);
    return HIGH_RISK_PROMOTABLE.has(normalized);
}

export function promotionFamilyFromApiFamily(apiFamily: string): string {
    return resolveImportReviewApiFamily(apiFamily);
}
