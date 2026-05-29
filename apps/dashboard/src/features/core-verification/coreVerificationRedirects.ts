import { coreReviewPath } from "@/src/lib/dashboardPaths";

/** Legacy `/dashboard/core-verification/:segment` URL segments. */
export const CORE_VERIFICATION_LEGACY_PATHS = new Set([
    "buildings",
    "places",
    "roads",
    "landuse",
    "water-lines",
    "water-polygons",
    "bus-stops",
    "admin-areas",
    "routing-barriers",
    "bus-routes",
    "bus-route-variants",
    "bus-route-stops",
]);

/** Legacy segments that map to an existing core-review module list page. */
export const CORE_VERIFICATION_TO_CORE_REVIEW_PATHS = new Set([
    "buildings",
    "places",
    "roads",
    "landuse",
    "water-lines",
    "water-polygons",
    "bus-stops",
    "admin-areas",
    "bus-routes",
    "bus-route-variants",
]);

export function coreVerificationOverviewRedirectTarget(): string {
    return coreReviewPath();
}

export function coreVerificationFamilyRedirectTarget(familyPathSegment: string): string {
    const segment = familyPathSegment.trim().replace(/^\/+|\/+$/g, "");
    if (!segment) {
        return coreReviewPath();
    }

    const knownFamily = CORE_VERIFICATION_LEGACY_PATHS.has(segment);
    if (!knownFamily || !CORE_VERIFICATION_TO_CORE_REVIEW_PATHS.has(segment)) {
        return coreReviewPath();
    }

    const params = new URLSearchParams({ verification_status: "unverified" });
    return `${coreReviewPath(segment)}?${params.toString()}`;
}
