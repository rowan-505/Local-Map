/**
 * Typed-column publish-batch promotion helpers (registry + gate wiring).
 *
 * @see docs/import-review/direct-edit-promotion-contract.md
 */

import {
    getPromotionFamilyConfig,
    IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES,
    isImportReviewSimplePromotionFamily,
    promotionTargetQualifiedTable,
    type ImportReviewSimplePromotionFamily,
    type ImportReviewSimplePromotionFamilyConfig,
} from "./import-review-promotion-simple-config.js";
import type { PublishItemPromotionGateInput } from "./import-review-promotion-publish-item-validation.js";
import {
    canPromotePublishItem,
    publishItemPromotionBlockReason,
} from "./import-review-promotion-publish-item-validation.js";

export {
    getPromotionFamilyConfig,
    isImportReviewSimplePromotionFamily,
    promotionTargetQualifiedTable,
};

export type SimplePromotionTarget = {
    family: ImportReviewSimplePromotionFamily;
    target_schema: string;
    target_table: string;
    target_qualified: string;
    candidate_table: string;
};

export function resolveSimplePromotionTarget(family: string): SimplePromotionTarget | null {
    const config = getPromotionFamilyConfig(family);
    if (!config) {
        return null;
    }
    return {
        family: config.family,
        target_schema: config.targetSchema,
        target_table: config.targetTable,
        target_qualified: promotionTargetQualifiedTable(config),
        candidate_table: config.candidateTable,
    };
}

/** All nine contract families with schema.table mapping. */
export function listAllSimplePromotionTargetMappings(): SimplePromotionTarget[] {
    return IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES.map((family) => {
        const config = getPromotionFamilyConfig(family)!;
        return {
            family,
            target_schema: config.targetSchema,
            target_table: config.targetTable,
            target_qualified: promotionTargetQualifiedTable(config),
            candidate_table: config.candidateTable,
        };
    });
}

export function assertSimplePromotionFamily(family: string): ImportReviewSimplePromotionFamily {
    if (!isImportReviewSimplePromotionFamily(family)) {
        throw new Error(`Entity family ${family} is not supported for typed publish-batch promotion.`);
    }
    return family;
}

export function promotionTargetForFamily(
    config: ImportReviewSimplePromotionFamilyConfig
): { target_schema: string; target_table: string; target_qualified: string } {
    return {
        target_schema: config.targetSchema,
        target_table: config.targetTable,
        target_qualified: promotionTargetQualifiedTable(config),
    };
}

export function assertPublishItemPromotableForRun(
    validationResult: unknown,
    gate: PublishItemPromotionGateInput
): void {
    const reason = publishItemPromotionBlockReason(validationResult, gate);
    if (reason !== null) {
        throw new Error(reason);
    }
}

export { canPromotePublishItem, publishItemPromotionBlockReason };
