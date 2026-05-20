/**
 * Compatibility shim — source of truth is @/src/features/import-review/config.
 * Existing imports from this module keep working without changes.
 */
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";

export type {
    ImportReviewEntityColumnSource,
    ImportReviewEntityConfig,
    ImportReviewEntitySlug,
    ImportReviewEntityTableColumn,
    ImportReviewFilterField,
    ImportReviewGeometryType,
    ImportReviewMapLayerType,
    ImportReviewTableColumn,
    RefDropdownFieldConfig,
    RefSource,
} from "@/src/features/import-review/config";

export {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    createImportReviewEntityConfig,
    getImportReviewEntityConfigByApiFamily,
    getImportReviewEntityConfigBySlug,
    isKnownImportReviewEntitySlug,
    listImportReviewEntityConfigs,
    toDataReviewGeometryKind,
    toLegacyRouteConfig,
} from "@/src/features/import-review/config";

import {
    getImportReviewEntityConfigByApiFamily,
    getImportReviewEntityConfigBySlug,
    listImportReviewEntityConfigs,
    toLegacyRouteConfig,
    type ImportReviewEntityRouteConfig,
} from "@/src/features/import-review/config";

export type { ImportReviewEntityRouteConfig } from "@/src/features/import-review/config";

export const IMPORT_REVIEW_ENTITY_CONFIGS: ImportReviewEntityRouteConfig[] =
    listImportReviewEntityConfigs().map(toLegacyRouteConfig);

export const IMPORT_REVIEW_NAV_ENTITIES = IMPORT_REVIEW_ENTITY_CONFIGS;

export function getImportReviewEntityBySlug(slug: string): ImportReviewEntityRouteConfig | null {
    const config = getImportReviewEntityConfigBySlug(slug);
    return config ? toLegacyRouteConfig(config) : null;
}

export function getImportReviewEntityByApiFamily(apiFamily: string): ImportReviewEntityRouteConfig | null {
    const config = getImportReviewEntityConfigByApiFamily(apiFamily);
    return config ? toLegacyRouteConfig(config) : null;
}

/** Entity page href scoped to a resolved review batch (preferred for navigation from overview). */
export function importReviewEntityHrefForBatch(slug: string, reviewBatchId: string): string {
    const id = reviewBatchId.trim();
    if (!id) {
        return `/import-review/${slug}`;
    }
    return `/import-review/${slug}?review_batch_id=${encodeURIComponent(id)}`;
}

/** Build entity page href preserving review_batch_id or snapshot scope. */
export function importReviewEntityHref(
    slug: string,
    sp: Pick<URLSearchParams, "get" | "toString">,
    resolvedReviewBatchId?: string | null
): string {
    const resolvedBatch = resolvedReviewBatchId?.trim() || reviewBatchIdFromImportReviewSearch(sp);
    if (resolvedBatch) {
        return importReviewEntityHrefForBatch(slug, resolvedBatch);
    }
    const params = new URLSearchParams(sp.toString());
    const snap = snapshotVersionFromImportReviewSearch(params);
    applyImportReviewScopeSearchParams(params, snap, "");
    const qs = params.toString();
    return qs ? `/import-review/${slug}?${qs}` : `/import-review/${slug}`;
}

export function importReviewOverviewHref(sp: Pick<URLSearchParams, "get" | "toString">): string {
    const params = new URLSearchParams(sp.toString());
    const batch = reviewBatchIdFromImportReviewSearch(params);
    const snap = snapshotVersionFromImportReviewSearch(params);
    applyImportReviewScopeSearchParams(params, snap, batch);
    const qs = params.toString();
    return qs ? `/import-review?${qs}` : "/import-review";
}

export function importReviewPromotionHref(sp: Pick<URLSearchParams, "get" | "toString">): string {
    const params = new URLSearchParams(sp.toString());
    const batch = reviewBatchIdFromImportReviewSearch(params);
    const snap = snapshotVersionFromImportReviewSearch(params);
    applyImportReviewScopeSearchParams(params, snap, batch);
    const qs = params.toString();
    return qs ? `/import-review/promotion?${qs}` : "/import-review/promotion";
}

export function importReviewHistoryHref(): string {
    return "/import-review/history";
}

export function importReviewHistoryReviewBatchHref(id: string): string {
    return `/import-review/history/review-batches/${id}`;
}

export function importReviewHistoryPublishBatchHref(id: string): string {
    return `/import-review/history/publish-batches/${id}`;
}

/** Order families for display: config order, then unknown at end. */
export function sortEntityFamilies(families: string[]): string[] {
    const order = IMPORT_REVIEW_ENTITY_CONFIGS.map((c) => c.apiFamily);
    const set = new Set(families);
    const sorted = order.filter((f) => set.has(f));
    for (const f of families) {
        if (!sorted.includes(f)) {
            sorted.push(f);
        }
    }
    return sorted;
}

export function slugForApiFamily(apiFamily: string): string | null {
    return getImportReviewEntityByApiFamily(apiFamily)?.slug ?? null;
}
