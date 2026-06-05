import {
    HIGH_RISK_PROMOTION_FAMILIES,
    isHighRiskPromotionFamily,
    NORMAL_PROMOTION_FAMILIES,
    type HighRiskPromotionFamily,
    type NormalPromotionFamily,
} from "./import-review-promotion-config.js";
import { ImportReviewPromotionBatchLimitsError } from "./import-review-promotion.errors.js";

/** Default maximum publish items per batch without explicit confirmation. */
export const IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS = 200;

/** High-risk validation/create allowed without allow_high_risk_families up to this item count. */
export const IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD = 50;

export const IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_REQUIRED_MESSAGE =
    "Batch has high-risk families and more than 50 items. Confirm high-risk validation to continue.";

export type PublishBatchLimitsConfirmation = {
    confirm_large_batch?: boolean;
    allow_high_risk_families?: boolean;
    mixed_high_risk_confirm?: boolean;
};

export type PublishBatchLimitsCheckInput = {
    families: readonly string[];
    totalItems: number;
    confirmation?: PublishBatchLimitsConfirmation;
    /** Included in API error payloads (create vs validate). */
    context: "create" | "validate";
    /** When false, only high-risk / mixed-road rules apply (e.g. dry-run preview). */
    enforceLargeBatchLimit?: boolean;
};

export function batchIncludesHighRiskFamily(families: readonly string[]): boolean {
    return families.some((f) => isHighRiskPromotionFamily(f));
}

export function batchRequiresMixedHighRiskConfirm(families: readonly string[]): boolean {
    const set = new Set(families);
    if (!set.has("roads")) {
        return false;
    }
    return (NORMAL_PROMOTION_FAMILIES as readonly string[]).some((f) => set.has(f));
}

/** True when explicit allow_high_risk_families is required for validate/create. */
export function requiresPublishBatchHighRiskConfirmation(
    families: readonly string[],
    totalItems: number
): boolean {
    return (
        batchIncludesHighRiskFamily(families) &&
        totalItems > IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_ITEM_THRESHOLD
    );
}

export function assertPublishBatchLimits(input: PublishBatchLimitsCheckInput): void {
    const confirm = input.confirmation ?? {};
    const maxItems = IMPORT_REVIEW_DEFAULT_MAX_PUBLISH_BATCH_ITEMS;
    const violations: Array<{
        code: string;
        message: string;
        required_flag?: string;
    }> = [];

    if (
        input.enforceLargeBatchLimit !== false &&
        input.totalItems > maxItems &&
        !confirm.confirm_large_batch
    ) {
        violations.push({
            code: "batch_too_large",
            message: `Publish batch has ${input.totalItems} items (max ${maxItems} without confirm_large_batch=true).`,
            required_flag: "confirm_large_batch",
        });
    }

    const highRiskPresent = input.families.filter((f): f is HighRiskPromotionFamily =>
        isHighRiskPromotionFamily(f)
    );
    const requiresHighRiskConfirmation = requiresPublishBatchHighRiskConfirmation(
        input.families,
        input.totalItems
    );
    if (requiresHighRiskConfirmation && !confirm.allow_high_risk_families) {
        violations.push({
            code: "high_risk_families",
            message: IMPORT_REVIEW_HIGH_RISK_CONFIRMATION_REQUIRED_MESSAGE,
            required_flag: "allow_high_risk_families",
        });
    }

    if (batchRequiresMixedHighRiskConfirm(input.families) && !confirm.mixed_high_risk_confirm) {
        violations.push({
            code: "mixed_high_risk",
            message:
                "Mixing roads with other simple families requires mixed_high_risk_confirm=true. Prefer roads-only batches for first tests.",
            required_flag: "mixed_high_risk_confirm",
        });
    }

    if (violations.length === 0) {
        return;
    }

    throw new ImportReviewPromotionBatchLimitsError({
        context: input.context,
        totalItems: input.totalItems,
        maxItems,
        families: [...input.families],
        highRiskFamilies: [...HIGH_RISK_PROMOTION_FAMILIES],
        normalFamilies: [...NORMAL_PROMOTION_FAMILIES],
        violations,
    });
}
