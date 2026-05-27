"use client";

import { useQuery } from "@tanstack/react-query";

import {
    getImportReviewSummary,
    type ImportReviewBatchChoice,
    type ImportReviewEnvelopeQuery,
    type ImportReviewSummaryResponse,
} from "@/src/lib/api";

import { formatImportReviewApiError, importReviewAmbiguousFromError } from "../api/importReviewApiErrors";
import { importReviewSummaryQueryDefaults } from "./importReviewQueryConfig";
import { importReviewQueryKeys } from "./importReviewQueryKeys";

export type UseImportReviewSummaryOptions = {
    enabled?: boolean;
};

export type UseImportReviewSummaryResult = {
    data: ImportReviewSummaryResponse | null;
    isLoading: boolean;
    isFetching: boolean;
    dataUpdatedAt: number;
    error: string;
    ambiguousBatches: ImportReviewBatchChoice[] | null;
    ambiguousSnapshot: string;
    refetch: () => void;
};

export function useImportReviewSummary(
    scope: ImportReviewEnvelopeQuery | null,
    options: UseImportReviewSummaryOptions = {}
): UseImportReviewSummaryResult {
    const enabled = options.enabled !== false && scope !== null;

    const query = useQuery({
        queryKey: importReviewQueryKeys.summary(scope),
        queryFn: async ({ signal }) => {
            if (!scope) {
                throw new Error("Summary scope is required.");
            }
            return getImportReviewSummary(scope, { signal });
        },
        enabled,
        ...importReviewSummaryQueryDefaults,
    });

    let error = "";
    let ambiguousBatches: UseImportReviewSummaryResult["ambiguousBatches"] = null;
    let ambiguousSnapshot = "";

    if (query.error) {
        const ambiguous = importReviewAmbiguousFromError(query.error);
        if (ambiguous) {
            ambiguousBatches = ambiguous.batches;
            ambiguousSnapshot = ambiguous.sourceSnapshotVersion;
        } else {
            error = formatImportReviewApiError(query.error, "Failed to load import review summary.");
        }
    }

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        dataUpdatedAt: query.dataUpdatedAt,
        error,
        ambiguousBatches,
        ambiguousSnapshot,
        refetch: () => {
            void query.refetch();
        },
    };
}
