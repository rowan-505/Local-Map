"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
    getImportTransportCandidateDetail,
    getImportTransportValidationIssues,
    postImportTransportValidateCandidate,
} from "../api/importTransportApiClient";
import { formatImportTransportApiError } from "../api/importTransportApiErrors";
import {
    IMPORT_TRANSPORT_DEFAULT_SORT,
    IMPORT_TRANSPORT_LIMIT_CHOICES,
} from "../config/constants";
import { getImportTransportEntityConfigBySlug } from "../config/importTransportEntityConfigs";
import type { ImportTransportListFilters, ImportTransportListItem, ImportTransportValidationIssue } from "../config/types";
import { IMPORT_TRANSPORT_API_FAMILY_ENTITY_KIND } from "../utils/importTransportValidation";
import {
    preserveImportTransportScopeInParams,
    readImportTransportListFilters,
} from "../utils/importTransportScope";
import { importTransportDrawerMapInput } from "../utils/mapPreviewUtils";
import { importTransportPath } from "@/src/lib/dashboardPaths";

import { getImportTransportEntitySlugFromPathname } from "../navigation/importTransportRoutes";
import { useImportTransportBatchContext } from "./useImportTransportBatchContext";
import { useImportTransportEntityList } from "./useImportTransportEntityList";
import { useImportTransportOptions } from "./useImportTransportOptions";

export type UseImportTransportEntityPageOptions = {
    showMapPreview?: boolean;
    enabled?: boolean;
};

export function useImportTransportEntityPage(
    slug: string,
    options: UseImportTransportEntityPageOptions = {}
) {
    const showMapPreview = options.showMapPreview ?? false;
    const router = useRouter();
    const pathname = usePathname() ?? "";
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();

    const config = useMemo(() => getImportTransportEntityConfigBySlug(slug), [slug]);
    const routeActive =
        options.enabled !== false &&
        getImportTransportEntitySlugFromPathname(pathname) === slug.trim().toLowerCase();
    const batchContext = useImportTransportBatchContext();
    const { data: optionsData, isLoading: isLoadingOptions } = useImportTransportOptions(Boolean(config) && routeActive);

    const filtersFromUrl = useMemo(() => readImportTransportListFilters(searchParams), [searchKey]);
    const sortFromUrl = searchParams.get("sort")?.trim() || config?.defaultSort || IMPORT_TRANSPORT_DEFAULT_SORT;
    const limitFromUrl = (() => {
        const raw = Number.parseInt(searchParams.get("limit") ?? "50", 10);
        return IMPORT_TRANSPORT_LIMIT_CHOICES.includes(raw as (typeof IMPORT_TRANSPORT_LIMIT_CHOICES)[number])
            ? raw
            : 50;
    })();
    const offsetFromUrl = Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0;
    const qFromUrl = searchParams.get("q")?.trim() ?? "";
    const showPromotedFromUrl =
        searchParams.get("include_promoted") === "true" ||
        searchParams.get("include_promoted") === "1";

    const [filters, setFilters] = useState<ImportTransportListFilters>(filtersFromUrl);
    const [qDraft, setQDraft] = useState(qFromUrl);
    const [qApplied, setQApplied] = useState(qFromUrl);
    const [sort, setSort] = useState(sortFromUrl);
    const [limit, setLimit] = useState(limitFromUrl);
    const [showPromoted, setShowPromoted] = useState(showPromotedFromUrl);
    const [isApplyingFilters, setIsApplyingFilters] = useState(false);

    useEffect(() => {
        setFilters(filtersFromUrl);
        setQDraft(qFromUrl);
        setQApplied(qFromUrl);
        setSort(sortFromUrl);
        setLimit(limitFromUrl);
        setShowPromoted(showPromotedFromUrl);
        setIsApplyingFilters(false);
    }, [filtersFromUrl, qFromUrl, sortFromUrl, limitFromUrl, showPromotedFromUrl]);

    const listParams =
        config && batchContext.apiScopeQuery
            ? {
                  apiFamily: config.apiFamily,
                  apiScopeQuery: batchContext.apiScopeQuery,
                  limit: limitFromUrl,
                  offset: offsetFromUrl,
                  sort: sortFromUrl,
                  filters: filtersFromUrl,
                  qApplied: qFromUrl,
                  showPromoted: showPromotedFromUrl,
              }
            : null;

    const hasValidScope =
        routeActive &&
        batchContext.status === "resolved" &&
        batchContext.apiScopeQuery !== null;

    const listState = useImportTransportEntityList(
        listParams,
        hasValidScope
    );

    useEffect(() => {
        const batchFromList = listState.list?.import_batch_id?.trim();
        if (batchFromList) {
            batchContext.syncResolvedBatchToUrl(batchFromList);
        }
    }, [listState.list?.import_batch_id, batchContext.syncResolvedBatchToUrl]);

    useEffect(() => {
        if (!listState.isRefreshingCandidates) {
            setIsApplyingFilters(false);
        }
    }, [listState.isRefreshingCandidates]);

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [detailRow, setDetailRow] = useState<ImportTransportListItem | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [validationIssues, setValidationIssues] = useState<ImportTransportValidationIssue[]>([]);
    const [validationIssuesLoading, setValidationIssuesLoading] = useState(false);
    const [validationIssuesError, setValidationIssuesError] = useState("");
    const [isValidating, setIsValidating] = useState(false);
    const [validateError, setValidateError] = useState("");

    const loadValidationIssues = useCallback(
        async (candidateId: string) => {
            if (!config || !batchContext.apiScopeQuery) {
                return;
            }
            setValidationIssuesLoading(true);
            setValidationIssuesError("");
            try {
                const response = await getImportTransportValidationIssues({
                    ...batchContext.apiScopeQuery,
                    entity_kind: IMPORT_TRANSPORT_API_FAMILY_ENTITY_KIND[config.apiFamily],
                    entity_id: candidateId,
                    limit: 100,
                    offset: 0,
                });
                setValidationIssues(response.items);
            } catch (err) {
                setValidationIssues([]);
                setValidationIssuesError(
                    formatImportTransportApiError(err, "Failed to load validation issues.")
                );
            } finally {
                setValidationIssuesLoading(false);
            }
        },
        [batchContext.apiScopeQuery, config]
    );

    const overviewHref = useMemo(() => {
        const scope = preserveImportTransportScopeInParams(searchParams);
        const qs = scope.toString();
        return qs ? `${importTransportPath()}?${qs}` : importTransportPath();
    }, [searchKey]);

    const openDrawer = useCallback(
        async (row: ImportTransportListItem) => {
            if (!config || !batchContext.apiScopeQuery) {
                return;
            }
            setDrawerOpen(true);
            setDetailRow(row);
            setDetailError("");
            setDetailLoading(true);
            try {
                const detail = await getImportTransportCandidateDetail(
                    config.apiFamily,
                    row.id,
                    {
                        ...batchContext.apiScopeQuery,
                        include_geometry: config.supportsMapPreview,
                    }
                );
                setDetailRow(detail);
                await loadValidationIssues(row.id);
            } catch (err) {
                setDetailError(
                    formatImportTransportApiError(err, "Failed to load candidate detail.")
                );
            } finally {
                setDetailLoading(false);
            }
        },
        [batchContext.apiScopeQuery, config, loadValidationIssues]
    );

    const validateCandidate = useCallback(
        async (input: { confirm_warnings: boolean; review_note: string }) => {
            if (!config || !batchContext.apiScopeQuery || !detailRow) {
                return;
            }
            setIsValidating(true);
            setValidateError("");
            try {
                const result = await postImportTransportValidateCandidate(
                    config.apiFamily,
                    detailRow.id,
                    batchContext.apiScopeQuery,
                    {
                        confirm_warnings: input.confirm_warnings,
                        review_note: input.review_note || undefined,
                    }
                );
                setValidationIssues(result.issues);
                const detail = await getImportTransportCandidateDetail(
                    config.apiFamily,
                    detailRow.id,
                    {
                        ...batchContext.apiScopeQuery,
                        include_geometry: config.supportsMapPreview,
                    }
                );
                setDetailRow(detail);
                void listState.refetchList();
            } catch (err) {
                setValidateError(formatImportTransportApiError(err, "Validation failed."));
            } finally {
                setIsValidating(false);
            }
        },
        [batchContext.apiScopeQuery, config, detailRow, listState]
    );

    const closeDrawer = useCallback(() => {
        setDrawerOpen(false);
        setDetailRow(null);
        setDetailError("");
        setValidationIssues([]);
        setValidationIssuesError("");
        setValidateError("");
    }, []);

    const replaceQuery = useCallback(
        (mutate: (params: URLSearchParams) => void) => {
            const next = new URLSearchParams(searchParams.toString());
            mutate(next);
            router.replace(`${pathname}?${next.toString()}`);
        },
        [pathname, router, searchParams]
    );

    const handleShowPromotedChange = useCallback(
        (value: boolean) => {
            setShowPromoted(value);
            setIsApplyingFilters(true);
            replaceQuery((params) => {
                if (value) {
                    params.set("include_promoted", "true");
                } else {
                    params.delete("include_promoted");
                }
                params.set("offset", "0");
            });
        },
        [replaceQuery]
    );

    const applyFiltersToUrl = useCallback(() => {
        setIsApplyingFilters(true);
        replaceQuery((params) => {
            for (const key of [
                "review_status",
                "review_decision",
                "promotion_status",
                "validation_status",
                "mode_type",
            ] as const) {
                const value = filters[key].trim();
                if (value) {
                    params.set(key, value);
                } else {
                    params.delete(key);
                }
            }
            if (qDraft.trim()) {
                params.set("q", qDraft.trim());
            } else {
                params.delete("q");
            }
            params.set("sort", sort);
            params.set("limit", String(limit));
            params.set("offset", "0");
            if (showPromoted) {
                params.set("include_promoted", "true");
            } else {
                params.delete("include_promoted");
            }
        });
        setQApplied(qDraft.trim());
    }, [filters, limit, qDraft, replaceQuery, showPromoted, sort]);

    const clearFilters = useCallback(() => {
        const cleared: ImportTransportListFilters = {
            review_status: "",
            review_decision: "",
            promotion_status: "",
            validation_status: "",
            mode_type: "",
        };
        setFilters(cleared);
        setQDraft("");
        setQApplied("");
        setSort(config?.defaultSort ?? IMPORT_TRANSPORT_DEFAULT_SORT);
        setLimit(50);
        setShowPromoted(false);
        setIsApplyingFilters(true);
        replaceQuery((params) => {
            for (const key of [
                "review_status",
                "review_decision",
                "promotion_status",
                "validation_status",
                "mode_type",
                "q",
                "include_promoted",
            ]) {
                params.delete(key);
            }
            params.set("sort", config?.defaultSort ?? IMPORT_TRANSPORT_DEFAULT_SORT);
            params.set("limit", "50");
            params.set("offset", "0");
        });
    }, [config?.defaultSort, replaceQuery]);

    const drawerMap = useMemo(() => {
        if (!config?.supportsMapPreview || !detailRow) {
            return null;
        }
        return importTransportDrawerMapInput(detailRow, config.geometryType);
    }, [config, detailRow]);

    const sidebarMap = useMemo(() => {
        if (!showMapPreview || !config?.supportsMapPreview || !drawerOpen || !detailRow) {
            return null;
        }
        return drawerMap;
    }, [showMapPreview, config, drawerOpen, detailRow, drawerMap]);

    return {
        config,
        overviewHref,
        hasValidScope,
        isApplyingScope: batchContext.isLoadingBatchContext,
        batchContext,
        list: listState.list,
        listTotal: listState.listTotal,
        listError: listState.listError || batchContext.error,
        isInitialCandidatesLoad: listState.isInitialCandidatesLoad,
        isRefreshingCandidates: listState.isRefreshingCandidates,
        filters,
        setFilters,
        sort,
        setSort,
        limit,
        setLimit,
        offset: offsetFromUrl,
        qDraft,
        setQDraft,
        qApplied,
        showPromoted,
        setShowPromoted: handleShowPromotedChange,
        filterOptions: optionsData ?? null,
        isLoadingOptions,
        isApplyingFilters,
        applyFiltersToUrl,
        clearFilters,
        drawerOpen,
        detailRow,
        detailLoading,
        detailError,
        validateError,
        validationIssues,
        validationIssuesLoading,
        validationIssuesError,
        isValidating,
        validateCandidate,
        openDrawer,
        closeDrawer,
        drawerMap,
        sidebarMap,
        showMapPreview,
        pathname,
        router,
        searchParams,
        replaceQuery,
    };
}
