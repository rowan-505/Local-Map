"use client";

import { useQuery } from "@tanstack/react-query";

import {
    getImportReviewRoadDryRunSummary,
    type ImportReviewRoadDryRunSummaryResponse,
} from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import { reviewBatchIdFromApiScopeQuery } from "@/src/lib/importReviewSnapshot";

import { importReviewDryRunQueryDefaults } from "./importReviewQueryConfig";
import { importReviewQueryKeys } from "./importReviewQueryKeys";

export function useImportReviewRoadDryRunSummary(
    apiScopeQuery: ImportReviewScopeQueryParams | null,
    enabled: boolean
) {
    const reviewBatchId = reviewBatchIdFromApiScopeQuery(apiScopeQuery);

    const query = useQuery({
        queryKey: importReviewQueryKeys.roadDryRunSummary(reviewBatchId),
        queryFn: ({ signal }) => {
            if (!reviewBatchId) {
                throw new Error("review_batch_id required for dry-run summary");
            }
            return getImportReviewRoadDryRunSummary({ review_batch_id: reviewBatchId }, { signal });
        },
        enabled: enabled && Boolean(reviewBatchId),
        ...importReviewDryRunQueryDefaults,
    });

    return {
        summary: (query.data ?? null) as ImportReviewRoadDryRunSummaryResponse | null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    };
}
