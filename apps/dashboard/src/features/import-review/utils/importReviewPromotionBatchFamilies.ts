import {
    DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META,
    getImportReviewPromotionFamilyMeta,
    IMPORT_REVIEW_PROMOTION_FAMILY_META,
} from "@/src/features/import-review/config/importReviewPromotionFamilies";
import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import type { ImportReviewPublishBatchDetail, ImportReviewPublishBatchEntityItemCounts } from "@/src/lib/api";

export function importReviewPromotionTargetLabel(family: string): string {
    return getImportReviewPromotionFamilyMeta(family)?.targetLabel ?? "—";
}

function familyHasPublishItems(counts: ImportReviewPublishBatchEntityItemCounts | undefined): boolean {
    return (counts?.total ?? 0) > 0;
}

/** Families selected for promotion workflows (excludes legacy bus). */
export function resolveBatchActiveFamilies(detail: ImportReviewPublishBatchDetail): string[] {
    const fromMeta = (detail.entity_families ?? []).filter(
        (family) => !isDeprecatedCoreBusImportReviewFamily(family)
    );
    if (fromMeta.length > 0) {
        return [...fromMeta].sort((a, b) => a.localeCompare(b));
    }
    return Object.keys(detail.item_counts_by_entity_family ?? {})
        .filter(
            (family) =>
                !isDeprecatedCoreBusImportReviewFamily(family) &&
                familyHasPublishItems(detail.item_counts_by_entity_family?.[family])
        )
        .sort((a, b) => a.localeCompare(b));
}

/** Legacy bus families present on this batch (metadata or non-zero item counts). */
export function resolveBatchDeprecatedFamilies(detail: ImportReviewPublishBatchDetail): string[] {
    const set = new Set<string>();
    for (const family of detail.entity_families ?? []) {
        if (isDeprecatedCoreBusImportReviewFamily(family)) {
            set.add(family);
        }
    }
    for (const [family, counts] of Object.entries(detail.item_counts_by_entity_family ?? {})) {
        if (isDeprecatedCoreBusImportReviewFamily(family) && familyHasPublishItems(counts)) {
            set.add(family);
        }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

/** @deprecated Use {@link resolveBatchActiveFamilies}. */
export const resolveBatchSelectedFamilies = resolveBatchActiveFamilies;

export function orderedBatchFamiliesForDisplay(
    activeFamilies: string[],
    itemCountsByFamily: Record<string, unknown>
): string[] {
    const knownOrder = IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => row.family);
    const set = new Set([
        ...activeFamilies.filter((f) => !isDeprecatedCoreBusImportReviewFamily(f)),
        ...Object.keys(itemCountsByFamily).filter(
            (f) =>
                !isDeprecatedCoreBusImportReviewFamily(f) &&
                familyHasPublishItems(
                    itemCountsByFamily[f] as ImportReviewPublishBatchEntityItemCounts | undefined
                )
        ),
    ]);
    const ordered = knownOrder.filter((family) => set.has(family));
    for (const family of [...set].sort()) {
        if (!ordered.includes(family)) {
            ordered.push(family);
        }
    }
    return ordered;
}

export function orderedDeprecatedBatchFamiliesForDisplay(deprecatedFamilies: string[]): string[] {
    const knownOrder = DISABLED_IMPORT_REVIEW_PROMOTION_FAMILY_META.map((row) => row.family);
    const set = new Set(deprecatedFamilies.filter(isDeprecatedCoreBusImportReviewFamily));
    const ordered = knownOrder.filter((family) => set.has(family));
    for (const family of [...set].sort()) {
        if (!ordered.includes(family)) {
            ordered.push(family);
        }
    }
    return ordered;
}

export function batchHasDeprecatedTransportPromotionItems(
    detail: ImportReviewPublishBatchDetail | null | undefined
): boolean {
    if (!detail?.item_counts_by_entity_family) {
        return false;
    }
    return Object.entries(detail.item_counts_by_entity_family).some(
        ([family, counts]) =>
            isDeprecatedCoreBusImportReviewFamily(family) && familyHasPublishItems(counts)
    );
}
