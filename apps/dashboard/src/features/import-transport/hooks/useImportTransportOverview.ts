"use client";

import { useQuery } from "@tanstack/react-query";

import {
    getImportTransportBatches,
    getImportTransportSummary,
} from "../api/importTransportApiClient";
import { formatImportTransportApiError } from "../api/importTransportApiErrors";
import type {
    ImportTransportBatchesListParams,
    ImportTransportScopeQuery,
} from "../config/types";
import { importTransportListQueryDefaults } from "./importTransportQueryConfig";
import { importTransportQueryKeys } from "./importTransportQueryKeys";

export function useImportTransportSummary(scope: ImportTransportScopeQuery | null, enabled = true) {
    const query = useQuery({
        queryKey: importTransportQueryKeys.summary(scope),
        enabled: enabled && scope !== null,
        ...importTransportListQueryDefaults,
        queryFn: async ({ signal }) => {
            if (!scope) {
                throw new Error("Summary scope is required.");
            }
            return getImportTransportSummary(scope, { signal });
        },
    });

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        dataUpdatedAt: query.dataUpdatedAt,
        error: query.error
            ? formatImportTransportApiError(query.error, "Failed to load import transport summary.")
            : "",
        refetch: query.refetch,
    };
}

export function useImportTransportBatches(
    params: ImportTransportBatchesListParams = { limit: 50, offset: 0 },
    enabled = true
) {
    const query = useQuery({
        queryKey: importTransportQueryKeys.batches(params),
        enabled,
        ...importTransportListQueryDefaults,
        queryFn: ({ signal }) => getImportTransportBatches(params, { signal }),
    });

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error
            ? formatImportTransportApiError(query.error, "Failed to load import batches.")
            : "",
        refetch: query.refetch,
    };
}
