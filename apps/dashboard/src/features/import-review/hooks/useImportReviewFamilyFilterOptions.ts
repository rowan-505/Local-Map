"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getEntityFilterOptions } from "@/src/features/import-review/api";
import {
    formatImportReviewApiError,
    importReviewAmbiguousFromError,
} from "@/src/features/import-review/api/importReviewApiErrors";
import type { ImportReviewFamilyFilterOptionsResponse } from "@/src/lib/api";
import { reviewBatchIdFromApiScopeQuery, type ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import { importReviewFilterOptionsQueryDefaults } from "./importReviewQueryConfig";
import { importReviewQueryKeys } from "./importReviewQueryKeys";

export type UseImportReviewFamilyFilterOptionsArgs = {
    apiFamily: string | undefined;
    /** Resolved API scope — filter-options only run when this includes review_batch_id. */
    apiScopeQuery: ImportReviewScopeQueryParams | null;
    /** When false, defers DISTINCT filter scan until after initial list load. */
    enabled?: boolean;
};

export function useImportReviewFamilyFilterOptions({
    apiFamily,
    apiScopeQuery,
    enabled = true,
}: UseImportReviewFamilyFilterOptionsArgs) {
    const apiScope = apiScopeQuery ?? null;
    const reviewBatchId = reviewBatchIdFromApiScopeQuery(apiScope);
    const family = apiFamily?.trim() ?? "";
    const queryEnabled = enabled && Boolean(family && reviewBatchId);

    const query = useQuery({
        queryKey: importReviewQueryKeys.filterOptions(family, apiScope),
        queryFn: async ({ signal }) => {
            const data = await getEntityFilterOptions(
                family,
                { review_batch_id: reviewBatchId! },
                { signal }
            );
            return data as ImportReviewFamilyFilterOptionsResponse;
        },
        enabled: queryEnabled,
        ...importReviewFilterOptionsQueryDefaults,
        placeholderData: keepPreviousData,
    });

    const ambiguous = query.error ? importReviewAmbiguousFromError(query.error) : null;

    return {
        filterOptions: queryEnabled ? (query.data ?? null) : null,
        isLoadingFilters: queryEnabled && query.isPending && !query.data,
        isFetchingFilters: queryEnabled && query.isFetching,
        filterOptionsError:
            query.error && !ambiguous
                ? formatImportReviewApiError(query.error, "Failed to load filter options.")
                : "",
        ambiguousBatches: ambiguous?.batches ?? null,
        ambiguousSnapshot: ambiguous?.sourceSnapshotVersion ?? "",
    };
}
