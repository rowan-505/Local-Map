import type { CoreReviewEntitySlug } from "@/src/lib/api";

/** Core Review list pages (see `buildCoreReviewListQueryKey` in useCoreReviewListState). */
export const coreReviewQueryKeys = {
    overviewVerificationSummary: () => ["core-review", "overview", "verification-summary"] as const,
    list: {
        all: () => ["core-review", "list"] as const,
        family: (apiSlug: CoreReviewEntitySlug) => ["core-review", "list", apiSlug] as const,
    },
    verificationTotals: {
        all: () => ["core-review", "verification-totals"] as const,
        family: (apiSlug: CoreReviewEntitySlug) => ["core-review", "verification-totals", apiSlug] as const,
    },
} as const;

/** Entity modules that receive rows from Import Review promotion into core.* */
export const CORE_REVIEW_IMPORT_PROMOTION_TARGET_SLUGS = [
    "buildings",
    "places",
    "streets",
    "landuse",
    "water-lines",
    "water-polygons",
    "addresses",
    "admin-areas",
] as const satisfies readonly CoreReviewEntitySlug[];
