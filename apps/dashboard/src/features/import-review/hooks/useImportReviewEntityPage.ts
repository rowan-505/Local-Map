"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useClearSelectionOnListQueryChange } from "./useClearSelectionOnListQueryChange";

import {
    formatImportReviewApiError,
    getEntityCandidateDetail,
    patchEntityDecision,
    patchEntityColumns,
} from "@/src/features/import-review/api";
import {
    formatImportReviewTechnicalError,
    formatImportReviewUserError,
    isImportReviewDevMode,
} from "@/src/features/import-review/utils/importReviewDetailErrors";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import { useImportReviewEntityList } from "./useImportReviewEntityList";
import { useImportReviewFamilyFilterOptions } from "./useImportReviewFamilyFilterOptions";
import { useImportReviewFormOptions } from "./useImportReviewFormOptions";
import { isImportReviewDetailNotFound } from "@/src/features/import-review/utils/detailDrawerUtils";
import { getImportReviewEntityConfigBySlug, toDataReviewGeometryKind } from "@/src/features/import-review/config";
import type { ImportReviewEntityConfig } from "@/src/features/import-review/config";
import { entityDrawerMapInput } from "@/src/lib/importReviewDrawerMapGeometry";
import {
    isAbortError,
    type ImportReviewBuildingListItem,
    type ImportReviewBuildingsListResponse,
    type ImportReviewDecision,
} from "@/src/lib/api";
import { deriveImportReviewEditorUxCanMutate } from "@/src/lib/importReviewEditorUx";
import { importReviewOverviewHref } from "@/src/lib/importReviewEntityConfig";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromApiScopeQuery,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
    type ImportReviewScopeQueryParams,
} from "@/src/lib/importReviewSnapshot";

import { getImportReviewEntitySlugFromPathname } from "../navigation/importReviewRoutes";
import {
    replaceImportReviewSearchParams,
    type ReplaceImportReviewSearchParamsMeta,
} from "../navigation/replaceImportReviewSearchParams";
import {
    assertValidDirectEditPatchResponse,
    DirectEditSaveError,
    logDirectEditSaveDev,
    mergeDirectEditSaveDetailRow,
    syncImportReviewListCacheAfterDirectEditSave,
    verifyDirectEditPersisted,
} from "../utils/directEditSave";
import {
    diffImportReviewSearchKeys,
    logImportReviewPageRender,
    logImportReviewUrlSync,
    logImportReviewQueryKeyChange,
    logImportReviewUserAction,
} from "../utils/importReviewRequestDebug";
import { useImportReviewBatchContext } from "./useImportReviewBatchContext";
import { useImportReviewBulkActions } from "./useImportReviewBulkActions";
import {
    IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT,
    type ImportReviewPromotionCompletedDetail,
} from "./invalidateImportReviewAfterPromotion";
import { importReviewApiFamilyForPromotionFamily } from "../utils/importReviewPromotionCoreReviewMap";
import { importReviewQueryKeys } from "./importReviewQueryKeys";
import {
    buildImportReviewListQueryKey,
    IMPORT_REVIEW_LIMIT_CHOICES,
    readImportReviewListFilters,
    type ImportReviewListFilters,
} from "../utils/entityPageUtils";
import { overrideFieldDefsForEntity } from "../config/overrideFieldDefs";

const ENV_SNAPSHOT_DEFAULT = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

function mutationScope(
    list: ImportReviewBuildingsListResponse | null,
    scope: ImportReviewScopeQueryParams | null
): { review_batch_id?: string; source_snapshot_version?: string } {
    if (list?.review_batch_id?.trim()) {
        return { review_batch_id: list.review_batch_id };
    }
    if (!scope) {
        return {};
    }
    if ("review_batch_id" in scope) {
        return { review_batch_id: scope.review_batch_id };
    }
    return { source_snapshot_version: scope.source_snapshot_version };
}

export type UseImportReviewEntityPageOptions = {
    /** Sticky sidebar map (data-review layout). Loads list geometries when config.supportsMapPreview. */
    showMapPreview?: boolean;
    /**
     * When false, skips batch resolution and all entity list/detail/options fetches.
     * Defaults to true only when the current pathname is this entity's route.
     */
    enabled?: boolean;
};

export function useImportReviewEntityPage(
    slug: string,
    options: UseImportReviewEntityPageOptions = {}
) {
    const showMapPreview = options.showMapPreview ?? false;
    const pathname = usePathname();
    const routeActive =
        options.enabled ??
        getImportReviewEntitySlugFromPathname(pathname ?? "") === slug.trim().toLowerCase();
    const config = getImportReviewEntityConfigBySlug(slug);
    const needsFormOptions = Boolean(
        config?.supportsOverrideEditor || (config?.overrideEditableFields.length ?? 0) > 0
    );
    const {
        formOptions,
        isLoading: formOptionsLoading,
        error: formOptionsError,
    } = useImportReviewFormOptions(needsFormOptions && routeActive);
    const router = useRouter();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();

    const batchContext = useImportReviewBatchContext({
        /** Entity pages require review_batch_id in URL — skip summary probe that refetches scope. */
        resolveSnapshotScope: false,
        useEnvDefault: false,
        enabled: routeActive,
    });

    const snapshotUrl = snapshotVersionFromImportReviewSearch(searchParams);
    const batchUrl = reviewBatchIdFromImportReviewSearch(searchParams);

    const [snapshotInput, setSnapshotInput] = useState(
        () => (batchUrl ? "" : snapshotUrl || ENV_SNAPSHOT_DEFAULT)
    );
    const [batchInput, setBatchInput] = useState(() => batchUrl || "");
    const [filters, setFilters] = useState<ImportReviewListFilters>(() =>
        readImportReviewListFilters(searchParams)
    );
    const [qDraft, setQDraft] = useState(searchParams.get("q")?.trim() ?? "");
    const [qApplied, setQApplied] = useState(searchParams.get("q")?.trim() ?? "");
    const [sort, setSort] = useState(searchParams.get("sort")?.trim() || config?.defaultSort || "updated_at_desc");
    const [limit, setLimit] = useState(() => {
        const raw = Number(searchParams.get("limit"));
        return IMPORT_REVIEW_LIMIT_CHOICES.includes(raw as (typeof IMPORT_REVIEW_LIMIT_CHOICES)[number])
            ? raw
            : 50;
    });
    const [offset, setOffset] = useState(() => {
        const raw = Number(searchParams.get("offset"));
        return Number.isFinite(raw) && raw >= 0 ? raw : 0;
    });
    const [showPromoted, setShowPromoted] = useState(
        () =>
            searchParams.get("include_promoted") === "true" ||
            searchParams.get("include_promoted") === "1"
    );

    const [isApplyingFilters, setIsApplyingFilters] = useState(false);
    const [cachedListTotal, setCachedListTotal] = useState<number | null>(null);
    const [mapPreviewRow, setMapPreviewRow] = useState<ImportReviewBuildingListItem | null>(null);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [rowActionBusyId, setRowActionBusyId] = useState<string | null>(null);
    const [canEditImportReview, setCanEditImportReview] = useState(false);

    const [drawerRow, setDrawerRow] = useState<ImportReviewBuildingListItem | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [detailTechnicalError, setDetailTechnicalError] = useState("");
    const [geometryError, setGeometryError] = useState("");
    const [geometryTechnicalError, setGeometryTechnicalError] = useState("");
    const [detailNotFound, setDetailNotFound] = useState(false);
    const [isLoadingGeometry, setIsLoadingGeometry] = useState(false);
    const [drawerNote, setDrawerNote] = useState("");
    const [drawerDecision, setDrawerDecision] = useState<ImportReviewDecision>("needs_more_review");
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingOverrides, setIsSavingOverrides] = useState(false);
    const [overrideSaveMessage, setOverrideSaveMessage] = useState<string | null>(null);
    const [overrideSaveTechnicalError, setOverrideSaveTechnicalError] = useState<string | null>(null);
    const [decisionSaveMessage, setDecisionSaveMessage] = useState<string | null>(null);

    const apiScopeQuery = batchContext.apiScopeQuery;
    const resolvedReviewBatchId = reviewBatchIdFromApiScopeQuery(apiScopeQuery);
    const syncResolvedBatchToUrl = batchContext.syncResolvedBatchToUrl;
    const detailCacheScope = resolvedReviewBatchId ?? "none";
    const detailQueryKeyFor = useCallback(
        (candidateId: string) =>
            ["import-review", "detail", config?.apiFamily ?? "", candidateId, detailCacheScope] as const,
        [config?.apiFamily, detailCacheScope]
    );
    const geometryQueryKeyFor = useCallback(
        (candidateId: string) =>
            ["import-review", "geometry", config?.apiFamily ?? "", candidateId, detailCacheScope] as const,
        [config?.apiFamily, detailCacheScope]
    );

    const listQueryKey = useMemo(
        () =>
            buildImportReviewListQueryKey({
                apiScopeQuery,
                limit,
                offset,
                sort,
                filters,
                qApplied,
                showPromoted,
                apiFamily: config?.apiFamily,
            }),
        [resolvedReviewBatchId, limit, offset, sort, filters, qApplied, showPromoted, config?.apiFamily]
    );

    useClearSelectionOnListQueryChange(listQueryKey, setSelectedIds);

    useEffect(() => {
        setCachedListTotal(null);
    }, [listQueryKey]);

    const hasValidScope =
        routeActive &&
        apiScopeQuery !== null &&
        config !== null &&
        !batchContext.isLoadingBatchContext &&
        batchContext.status !== "multiple_batches";

    const listParams = useMemo(() => {
        if (!hasValidScope || !apiScopeQuery || !config) {
            return null;
        }
        return {
            apiFamily: config.apiFamily,
            apiScopeQuery,
            limit,
            offset,
            sort,
            filters,
            qApplied,
            showPromoted,
        };
    }, [hasValidScope, apiScopeQuery, resolvedReviewBatchId, config, limit, offset, sort, filters, qApplied, showPromoted]);

    const candidatesQueryKey = useMemo(
        () =>
            importReviewQueryKeys.candidatesList(
                listParams
                    ? {
                          apiFamily: listParams.apiFamily,
                          apiScopeQuery: listParams.apiScopeQuery,
                          limit: listParams.limit,
                          offset: listParams.offset,
                          sort: listParams.sort,
                          filters: listParams.filters,
                          qApplied: listParams.qApplied,
                          showPromoted: listParams.showPromoted,
                      }
                    : null
            ),
        [listParams]
    );

    useEffect(() => {
        if (!routeActive || !config) {
            return;
        }
        logImportReviewQueryKeyChange({
            source: "useImportReviewEntityPage",
            route_slug: slug,
            list_query_key: listQueryKey,
            react_query_key: candidatesQueryKey,
        });
    }, [routeActive, slug, config, listQueryKey, candidatesQueryKey]);

    const {
        list,
        totalCount,
        isLoading: isLoadingCandidates,
        isFetching: isRefreshingList,
        error: listError,
        ambiguousBatches: listAmbiguousBatches,
        ambiguousSnapshot: listAmbiguousSnapshot,
        refetch: refetchList,
        patchListItem,
        patchListItemEverywhere,
    } = useImportReviewEntityList(listParams, hasValidScope);

    useEffect(() => {
        if (!routeActive || !config?.apiFamily) {
            return;
        }
        const apiFamily = config.apiFamily;
        const onPromotionCompleted = (event: Event) => {
            const detail = (event as CustomEvent<ImportReviewPromotionCompletedDetail>).detail;
            const promoted = detail?.promotedFamilies ?? [];
            if (
                promoted.length === 0 ||
                promoted.some((family) => importReviewApiFamilyForPromotionFamily(family) === apiFamily)
            ) {
                void refetchList();
            }
        };
        window.addEventListener(IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT, onPromotionCompleted);
        return () => window.removeEventListener(IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT, onPromotionCompleted);
    }, [routeActive, config?.apiFamily, refetchList]);

    useEffect(() => {
        if (list?.total !== undefined) {
            setCachedListTotal(list.total);
        }
        if (totalCount !== null) {
            setCachedListTotal(totalCount);
        }
        const batchFromList = list?.review_batch_id?.trim();
        if (batchFromList && batchFromList !== batchUrl.trim()) {
            syncResolvedBatchToUrl(batchFromList);
        }
    }, [list, totalCount, syncResolvedBatchToUrl, batchUrl]);

    useEffect(() => {
        if (!isRefreshingList) {
            setIsApplyingFilters(false);
        }
    }, [isRefreshingList]);

    const filterOptionsReady =
        hasValidScope && (list !== null || (!isLoadingCandidates && !listError));

    const {
        filterOptions,
        isLoadingFilters,
        ambiguousBatches: filterAmbiguousBatches,
        ambiguousSnapshot: filterAmbiguousSnapshot,
    } = useImportReviewFamilyFilterOptions({
        apiFamily: config?.apiFamily,
        apiScopeQuery,
        enabled: routeActive && Boolean(config) && filterOptionsReady,
    });

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void, meta?: ReplaceImportReviewSearchParamsMeta) => {
            replaceImportReviewSearchParams(router, pathname ?? "", searchParams, mutate, meta);
        },
        [router, pathname, searchParams]
    );

    const searchKey = searchParams.toString();
    const prevSearchKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!routeActive) {
            return;
        }
        logImportReviewPageRender({
            component: "useImportReviewEntityPage",
            route_slug: slug,
            route_family: config?.apiFamily ?? null,
            pathname: pathname ?? "",
            route_active: routeActive,
            scope: {
                review_batch_id: batchUrl || null,
                source_snapshot_version: snapshotUrl || null,
            },
        });
    }, [routeActive, slug, config?.apiFamily, pathname, batchUrl, snapshotUrl]);

    useEffect(() => {
        if (!routeActive) {
            prevSearchKeyRef.current = searchKey;
            return;
        }
        const prev = prevSearchKeyRef.current;
        if (prev !== null && prev !== searchKey) {
            logImportReviewUrlSync({
                source: "useImportReviewEntityPage",
                reason: "searchParams_changed",
                pathname: pathname ?? "",
                previous_query: prev,
                next_query: searchKey,
                changed_keys: diffImportReviewSearchKeys(prev, searchKey),
            });
        }
        prevSearchKeyRef.current = searchKey;
    }, [routeActive, searchKey, pathname]);
    const overviewHref = useMemo(() => {
        const sp = new URLSearchParams(searchKey);
        return importReviewOverviewHref(sp);
    }, [searchKey]);

    useEffect(() => {
        setCanEditImportReview(deriveImportReviewEditorUxCanMutate());
    }, []);

    useEffect(() => {
        if (batchUrl.trim()) {
            setBatchInput(batchUrl);
            setSnapshotInput("");
        } else {
            setBatchInput("");
            setSnapshotInput(snapshotUrl || ENV_SNAPSHOT_DEFAULT);
        }
    }, [batchUrl, snapshotUrl]);

    useEffect(() => {
        setFilters(readImportReviewListFilters(searchParams));
        const q = searchParams.get("q")?.trim() ?? "";
        setQDraft(q);
        setQApplied(q);
        setSort(searchParams.get("sort")?.trim() || config?.defaultSort || "updated_at_desc");
        const lim = Number(searchParams.get("limit"));
        setLimit(
            IMPORT_REVIEW_LIMIT_CHOICES.includes(lim as (typeof IMPORT_REVIEW_LIMIT_CHOICES)[number])
                ? lim
                : 50
        );
        const off = Number(searchParams.get("offset"));
        setOffset(Number.isFinite(off) && off >= 0 ? off : 0);
        setShowPromoted(
            searchParams.get("include_promoted") === "true" ||
                searchParams.get("include_promoted") === "1"
        );
    }, [searchParams, config?.defaultSort]);

    useEffect(() => {
        if (!routeActive) {
            setIsApplyingFilters(false);
            setSelectedIds(new Set());
            setDrawerRow(null);
            setMapPreviewRow(null);
        }
    }, [routeActive]);

    const openDrawer = useCallback((row: ImportReviewBuildingListItem) => {
        setDetailError("");
        setDetailTechnicalError("");
        setGeometryError("");
        setGeometryTechnicalError("");
        setDetailNotFound(false);
        setIsLoadingDetail(false);
        setIsLoadingGeometry(false);
        setDrawerRow(row);
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawerRow(null);
        setDetailError("");
        setDetailTechnicalError("");
        setGeometryError("");
        setGeometryTechnicalError("");
        setDetailNotFound(false);
        setIsLoadingDetail(false);
        setIsLoadingGeometry(false);
        setOverrideSaveMessage(null);
        setOverrideSaveTechnicalError(null);
        setDecisionSaveMessage(null);
    }, []);

    const fetchDrawerGeometry = useCallback(
        async (candidateId: string, signal?: AbortSignal) => {
            if (!config?.supportsMapPreview || !apiScopeQuery) {
                return;
            }
            const cachedGeometry = queryClient.getQueryData<ImportReviewBuildingListItem>(
                geometryQueryKeyFor(candidateId)
            );
            if (cachedGeometry) {
                setDrawerRow((prev) => (prev && prev.id === candidateId ? cachedGeometry : prev));
            }
            setIsLoadingGeometry(true);
            setGeometryError("");
            setGeometryTechnicalError("");
            try {
                const withGeometry = await getEntityCandidateDetail(
                    config.apiFamily,
                    candidateId,
                    { ...apiScopeQuery, include_geometry: true },
                    signal ? { signal } : undefined
                );
                queryClient.setQueryData(geometryQueryKeyFor(candidateId), withGeometry);
                queryClient.setQueryData(detailQueryKeyFor(candidateId), withGeometry);
                setDrawerRow(withGeometry);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setGeometryError(
                    formatImportReviewUserError(err, IMPORT_REVIEW_LOADING.geometryFailedToLoad)
                );
                setGeometryTechnicalError(formatImportReviewTechnicalError(err));
            } finally {
                if (!signal?.aborted) {
                    setIsLoadingGeometry(false);
                }
            }
        },
        [config, apiScopeQuery, queryClient, detailQueryKeyFor, geometryQueryKeyFor]
    );

    useEffect(() => {
        if (!routeActive || !drawerRow || !config || !apiScopeQuery) {
            return;
        }
        setDrawerNote(drawerRow.review_note ?? "");
        const d = drawerRow.review_decision;
        if (
            d === "approved" ||
            d === "rejected" ||
            d === "needs_more_review" ||
            d === "ignored" ||
            d === "merged"
        ) {
            setDrawerDecision(d);
        } else {
            setDrawerDecision("needs_more_review");
        }

        const candidateId = drawerRow.id;
        const c = new AbortController();
        setIsLoadingDetail(true);
        setIsLoadingGeometry(false);
        setDetailError("");
        setDetailTechnicalError("");
        setGeometryError("");
        setGeometryTechnicalError("");
        setDetailNotFound(false);

        void (async () => {
            try {
                const cachedDetail = queryClient.getQueryData<ImportReviewBuildingListItem>(
                    detailQueryKeyFor(candidateId)
                );
                if (cachedDetail && !c.signal.aborted) {
                    setDrawerRow(cachedDetail);
                    setDetailError("");
                    setDetailTechnicalError("");
                    setDetailNotFound(false);
                    setIsLoadingDetail(false);
                    if (config.supportsMapPreview && !(cachedDetail.geometry || cachedDetail.geom)) {
                        await fetchDrawerGeometry(candidateId, c.signal);
                    }
                    return;
                }
                const metadata = await getEntityCandidateDetail(
                    config.apiFamily,
                    candidateId,
                    { ...apiScopeQuery, include_geometry: false },
                    { signal: c.signal }
                );
                if (c.signal.aborted) {
                    return;
                }
                queryClient.setQueryData(detailQueryKeyFor(candidateId), metadata);
                setDrawerRow(metadata);
                setDetailError("");
                setDetailTechnicalError("");
                setDetailNotFound(false);
                setIsLoadingDetail(false);

                if (config.supportsMapPreview) {
                    await fetchDrawerGeometry(candidateId, c.signal);
                }
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                if (isImportReviewDetailNotFound(err)) {
                    setDetailNotFound(true);
                    setDetailError("");
                    setDetailTechnicalError("");
                    return;
                }
                setDetailError(
                    formatImportReviewUserError(err, IMPORT_REVIEW_LOADING.metadataFailedToLoad)
                );
                setDetailTechnicalError(formatImportReviewTechnicalError(err));
            } finally {
                if (!c.signal.aborted) {
                    setIsLoadingDetail(false);
                    setIsLoadingGeometry(false);
                }
            }
        })();

        return () => c.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when opening another row
    }, [
        routeActive,
        drawerRow?.id,
        config?.apiFamily,
        config?.supportsMapPreview,
        apiScopeQuery,
        fetchDrawerGeometry,
        queryClient,
        detailQueryKeyFor,
    ]);

    const mergeRow = (updated: ImportReviewBuildingListItem) => {
        setDrawerRow(updated);
        queryClient.setQueryData(detailQueryKeyFor(updated.id), updated);
        queryClient.setQueryData(geometryQueryKeyFor(updated.id), updated);
        patchListItemEverywhere(updated.id, () => updated);
        patchListItem(updated.id, () => updated);
        if (mapPreviewRow?.id === updated.id) {
            setMapPreviewRow(updated);
        }
    };

    const refetchDrawerDetail = useCallback(async () => {
        if (!drawerRow || !config || !apiScopeQuery) {
            return;
        }
        setDetailError("");
        setDetailTechnicalError("");
        setGeometryError("");
        setGeometryTechnicalError("");
        setIsLoadingDetail(true);
        try {
            const metadata = await getEntityCandidateDetail(config.apiFamily, drawerRow.id, {
                ...apiScopeQuery,
                include_geometry: false,
            });
            mergeRow(metadata);
            setIsLoadingDetail(false);
            if (config.supportsMapPreview) {
                await fetchDrawerGeometry(drawerRow.id);
            }
        } catch (err) {
            setDetailError(
                formatImportReviewUserError(err, IMPORT_REVIEW_LOADING.metadataFailedToLoad)
            );
            setDetailTechnicalError(formatImportReviewTechnicalError(err));
            setIsLoadingDetail(false);
        }
    }, [drawerRow, config, apiScopeQuery, fetchDrawerGeometry]);

    const retryDrawerGeometry = useCallback(() => {
        if (!drawerRow || !config?.supportsMapPreview) {
            return;
        }
        void fetchDrawerGeometry(drawerRow.id);
    }, [drawerRow, config, fetchDrawerGeometry]);

    const patchDecision = async (
        row: ImportReviewBuildingListItem,
        decision: ImportReviewDecision,
        opts?: { force?: boolean; confirmDuplicate?: boolean; note?: string | null }
    ) => {
        if (!config) {
            return;
        }
        const scopeBody = mutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            return;
        }
        const updated = await patchEntityDecision(config.apiFamily, row.id, {
            ...scopeBody,
            review_decision: decision,
            review_note: opts?.note !== undefined ? opts.note : row.review_note,
            force: opts?.force ?? false,
            confirm_duplicate_reviewed: opts?.confirmDuplicate ?? false,
        });
        mergeRow(updated);
    };

    const applyScopeToUrl = () => {
        logImportReviewUserAction({
            action: "apply_scope",
            source: "entity_page:apply_scope",
            route_slug: slug,
            scope: {
                review_batch_id: batchInput.trim() || null,
                source_snapshot_version: snapshotInput.trim() || null,
            },
        });
        replaceQuery(
            (p) => {
                applyImportReviewScopeSearchParams(p, snapshotInput.trim(), batchInput.trim());
                p.set("offset", "0");
            },
            { source: "entity_page:apply_scope" }
        );
    };

    const applyFiltersToUrl = () => {
        logImportReviewUserAction({
            action: "apply_filters",
            source: "entity_page:apply_filters",
            route_slug: slug,
        });
        setIsApplyingFilters(true);
        replaceQuery(
            (p) => {
            applyImportReviewScopeSearchParams(p, snapshotInput.trim(), batchInput.trim());
            for (const key of [
                "match_status",
                "auto_action",
                "review_status",
                "review_decision",
                "promotion_status",
                "class_code",
            ] as const) {
                const val = filters[key].trim();
                if (val) {
                    p.set(key, val);
                } else {
                    p.delete(key);
                }
            }
            if (qDraft.trim()) {
                p.set("q", qDraft.trim());
            } else {
                p.delete("q");
            }
            p.set("sort", sort);
            p.set("limit", String(limit));
            p.set("offset", "0");
            if (showPromoted) {
                p.set("include_promoted", "true");
            } else {
                p.delete("include_promoted");
            }
            },
            { source: "entity_page:apply_filters" }
        );
        setQApplied(qDraft.trim());
    };

    const clearFilters = () => {
        logImportReviewUserAction({
            action: "clear_filters",
            source: "entity_page:clear_filters",
            route_slug: slug,
        });
        setFilters({
            match_status: "",
            auto_action: "",
            review_status: "",
            review_decision: "",
            promotion_status: "",
            class_code: "",
        });
        setQDraft("");
        replaceQuery(
            (p) => {
                applyImportReviewScopeSearchParams(p, snapshotInput.trim(), batchInput.trim());
                [
                    "match_status",
                    "auto_action",
                    "review_status",
                    "review_decision",
                    "promotion_status",
                    "class_code",
                    "q",
                ].forEach((k) => p.delete(k));
                p.set("offset", "0");
            },
            { source: "entity_page:clear_filters" }
        );
        setQApplied("");
    };

    const ambiguousBatches =
        listAmbiguousBatches ?? filterAmbiguousBatches ?? batchContext.ambiguousBatches;
    const ambiguousSnapshot =
        listAmbiguousSnapshot ||
        filterAmbiguousSnapshot ||
        batchContext.ambiguousSnapshot ||
        snapshotInput.trim();

    const drawerMap = useMemo(() => {
        if (!drawerRow || !config) {
            return null;
        }
        return entityDrawerMapInput(drawerRow, toDataReviewGeometryKind(config.geometryType));
    }, [drawerRow, config]);

    const sidebarSelectionRow = useMemo(() => {
        if (drawerRow) {
            return drawerRow;
        }
        if (selectedIds.size !== 1 || !list) {
            return null;
        }
        const id = [...selectedIds][0];
        return list.items.find((r: ImportReviewBuildingListItem) => r.id === id) ?? null;
    }, [drawerRow, selectedIds, list]);

    useEffect(() => {
        if (!showMapPreview || !config?.supportsMapPreview || !sidebarSelectionRow || drawerRow) {
            setMapPreviewRow(null);
            return;
        }
        const hasGeom =
            Boolean(sidebarSelectionRow.geometry) || Boolean(sidebarSelectionRow.geom);
        if (hasGeom) {
            setMapPreviewRow(sidebarSelectionRow);
            return;
        }
        if (!apiScopeQuery || !config) {
            return;
        }
        const apiFamily = config.apiFamily;
        const c = new AbortController();
        void getEntityCandidateDetail(
            apiFamily,
            sidebarSelectionRow.id,
            { ...apiScopeQuery, include_geometry: true },
            { signal: c.signal }
        )
            .then((detail) => {
                setMapPreviewRow(detail);
            })
            .catch(() => {
                setMapPreviewRow(sidebarSelectionRow);
            });
        return () => c.abort();
    }, [showMapPreview, config, sidebarSelectionRow, drawerRow, apiScopeQuery]);

    const sidebarMap = useMemo(() => {
        const row = drawerRow ?? mapPreviewRow;
        if (!showMapPreview || !config?.supportsMapPreview || !row) {
            return null;
        }
        return entityDrawerMapInput(row, toDataReviewGeometryKind(config.geometryType));
    }, [showMapPreview, config, drawerRow, mapPreviewRow]);

    const handleRowAction = async (row: ImportReviewBuildingListItem, decision: ImportReviewDecision) => {
        if (!canEditImportReview || !config) {
            return;
        }
        setRowActionBusyId(row.id);
        try {
            if (decision === "approved" && row.match_status === "manual_protected") {
                const ok = window.confirm("manual_protected — approve with force=true?");
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { force: true });
                return;
            }
            if (decision === "approved" && row.match_status === "duplicate_candidate") {
                const ok = window.confirm("Approve duplicate_candidate with confirm_duplicate_reviewed?");
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { confirmDuplicate: true });
                return;
            }
            await patchDecision(row, decision);
        } catch (err) {
            window.alert(formatImportReviewApiError(err, "Update failed"));
        } finally {
            setRowActionBusyId(null);
        }
    };

    const handleDrawerCandidateFieldsSave = async (
        fieldsPatch: Record<string, unknown>,
        reviewNote: string | null,
        saveOptions?: {
            verifyPatchKeys?: readonly string[];
            referenceFieldsDevLog?: Record<string, unknown>;
        }
    ): Promise<ImportReviewBuildingListItem> => {
        if (!drawerRow || !canEditImportReview || !config || !apiScopeQuery) {
            throw new Error("Cannot save candidate edits: missing drawer row, scope, or config.");
        }
        if ((drawerRow.promotion_status ?? "").toLowerCase() === "promoted") {
            const msg = "Cannot edit candidate fields after promotion.";
            setOverrideSaveMessage(msg);
            throw new Error(msg);
        }
        const scopeBody = mutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            throw new Error("Cannot save candidate edits: review scope is missing.");
        }
        setIsSavingOverrides(true);
        setOverrideSaveMessage(null);
        setOverrideSaveTechnicalError(null);

        const fieldDefs = overrideFieldDefsForEntity(config);
        const requestBody = {
            ...scopeBody,
            fields: fieldsPatch,
            review_note: reviewNote,
        };

        try {
            const geometryTouched = Object.keys(fieldsPatch).some((key) =>
                key.toLowerCase().includes("geom")
            );

            const patchResponse = await patchEntityColumns(config.apiFamily, drawerRow.id, requestBody);
            assertValidDirectEditPatchResponse(patchResponse, drawerRow.id);

            const refreshed = await getEntityCandidateDetail(config.apiFamily, drawerRow.id, {
                ...apiScopeQuery,
                include_geometry: false,
            });
            assertValidDirectEditPatchResponse(refreshed, drawerRow.id);

            const verifyPatchKeys = saveOptions?.verifyPatchKeys;
            const categoryIdDev =
                saveOptions?.referenceFieldsDevLog?.category_id &&
                typeof saveOptions.referenceFieldsDevLog.category_id === "object"
                    ? (saveOptions.referenceFieldsDevLog.category_id as Record<string, unknown>)
                    : null;
            const referenceFieldsDevLog =
                categoryIdDev && process.env.NODE_ENV === "development"
                    ? {
                          category_id: {
                              ...categoryIdDev,
                              patchResponseCategoryId:
                                  (patchResponse as Record<string, unknown>).category_id ?? null,
                              refetchedCategoryId:
                                  (refreshed as Record<string, unknown>).category_id ?? null,
                          },
                      }
                    : saveOptions?.referenceFieldsDevLog;

            const verificationDetail = verifyDirectEditPersisted(
                fieldsPatch,
                refreshed,
                config.apiFamily,
                fieldDefs,
                verifyPatchKeys
            );
            if (verificationDetail) {
                logDirectEditSaveDev({
                    family: config.apiFamily,
                    candidateId: drawerRow.id,
                    request: requestBody,
                    patchResponse,
                    refetched: refreshed,
                    verificationError: verificationDetail,
                    referenceFields: referenceFieldsDevLog,
                });
                throw new DirectEditSaveError(
                    "Save verification failed: database value did not change.",
                    verificationDetail
                );
            }

            logDirectEditSaveDev({
                family: config.apiFamily,
                candidateId: drawerRow.id,
                request: requestBody,
                patchResponse,
                refetched: refreshed,
                referenceFields: referenceFieldsDevLog,
            });

            const detailRow = mergeDirectEditSaveDetailRow(patchResponse, refreshed, fieldsPatch);
            mergeRow(detailRow);
            await syncImportReviewListCacheAfterDirectEditSave({
                queryClient,
                candidatesQueryKey,
                candidateId: drawerRow.id,
                savedRow: detailRow,
                fieldsPatch,
                verifyPatchKeys,
                apiFamily: config.apiFamily,
                fieldDefs,
                patchListItem,
                patchListItemEverywhere,
            });
            void queryClient.invalidateQueries({
                queryKey: detailQueryKeyFor(detailRow.id),
                exact: true,
            });
            if (geometryTouched) {
                queryClient.setQueryData(geometryQueryKeyFor(detailRow.id), detailRow);
                void queryClient.invalidateQueries({
                    queryKey: geometryQueryKeyFor(detailRow.id),
                    exact: true,
                });
                if (config.supportsMapPreview) {
                    await fetchDrawerGeometry(detailRow.id);
                }
            }
            setOverrideSaveMessage("Saved changes.");
            setOverrideSaveTechnicalError(null);
            return detailRow;
        } catch (err) {
            const msg =
                err instanceof DirectEditSaveError
                    ? err.message
                    : formatImportReviewApiError(err, IMPORT_REVIEW_LOADING.failedToSaveCandidateChanges);
            const technical =
                err instanceof DirectEditSaveError
                    ? (err.technicalDetail ?? formatImportReviewTechnicalError(err))
                    : formatImportReviewTechnicalError(err);
            setOverrideSaveMessage(msg);
            setOverrideSaveTechnicalError(technical);
            throw new Error(msg);
        } finally {
            setIsSavingOverrides(false);
        }
    };

    const handleDrawerSave = async () => {
        if (!drawerRow || !canEditImportReview || !config) {
            return;
        }
        const scopeBody = mutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            return;
        }
        setIsSaving(true);
        setDecisionSaveMessage(null);
        try {
            const updated = await patchEntityDecision(config.apiFamily, drawerRow.id, {
                ...scopeBody,
                review_decision: drawerDecision,
                review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
            });
            mergeRow(updated);
            setDecisionSaveMessage("Decision saved.");
        } catch (err) {
            setDecisionSaveMessage(formatImportReviewApiError(err, "Failed to apply decision."));
        } finally {
            setIsSaving(false);
        }
    };

    const isRefreshingCandidates = hasValidScope && isRefreshingList && list !== null;
    const showCandidatesSkeleton =
        hasValidScope &&
        list === null &&
        !listError &&
        !(ambiguousBatches?.length) &&
        isLoadingCandidates;
    const isInitialCandidatesLoad = showCandidatesSkeleton;

    const bulk = useImportReviewBulkActions({
        items: list?.items ?? [],
        selectedIds,
        setSelectedIds,
        list,
        apiScopeQuery,
        apiFamily: config?.apiFamily ?? "",
        supportsBulkActions: config?.supportsBulkActions ?? false,
        canEdit: canEditImportReview,
        onListRefresh: () => {
            void refetchList();
        },
    });

    return {
        config: config as ImportReviewEntityConfig | null,
        overviewHref,
        batchContext,
        apiScopeQuery,
        hasValidScope,
        snapshotInput,
        setSnapshotInput,
        batchInput,
        setBatchInput,
        filters,
        setFilters,
        qDraft,
        setQDraft,
        sort,
        setSort,
        limit,
        setLimit,
        showPromoted,
        setShowPromoted,
        filterOptions,
        isLoadingFilters,
        isApplyingFilters,
        list,
        listTotal: list?.total ?? cachedListTotal ?? 0,
        hasMore: list?.has_more ?? false,
        isLoadingCandidates,
        isRefreshingCandidates,
        isInitialCandidatesLoad,
        listError,
        ambiguousBatches,
        ambiguousSnapshot,
        selectedIds,
        setSelectedIds,
        bulk,
        rowActionBusyId,
        canEditImportReview,
        drawerRow,
        openDrawer,
        closeDrawer,
        isLoadingDetail,
        isLoadingGeometry,
        detailError,
        detailTechnicalError: isImportReviewDevMode ? detailTechnicalError : "",
        geometryError,
        geometryTechnicalError: isImportReviewDevMode ? geometryTechnicalError : "",
        retryDrawerGeometry,
        detailNotFound,
        drawerNote,
        setDrawerNote,
        drawerDecision,
        setDrawerDecision,
        isSaving,
        isSavingOverrides,
        overrideSaveMessage,
        overrideSaveTechnicalError: isImportReviewDevMode ? overrideSaveTechnicalError : "",
        decisionSaveMessage,
        handleDrawerOverridesSave: handleDrawerCandidateFieldsSave,
        candidateMutationScope: mutationScope(list, apiScopeQuery),
        offset,
        replaceQuery,
        searchParams,
        applyScopeToUrl,
        applyFiltersToUrl,
        clearFilters,
        refetchList,
        mergeRow,
        patchDecision,
        drawerMap,
        sidebarMap,
        sidebarSelectionRow,
        showMapPreview,
        handleRowAction,
        handleDrawerSave,
        refetchDrawerDetail,
        formOptions,
        formOptionsLoading,
        formOptionsError,
    };
}
