"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useClearSelectionOnListQueryChange } from "./useClearSelectionOnListQueryChange";

import {
    formatImportReviewApiError,
    getEntityCandidateDetail,
    getEntityCandidates,
    getEntityFilterOptions,
    importReviewAmbiguousFromError,
    patchEntityDecision,
    patchEntityOverrides,
} from "@/src/features/import-review/api";
import { isImportReviewDetailNotFound } from "@/src/features/import-review/utils/detailDrawerUtils";
import { getImportReviewEntityConfigBySlug, toDataReviewGeometryKind } from "@/src/features/import-review/config";
import type { ImportReviewEntityConfig } from "@/src/features/import-review/config";
import { entityDrawerMapInput } from "@/src/lib/importReviewDrawerMapGeometry";
import {
    isAbortError,
    type ImportReviewBatchChoice,
    type ImportReviewBuildingListItem,
    type ImportReviewBuildingsListResponse,
    type ImportReviewDecision,
    type ImportReviewFamilyFilterOptionsResponse,
} from "@/src/lib/api";
import { deriveImportReviewEditorUxCanMutate } from "@/src/lib/importReviewEditorUx";
import { importReviewOverviewHref } from "@/src/lib/importReviewEntityConfig";
import {
    applyImportReviewScopeSearchParams,
    importReviewScopeQueryForApi,
    importReviewScopeQueryFromSearch,
    preserveImportReviewScopeInParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
    type ImportReviewScopeQueryParams,
} from "@/src/lib/importReviewSnapshot";

import { useImportReviewBatchContext } from "./useImportReviewBatchContext";
import { useImportReviewBulkActions } from "./useImportReviewBulkActions";
import {
    buildImportReviewListQueryKey,
    IMPORT_REVIEW_LIMIT_CHOICES,
    readImportReviewListFilters,
    type ImportReviewListFilters,
} from "../utils/entityPageUtils";

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
};

export function useImportReviewEntityPage(
    slug: string,
    options: UseImportReviewEntityPageOptions = {}
) {
    const showMapPreview = options.showMapPreview ?? false;
    const config = getImportReviewEntityConfigBySlug(slug);
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const batchContext = useImportReviewBatchContext({
        resolveSnapshotScope: true,
        useEnvDefault: false,
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

    const [filterOptions, setFilterOptions] = useState<ImportReviewFamilyFilterOptionsResponse | null>(
        null
    );
    const [isLoadingFilters, setIsLoadingFilters] = useState(false);
    const [isApplyingFilters, setIsApplyingFilters] = useState(false);
    const [list, setList] = useState<ImportReviewBuildingsListResponse | null>(null);
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(() => {
        const scope = importReviewScopeQueryFromSearch(searchParams, ENV_SNAPSHOT_DEFAULT, {
            useEnvDefault: false,
        });
        return importReviewScopeQueryForApi(scope) !== null;
    });
    const [listError, setListError] = useState("");
    const [listAmbiguousBatches, setListAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(
        null
    );
    const [listAmbiguousSnapshot, setListAmbiguousSnapshot] = useState("");

    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [rowActionBusyId, setRowActionBusyId] = useState<string | null>(null);
    const [canEditImportReview, setCanEditImportReview] = useState(false);

    const [drawerRow, setDrawerRow] = useState<ImportReviewBuildingListItem | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [detailNotFound, setDetailNotFound] = useState(false);
    const [drawerNote, setDrawerNote] = useState("");
    const [drawerDecision, setDrawerDecision] = useState<ImportReviewDecision>("needs_more_review");
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingOverrides, setIsSavingOverrides] = useState(false);
    const [overrideSaveMessage, setOverrideSaveMessage] = useState<string | null>(null);
    const [decisionSaveMessage, setDecisionSaveMessage] = useState<string | null>(null);

    const apiScopeQuery = batchContext.apiScopeQuery;
    const syncResolvedBatchToUrl = batchContext.syncResolvedBatchToUrl;

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
        [apiScopeQuery, limit, offset, sort, filters, qApplied, showPromoted, config?.apiFamily]
    );

    useClearSelectionOnListQueryChange(listQueryKey, setSelectedIds);

    const hasValidScope =
        apiScopeQuery !== null &&
        config !== null &&
        !batchContext.isLoadingBatchContext &&
        batchContext.status !== "multiple_batches";

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void) => {
            const p = new URLSearchParams(searchParams.toString());
            mutate(p);
            const qs = p.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname, searchParams]
    );

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
        if (!hasValidScope || !apiScopeQuery || !config) {
            setFilterOptions(null);
            return;
        }
        const c = new AbortController();
        setIsLoadingFilters(true);
        getEntityFilterOptions(config.apiFamily, { ...apiScopeQuery }, { signal: c.signal })
            .then(setFilterOptions)
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                const ambiguous = importReviewAmbiguousFromError(err);
                if (ambiguous) {
                    setListAmbiguousBatches(ambiguous.batches);
                    setListAmbiguousSnapshot(ambiguous.sourceSnapshotVersion);
                    setFilterOptions(null);
                    return;
                }
                setFilterOptions(null);
            })
            .finally(() => {
                if (!c.signal.aborted) {
                    setIsLoadingFilters(false);
                }
            });
        return () => c.abort();
    }, [hasValidScope, apiScopeQuery, config]);

    const fetchList = useCallback(
        async (signal?: AbortSignal) => {
            if (!hasValidScope || !apiScopeQuery || !config) {
                setList(null);
                setListError("");
                setIsLoadingCandidates(false);
                setIsApplyingFilters(false);
                return;
            }

            setIsLoadingCandidates(true);
            setListError("");
            setListAmbiguousBatches(null);
            setListAmbiguousSnapshot("");

            try {
                const params = {
                    ...apiScopeQuery,
                    limit,
                    offset,
                    sort,
                    include_geometry: Boolean(config.supportsMapPreview && showMapPreview),
                    include_promoted: showPromoted,
                };
                const rest = { ...params } as typeof params & Record<string, string | undefined>;
                if (filters.match_status) rest.match_status = filters.match_status;
                if (filters.auto_action) rest.auto_action = filters.auto_action;
                if (filters.review_status) rest.review_status = filters.review_status;
                if (filters.review_decision) rest.review_decision = filters.review_decision;
                if (filters.promotion_status) rest.promotion_status = filters.promotion_status;
                if (filters.class_code) rest.class_code = filters.class_code;
                if (qApplied) rest.q = qApplied;

                const res = await getEntityCandidates(config.apiFamily, rest, signal ? { signal } : undefined);
                setList(res);
                syncResolvedBatchToUrl(res.review_batch_id);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                const ambiguous = importReviewAmbiguousFromError(err);
                if (ambiguous) {
                    setListAmbiguousBatches(ambiguous.batches);
                    setListAmbiguousSnapshot(ambiguous.sourceSnapshotVersion);
                    setList(null);
                    setListError("");
                    return;
                }
                setList(null);
                setListError(formatImportReviewApiError(err, "Failed to load candidates."));
            } finally {
                if (!signal?.aborted) {
                    setIsLoadingCandidates(false);
                    setIsApplyingFilters(false);
                }
            }
        },
        [
            hasValidScope,
            apiScopeQuery,
            config,
            limit,
            offset,
            sort,
            filters,
            qApplied,
            showPromoted,
            showMapPreview,
            syncResolvedBatchToUrl,
        ]
    );

    useEffect(() => {
        if (!hasValidScope) {
            setList(null);
            setIsLoadingCandidates(false);
            return;
        }
        setIsLoadingCandidates(true);
        const c = new AbortController();
        void fetchList(c.signal);
        return () => c.abort();
    }, [fetchList, hasValidScope]);

    const openDrawer = useCallback((row: ImportReviewBuildingListItem) => {
        setDetailError("");
        setDetailNotFound(false);
        setDrawerRow(row);
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawerRow(null);
        setDetailError("");
        setDetailNotFound(false);
        setIsLoadingDetail(false);
        setOverrideSaveMessage(null);
        setDecisionSaveMessage(null);
    }, []);

    useEffect(() => {
        if (!drawerRow || !config || !apiScopeQuery) {
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

        const c = new AbortController();
        setIsLoadingDetail(true);
        setDetailError("");
        setDetailNotFound(false);
        getEntityCandidateDetail(
            config.apiFamily,
            drawerRow.id,
            { ...apiScopeQuery, include_geometry: true },
            { signal: c.signal }
        )
            .then((detail) => {
                setDrawerRow(detail);
                setDetailError("");
                setDetailNotFound(false);
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                if (isImportReviewDetailNotFound(err)) {
                    setDetailNotFound(true);
                    setDetailError("");
                    return;
                }
                setDetailError(formatImportReviewApiError(err, "Failed to load candidate detail."));
            })
            .finally(() => {
                if (!c.signal.aborted) {
                    setIsLoadingDetail(false);
                }
            });
        return () => c.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when opening another row
    }, [drawerRow?.id, config?.apiFamily, apiScopeQuery]);

    const mergeRow = (updated: ImportReviewBuildingListItem) => {
        setDrawerRow(updated);
        setList((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                items: prev.items.map((r) => (r.id === updated.id ? updated : r)),
            };
        });
    };

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
        replaceQuery((p) => {
            applyImportReviewScopeSearchParams(p, snapshotInput.trim(), batchInput.trim());
            p.set("offset", "0");
        });
    };

    const applyFiltersToUrl = () => {
        setIsApplyingFilters(true);
        replaceQuery((p) => {
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
        });
        setQApplied(qDraft.trim());
    };

    const clearFilters = () => {
        setFilters({
            match_status: "",
            auto_action: "",
            review_status: "",
            review_decision: "",
            promotion_status: "",
            class_code: "",
        });
        setQDraft("");
        replaceQuery((p) => {
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
        });
        setQApplied("");
    };

    const ambiguousBatches =
        listAmbiguousBatches ?? batchContext.ambiguousBatches;
    const ambiguousSnapshot =
        listAmbiguousSnapshot || batchContext.ambiguousSnapshot || snapshotInput.trim();

    const drawerMap = useMemo(() => {
        if (!drawerRow || !config) {
            return null;
        }
        return entityDrawerMapInput(drawerRow, toDataReviewGeometryKind(config.geometryType));
    }, [drawerRow, config]);

    const sidebarMapRow = useMemo(() => {
        if (drawerRow) {
            return drawerRow;
        }
        if (selectedIds.size !== 1 || !list) {
            return null;
        }
        const id = [...selectedIds][0];
        return list.items.find((r) => r.id === id) ?? null;
    }, [drawerRow, selectedIds, list]);

    const sidebarMap = useMemo(() => {
        if (!showMapPreview || !config?.supportsMapPreview || !sidebarMapRow) {
            return null;
        }
        return entityDrawerMapInput(sidebarMapRow, toDataReviewGeometryKind(config.geometryType));
    }, [showMapPreview, config, sidebarMapRow]);

    const isLoadingGeometry = Boolean(
        config?.supportsMapPreview && isLoadingDetail && !detailNotFound && !detailError
    );

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

    const handleDrawerOverridesSave = async (
        overridesPatch: Record<string, unknown>,
        reviewNote: string | null
    ) => {
        if (!drawerRow || !canEditImportReview || !config || !apiScopeQuery) {
            return;
        }
        if ((drawerRow.promotion_status ?? "").toLowerCase() === "promoted") {
            setOverrideSaveMessage("Cannot edit review_overrides after promotion.");
            return;
        }
        const scopeBody = mutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            return;
        }
        setIsSavingOverrides(true);
        setOverrideSaveMessage(null);
        try {
            const updated = await patchEntityOverrides(config.apiFamily, drawerRow.id, {
                ...scopeBody,
                review_overrides: overridesPatch,
                review_note: reviewNote,
            });
            mergeRow(updated);
            setOverrideSaveMessage("Overrides saved.");
        } catch (err) {
            setOverrideSaveMessage(formatImportReviewApiError(err, "Failed to save overrides."));
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

    const isRefreshingCandidates =
        hasValidScope && isLoadingCandidates && list !== null && (list.items.length ?? 0) > 0;
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
            void fetchList();
        },
    });

    return {
        config: config as ImportReviewEntityConfig | null,
        overviewHref: importReviewOverviewHref(searchParams),
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
        detailNotFound,
        drawerNote,
        setDrawerNote,
        drawerDecision,
        setDrawerDecision,
        isSaving,
        isSavingOverrides,
        overrideSaveMessage,
        decisionSaveMessage,
        handleDrawerOverridesSave,
        offset,
        replaceQuery,
        searchParams,
        applyScopeToUrl,
        applyFiltersToUrl,
        clearFilters,
        fetchList,
        mergeRow,
        patchDecision,
        drawerMap,
        sidebarMap,
        sidebarMapRow,
        showMapPreview,
        handleRowAction,
        handleDrawerSave,
    };
}
