/** Legacy core.core_bus_* import-review families — hidden from nav; use import-transport instead. */
export const DEPRECATED_CORE_BUS_API_FAMILIES = new Set([
    "bus_stops",
    "bus_routes",
    "bus_route_variants",
    "bus_route_stops",
]);

export const DEPRECATED_IMPORT_REVIEW_BUS_SLUGS = [
    "bus-stops",
    "bus-routes",
    "bus-route-variants",
    "bus-route-stops",
] as const;

export type DeprecatedImportReviewBusSlug = (typeof DEPRECATED_IMPORT_REVIEW_BUS_SLUGS)[number];

export const DEPRECATED_CORE_BUS_PROMOTION_BANNER =
    "Read-only review: promotion to legacy core.core_bus_* tables is disabled. New transport data uses import_transport / core_transport.";

export const IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE =
    "Transport import review moved to /dashboard/import-transport.";

export const IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL =
    "YBS and express bus candidate review now lives in Import transport. Legacy import-review bus queues are deprecated and no longer appear in this navigation.";

function normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
}

export function isDeprecatedCoreBusImportReviewFamily(apiFamily: string): boolean {
    return DEPRECATED_CORE_BUS_API_FAMILIES.has(apiFamily.trim().toLowerCase().replace(/-/g, "_"));
}

export function isDeprecatedImportReviewBusSlug(slug: string): boolean {
    const normalized = normalizeSlug(slug);
    return (DEPRECATED_IMPORT_REVIEW_BUS_SLUGS as readonly string[]).includes(normalized);
}

/** @deprecated Legacy import-review bus entity configs remain for API/tests but are excluded from nav. */
export function isImportReviewNavEntitySlug(slug: string): boolean {
    return !isDeprecatedImportReviewBusSlug(slug);
}
