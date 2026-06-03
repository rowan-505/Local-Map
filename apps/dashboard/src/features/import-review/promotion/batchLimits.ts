import { IMPORT_REVIEW_PROMOTION_FAMILY_META } from "@/src/features/import-review/config/importReviewPromotionFamilies";

/** Mirrors API default (apps/api import-review-promotion-batch-limits.ts). */
export const IMPORT_REVIEW_MAX_PUBLISH_BATCH_ITEMS = 200;

const HIGH_RISK_FAMILIES = new Set(
    IMPORT_REVIEW_PROMOTION_FAMILY_META.filter((m) => m.riskLevel === "high_risk").map((m) => m.family)
);

const SIMPLE_FAMILIES = new Set(
    IMPORT_REVIEW_PROMOTION_FAMILY_META.filter((m) => m.riskLevel === "normal").map((m) => m.family)
);

export type PublishBatchLimitsConfirmationState = {
    confirmLargeBatch: boolean;
    allowHighRiskFamilies: boolean;
    mixedHighRiskConfirm: boolean;
};

export type PublishBatchLimitsEvaluation = {
    totalItems: number;
    maxItems: number;
    needsLargeBatchConfirm: boolean;
    needsHighRiskConfirm: boolean;
    needsMixedHighRiskConfirm: boolean;
    highRiskFamiliesPresent: string[];
    canProceed: boolean;
    missingConfirmations: string[];
};

export function estimateAllReadyBatchItemCount(args: {
    families: readonly string[];
    eligibilityRows: ReadonlyArray<{ family: string; ready: number; warnings: number }>;
    includeWarnings: boolean;
}): number {
    const selected = new Set(args.families);
    return args.eligibilityRows.reduce((sum, row) => {
        if (!selected.has(row.family)) {
            return sum;
        }
        return sum + row.ready + (args.includeWarnings ? row.warnings : 0);
    }, 0);
}

export function evaluatePublishBatchLimits(args: {
    families: readonly string[];
    totalItems: number;
    confirmation: PublishBatchLimitsConfirmationState;
}): PublishBatchLimitsEvaluation {
    const maxItems = IMPORT_REVIEW_MAX_PUBLISH_BATCH_ITEMS;
    const needsLargeBatchConfirm = args.totalItems > maxItems;
    const highRiskFamiliesPresent = args.families.filter((f) => HIGH_RISK_FAMILIES.has(f));
    const needsHighRiskConfirm = highRiskFamiliesPresent.length > 0;
    const needsMixedHighRiskConfirm =
        args.families.includes("roads") &&
        args.families.some((f) => SIMPLE_FAMILIES.has(f) && f !== "roads");

    const missingConfirmations: string[] = [];
    if (needsLargeBatchConfirm && !args.confirmation.confirmLargeBatch) {
        missingConfirmations.push("confirm_large_batch");
    }
    if (needsHighRiskConfirm && !args.confirmation.allowHighRiskFamilies) {
        missingConfirmations.push("allow_high_risk_families");
    }
    if (needsMixedHighRiskConfirm && !args.confirmation.mixedHighRiskConfirm) {
        missingConfirmations.push("mixed_high_risk_confirm");
    }

    return {
        totalItems: args.totalItems,
        maxItems,
        needsLargeBatchConfirm,
        needsHighRiskConfirm,
        needsMixedHighRiskConfirm,
        highRiskFamiliesPresent,
        canProceed: missingConfirmations.length === 0,
        missingConfirmations,
    };
}

export const IMPORT_REVIEW_PROMOTION_FIRST_TEST_RECOMMENDATIONS = [
    "1 building (selected mode)",
    "5 buildings (selected mode)",
    "Places only (small count)",
    "Landuse or water lines/polygons separately",
    "Roads only — separate batch with high-risk confirmation",
] as const;
