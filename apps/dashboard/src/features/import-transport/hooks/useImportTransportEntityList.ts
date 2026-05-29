"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getImportTransportCandidates } from "../api/importTransportApiClient";
import { formatImportTransportApiError } from "../api/importTransportApiErrors";
import type { ImportTransportListFilters, ImportTransportScopeQuery } from "../config/types";
import { importTransportListQueryDefaults } from "./importTransportQueryConfig";
import { importTransportQueryKeys } from "./importTransportQueryKeys";

export type ImportTransportEntityListParams = {
    apiFamily: string;
    apiScopeQuery: ImportTransportScopeQuery;
    limit: number;
    offset: number;
    sort: string;
    filters: ImportTransportListFilters;
    qApplied: string;
    showPromoted: boolean;
};

export function useImportTransportEntityList(
    params: ImportTransportEntityListParams | null,
    enabled: boolean
) {
    const queryKey = importTransportQueryKeys.candidatesList(
        params
            ? {
                  apiFamily: params.apiFamily,
                  apiScopeQuery: params.apiScopeQuery,
                  limit: params.limit,
                  offset: params.offset,
                  sort: params.sort,
                  filters: params.filters,
                  qApplied: params.qApplied,
                  showPromoted: params.showPromoted,
              }
            : null
    );

    const query = useQuery({
        queryKey,
        enabled: enabled && Boolean(params),
        placeholderData: keepPreviousData,
        staleTime: importTransportListQueryDefaults.staleTime,
        gcTime: importTransportListQueryDefaults.gcTime,
        queryFn: async ({ signal }) => {
            if (!params) {
                throw new Error("List params required");
            }
            const rest: Record<string, string | number | boolean | undefined> = {
                ...params.apiScopeQuery,
                limit: params.limit,
                offset: params.offset,
                sort: params.sort,
                include_geometry: false,
                include_total: true,
                include_promoted: params.showPromoted,
            };
            if (params.filters.review_status) rest.review_status = params.filters.review_status;
            if (params.filters.review_decision) rest.review_decision = params.filters.review_decision;
            if (params.filters.promotion_status) rest.promotion_status = params.filters.promotion_status;
            if (params.filters.validation_status) {
                rest.validation_status = params.filters.validation_status;
            }
            if (params.filters.mode_type) rest.mode_type = params.filters.mode_type;
            if (params.qApplied) rest.q = params.qApplied;

            return getImportTransportCandidates(params.apiFamily, rest, { signal });
        },
    });

    const listError = query.error
        ? formatImportTransportApiError(query.error, "Failed to load transport candidates.")
        : "";

    return {
        list: query.data ?? null,
        listTotal: query.data?.total ?? query.data?.items?.length ?? 0,
        isInitialCandidatesLoad: query.isLoading && !query.data,
        isRefreshingCandidates: query.isFetching && !query.isLoading,
        listError,
        refetchList: query.refetch,
    };
}
