"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { getEntityCandidates } from "@/src/features/import-review/api";
import type { ImportReviewBuildingsListResponse } from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import { formatImportReviewApiError, importReviewAmbiguousFromError } from "../api/importReviewApiErrors";
import {
    buildImportReviewListFetchUrlPreview,
    logImportReviewListFetchEnd,
    logImportReviewListFetchStart,
} from "../utils/importReviewRequestDebug";
import { importReviewListQueryDefaults } from "./importReviewQueryConfig";
import { importReviewQueryKeys } from "./importReviewQueryKeys";
import type { ImportReviewListFilters } from "../utils/entityPageUtils";

export type ImportReviewEntityListParams = {
    apiFamily: string;
    apiScopeQuery: ImportReviewScopeQueryParams;
    limit: number;
    offset: number;
    sort: string;
    filters: ImportReviewListFilters;
    qApplied: string;
    promotionState: string;
};

export function useImportReviewEntityList(
    params: ImportReviewEntityListParams | null,
    enabled: boolean
) {
    const queryClient = useQueryClient();

    const queryKey = importReviewQueryKeys.candidatesList(
        params
            ? {
                  apiFamily: params.apiFamily,
                  apiScopeQuery: params.apiScopeQuery,
                  limit: params.limit,
                  offset: params.offset,
                  sort: params.sort,
                  filters: params.filters,
                  qApplied: params.qApplied,
                  promotionState: params.promotionState,
              }
            : null
    );

    const query = useQuery({
        queryKey,
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
                include_total: false,
                promotion_state: params.promotionState,
            };
            if (params.filters.match_status) rest.match_status = params.filters.match_status;
            if (params.filters.auto_action) rest.auto_action = params.filters.auto_action;
            if (params.filters.review_status) rest.review_status = params.filters.review_status;
            if (params.filters.review_decision) rest.review_decision = params.filters.review_decision;
            if (params.filters.promotion_status) rest.promotion_status = params.filters.promotion_status;
            if (params.filters.class_code) rest.class_code = params.filters.class_code;
            if (params.qApplied) rest.q = params.qApplied;

            logImportReviewListFetchStart({
                family: params.apiFamily,
                query_key: queryKey,
                fetch_url: buildImportReviewListFetchUrlPreview(params.apiFamily, rest),
                enabled: true,
            });

            try {
                const data = await getEntityCandidates(params.apiFamily, rest, { signal });
                logImportReviewListFetchEnd({
                    family: params.apiFamily,
                    status: "success",
                    item_count: data.items?.length ?? 0,
                });
                return data;
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                    logImportReviewListFetchEnd({
                        family: params.apiFamily,
                        status: "aborted",
                    });
                } else {
                    logImportReviewListFetchEnd({
                        family: params.apiFamily,
                        status: "error",
                        error_message: err instanceof Error ? err.message : "unknown",
                    });
                }
                throw err;
            }
        },
        enabled: enabled && params !== null,
        ...importReviewListQueryDefaults,
        placeholderData: keepPreviousData,
        refetchOnMount: false,
    });

    const countQueryKey = importReviewQueryKeys.candidatesCount(
        params
            ? {
                  apiFamily: params.apiFamily,
                  apiScopeQuery: params.apiScopeQuery,
                  filters: params.filters,
                  qApplied: params.qApplied,
                  promotionState: params.promotionState,
              }
            : null
    );
    const cachedCount = params ? queryClient.getQueryData<number>(countQueryKey) ?? null : null;
    const shouldFetchCount = enabled && params !== null && (params.offset === 0 || cachedCount === null);

    const countQuery = useQuery({
        queryKey: countQueryKey,
        queryFn: async ({ signal }) => {
            if (!params) {
                throw new Error("Count params required");
            }
            const rest: Record<string, string | number | boolean | undefined> = {
                ...params.apiScopeQuery,
                limit: 1,
                offset: 0,
                include_geometry: false,
                include_total: true,
                promotion_state: params.promotionState,
            };
            if (params.filters.match_status) rest.match_status = params.filters.match_status;
            if (params.filters.auto_action) rest.auto_action = params.filters.auto_action;
            if (params.filters.review_status) rest.review_status = params.filters.review_status;
            if (params.filters.review_decision) rest.review_decision = params.filters.review_decision;
            if (params.filters.promotion_status) rest.promotion_status = params.filters.promotion_status;
            if (params.filters.class_code) rest.class_code = params.filters.class_code;
            if (params.qApplied) rest.q = params.qApplied;
            const data = await getEntityCandidates(params.apiFamily, rest, { signal });
            return data.total ?? 0;
        },
        enabled: shouldFetchCount,
        ...importReviewListQueryDefaults,
        refetchOnMount: false,
    });

    const ambiguous = query.error ? importReviewAmbiguousFromError(query.error) : null;

    return {
        list: query.data ?? null,
        totalCount: countQuery.data ?? cachedCount,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: ambiguous
            ? ""
            : query.error
              ? formatImportReviewApiError(query.error, "Failed to load candidates.")
              : "",
        ambiguousBatches: ambiguous?.batches ?? null,
        ambiguousSnapshot: ambiguous?.sourceSnapshotVersion ?? "",
        refetch: () => void query.refetch(),
        /**
         * Updates any cached list pages for this family (all scopes/filters/offsets).
         * Used after mutations to avoid full page reload / expensive refetch chains.
         */
        patchListItemEverywhere: (
            updatedId: string,
            patch: (
                item: ImportReviewBuildingsListResponse["items"][number]
            ) => ImportReviewBuildingsListResponse["items"][number]
        ) => {
            const family = params?.apiFamily ?? "";
            if (!family) {
                return;
            }
            queryClient.setQueriesData<ImportReviewBuildingsListResponse>(
                { queryKey: ["import-review", "candidates", family] },
                (prev) => {
                    if (!prev) {
                        return prev;
                    }
                    return {
                        ...prev,
                        items: prev.items.map((item) =>
                            item.id === updatedId ? patch(item) : item
                        ),
                    };
                }
            );
        },
        patchListItem: (updatedId: string, patch: (item: ImportReviewBuildingsListResponse["items"][number]) => ImportReviewBuildingsListResponse["items"][number]) => {
            if (!params) {
                return;
            }
            const key = importReviewQueryKeys.candidatesList({
                apiFamily: params.apiFamily,
                apiScopeQuery: params.apiScopeQuery,
                limit: params.limit,
                offset: params.offset,
                sort: params.sort,
                filters: params.filters,
                qApplied: params.qApplied,
                promotionState: params.promotionState,
            });
            queryClient.setQueryData<ImportReviewBuildingsListResponse>(key, (prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    items: prev.items.map((item) => (item.id === updatedId ? patch(item) : item)),
                };
            });
        },
    };
}
