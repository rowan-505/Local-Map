import { CORE_REVIEW_IMPORT_PROMOTION_TARGET_SLUGS } from "@/src/features/core-review/hooks/coreReviewQueryKeys";
import type { CoreReviewEntitySlug } from "@/src/lib/api";

export { CORE_REVIEW_IMPORT_PROMOTION_TARGET_SLUGS };

import { resolveImportReviewApiFamily } from "./importReviewApiFamily";

/** Import Review promotion family (underscore) → Core Review list module slug, when applicable. */
const IMPORT_REVIEW_FAMILY_TO_CORE_REVIEW_SLUG: Readonly<
    Record<string, CoreReviewEntitySlug | null>
> = {
    buildings: "buildings",
    places: "places",
    landuse: "landuse",
    water_lines: "water-lines",
    water_polygons: "water-polygons",
    roads: "streets",
    addresses: "addresses",
    admin_areas: "admin-areas",
    routing_barriers: null,
};

export function importReviewApiFamilyForPromotionFamily(family: string): string {
    return resolveImportReviewApiFamily(family);
}

export function coreReviewSlugForImportReviewPromotionFamily(
    family: string
): CoreReviewEntitySlug | null {
    const key = family.trim().toLowerCase().replace(/-/g, "_");
    return IMPORT_REVIEW_FAMILY_TO_CORE_REVIEW_SLUG[key] ?? null;
}

export function coreReviewSlugsForImportReviewPromotionFamilies(
    families: readonly string[]
): CoreReviewEntitySlug[] {
    const slugs = new Set<CoreReviewEntitySlug>();
    for (const family of families) {
        const slug = coreReviewSlugForImportReviewPromotionFamily(family);
        if (slug) {
            slugs.add(slug);
        }
    }
    return [...slugs].sort();
}

export function importReviewApiFamiliesForPromotionFamilies(
    families: readonly string[]
): string[] {
    const apiFamilies = new Set<string>();
    for (const family of families) {
        apiFamilies.add(importReviewApiFamilyForPromotionFamily(family));
    }
    return [...apiFamilies].sort();
}
