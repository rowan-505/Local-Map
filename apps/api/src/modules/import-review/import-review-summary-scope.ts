import {
    IMPORT_REVIEW_ENTITY_FAMILIES,
    getImportReviewEntityConfig,
    isImportReviewEntityFamily,
    type ImportReviewEntityFamilySlug,
} from "./import-review-config.js";
import type { ImportReviewScopeResolved } from "./import-review-batch-resolver.js";

/** Families to scan for summary — batch metadata first, else all configured families. */
export function summaryFamiliesForScope(scope: ImportReviewScopeResolved): ImportReviewEntityFamilySlug[] {
    const fromBatch = scope.entityFamilies.filter(isImportReviewEntityFamily);
    if (fromBatch.length === 0) {
        return [...IMPORT_REVIEW_ENTITY_FAMILIES];
    }

    const allowed = new Set(fromBatch);
    return IMPORT_REVIEW_ENTITY_FAMILIES.filter((family) => allowed.has(family));
}

export function summaryTableNamesForFamilies(
    families: ImportReviewEntityFamilySlug[]
): { family: ImportReviewEntityFamilySlug; tableName: string; qualifiedName: string }[] {
    return families.map((family) => {
        const tableName = getImportReviewEntityConfig(family).importReviewTable;
        return {
            family,
            tableName,
            qualifiedName: `import_review.${tableName}`,
        };
    });
}
