/** Shared React Query cache policy for import-review reference/filter option endpoints. */
export const IMPORT_REVIEW_OPTIONS_STALE_MS = 10 * 60 * 1000;
export const IMPORT_REVIEW_OPTIONS_GC_MS = 30 * 60 * 1000;

/** Overview summary — short TTL; batch-scoped counts change during review. */
export const IMPORT_REVIEW_SUMMARY_STALE_MS = 60 * 1000;
export const IMPORT_REVIEW_SUMMARY_GC_MS = 5 * 60 * 1000;

export const importReviewOptionsQueryDefaults = {
    staleTime: IMPORT_REVIEW_OPTIONS_STALE_MS,
    gcTime: IMPORT_REVIEW_OPTIONS_GC_MS,
    refetchOnWindowFocus: false,
} as const;

export const importReviewSummaryQueryDefaults = {
    staleTime: IMPORT_REVIEW_SUMMARY_STALE_MS,
    gcTime: IMPORT_REVIEW_SUMMARY_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
} as const;

/** Per-batch filter DISTINCT values — load after list; cache longer than list. */
export const IMPORT_REVIEW_FILTER_OPTIONS_STALE_MS = 5 * 60 * 1000;
export const IMPORT_REVIEW_FILTER_OPTIONS_GC_MS = 30 * 60 * 1000;
export const IMPORT_REVIEW_LIST_STALE_MS = 5 * 60 * 1000;
export const IMPORT_REVIEW_LIST_GC_MS = 30 * 60 * 1000;
export const IMPORT_REVIEW_DRY_RUN_STALE_MS = 3 * 60 * 1000;

export const importReviewListQueryDefaults = {
    staleTime: IMPORT_REVIEW_LIST_STALE_MS,
    gcTime: IMPORT_REVIEW_LIST_GC_MS,
    refetchOnWindowFocus: false,
} as const;

export const importReviewDryRunQueryDefaults = {
    staleTime: IMPORT_REVIEW_DRY_RUN_STALE_MS,
    gcTime: IMPORT_REVIEW_LIST_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
} as const;

export const importReviewFilterOptionsQueryDefaults = {
    staleTime: IMPORT_REVIEW_FILTER_OPTIONS_STALE_MS,
    gcTime: IMPORT_REVIEW_FILTER_OPTIONS_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
} as const;
