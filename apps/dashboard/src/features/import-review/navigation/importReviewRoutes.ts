import { IMPORT_REVIEW_PATH } from "@/src/lib/dashboardPaths";

import { isKnownImportReviewEntitySlug } from "../config";

const IMPORT_REVIEW_PREFIX = `${IMPORT_REVIEW_PATH}/`;

/** Non-entity segments under `/dashboard/import-review/*`. */
const RESERVED_SEGMENTS = new Set(["promotion", "history"]);

/**
 * Entity slug from pathname, e.g. `/dashboard/import-review/buildings` → `buildings`.
 * Returns null on overview, promotion, history, and unknown paths.
 */
export function getImportReviewEntitySlugFromPathname(pathname: string): string | null {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (normalized === IMPORT_REVIEW_PATH) {
        return null;
    }
    if (!normalized.startsWith(IMPORT_REVIEW_PREFIX)) {
        return null;
    }
    const segment = normalized.slice(IMPORT_REVIEW_PREFIX.length).split("/")[0]?.trim().toLowerCase() ?? "";
    if (!segment || RESERVED_SEGMENTS.has(segment)) {
        return null;
    }
    return isKnownImportReviewEntitySlug(segment) ? segment : null;
}

export function isImportReviewOverviewPathname(pathname: string): boolean {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    return normalized === IMPORT_REVIEW_PATH;
}

/** True when pathname is a config-registered entity queue route. */
export function isImportReviewEntityPathname(pathname: string): boolean {
    return getImportReviewEntitySlugFromPathname(pathname) !== null;
}

/** Legacy roads/places candidate client routes (import-review roads + data-review roads). */
export function isImportReviewCandidatesRoute(
    pathname: string,
    family: "places" | "roads"
): boolean {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (family === "roads") {
        return normalized === `${IMPORT_REVIEW_PATH}/roads`;
    }
    return normalized === "/data-review/places";
}
