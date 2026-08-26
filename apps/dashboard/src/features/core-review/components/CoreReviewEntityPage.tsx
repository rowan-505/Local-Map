"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import CoreReviewDataTableCard from "@/src/components/core-review/CoreReviewDataTableCard";
import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import {
    CoreReviewErrorCard,
    CoreReviewLoadingCard,
    CoreReviewSuccessBanner,
} from "@/src/components/core-review/CoreReviewStateCard";
import ReviewEmptyState from "@/src/components/review/ReviewEmptyState";
import ReviewPagination from "@/src/components/review/ReviewPagination";
import { reviewTableRowClass } from "@/src/components/review/reviewPalette";

import { getCoreReviewDetail, isAbortError } from "@/src/lib/api";
import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";

import type { CoreReviewEntityConfig } from "../config/entity-config-types";
import { useCoreReviewListState } from "../hooks/useCoreReviewListState";
import { useCoreReviewVerificationTotals } from "../hooks/useCoreReviewVerificationTotals";
import { formatCoreReviewHeaderMeta } from "../utils/listHeaderMeta";
import { coreReviewCreateButtonLabel } from "../utils/createButtonLabel";
import CoreReviewEntityFilters from "./CoreReviewEntityFilters";
import CoreReviewLifecycleDrawerActions from "../lifecycle/CoreReviewLifecycleDrawerActions";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import CoreReviewEntityDrawer from "../drawer/CoreReviewEntityDrawer";
import type { CoreReviewInlineEditGuard } from "../drawer";

export type CoreReviewEntityPageProps<T extends Record<string, unknown> = Record<string, unknown>> = {
    config: CoreReviewEntityConfig<T>;
    initialSelectedRowId?: string | null;
    initialDrawerMode?: "view" | "edit";
};

function CoreReviewEntityPageInner<T extends Record<string, unknown>>({
    config,
    initialSelectedRowId = null,
    initialDrawerMode = "view",
}: CoreReviewEntityPageProps<T>) {
    const dashboardAccess = useDashboardRoleAccess();
    const list = useCoreReviewListState<T>({
        apiSlug: config.apiSlug,
        defaultSortBy: config.defaultSortBy,
        filterSupport: config.filterSupport,
        getRowId: config.getRowId,
    });

    const [selectedId, setSelectedId] = useState<string | null>(initialSelectedRowId);
    const [deepLinkRow, setDeepLinkRow] = useState<T | null>(null);
    const [initialEditPending, setInitialEditPending] = useState(
        initialDrawerMode === "edit" && Boolean(initialSelectedRowId),
    );
    const [lifecycleMessage, setLifecycleMessage] = useState("");
    const [lifecycleError, setLifecycleError] = useState("");
    const inlineEditGuardRef = useRef<CoreReviewInlineEditGuard | null>(null);
    const runGuardedImplRef = useRef<(action: () => void) => void>((action) => {
        action();
    });

    const supportsInlineEdit = dashboardAccess.canWrite && config.supportsInlineEdit === true;

    const handleInlineEditGuardReady = useCallback((guard: CoreReviewInlineEditGuard | null) => {
        inlineEditGuardRef.current = guard;
    }, []);

    useEffect(() => {
        runGuardedImplRef.current = (action) => {
            const guard = inlineEditGuardRef.current;
            if (guard) {
                guard(action);
                return;
            }
            action();
        };
    });

    const runGuarded = useCallback((action: () => void) => {
        runGuardedImplRef.current(action);
    }, []);

    const handleSelectRow = useCallback(
        (id: string) => {
            if (selectedId === id) {
                return;
            }
            if (supportsInlineEdit) {
                runGuarded(() => setSelectedId(id));
                return;
            }
            setSelectedId(id);
        },
        [runGuarded, selectedId, supportsInlineEdit],
    );

    const handleCloseDrawer = useCallback(() => {
        setInitialEditPending(false);
        if (supportsInlineEdit) {
            runGuarded(() => setSelectedId(null));
            return;
        }
        setSelectedId(null);
    }, [runGuarded, supportsInlineEdit]);

    const selectedRow = useMemo(
        () => list.rows.find((r) => config.getRowId(r) === selectedId) ?? null,
        [list.rows, selectedId, config]
    );

    const drawerRow = selectedRow ?? deepLinkRow;

    useEffect(() => {
        if (!selectedId || selectedRow) {
            setDeepLinkRow(null);
            return;
        }
        if (list.isLoading) {
            return;
        }

        const controller = new AbortController();
        void getCoreReviewDetail<T>(config.apiSlug, selectedId, { signal: controller.signal })
            .then((response) => {
                setDeepLinkRow(response.data);
            })
            .catch((error) => {
                if (!isAbortError(error)) {
                    setDeepLinkRow(null);
                }
            });

        return () => controller.abort();
    }, [config.apiSlug, list.isLoading, selectedId, selectedRow]);

    const startInEditMode =
        initialEditPending &&
        supportsInlineEdit &&
        Boolean(initialSelectedRowId) &&
        selectedId === initialSelectedRowId;

    const handleClear = useCallback(() => {
        list.applyDraft({
            ...list.draft,
            searchDraft: "",
            sortBy: config.defaultSortBy,
            arrange: "newest",
            verificationStatusFilter: "all",
            adminAreaId: "",
            settlementType: "",
            categoryId: "",
            buildingTypeId: "",
            roadClassId: "",
            isPublic: "",
            statusFilter: "active",
            routeId: "",
            landAreaClassId: "",
            detailLevel: "",
            cropCode: "",
            boundaryStatus: "",
            addressUsage: "",
            isOfficialBoundary: "",
        });
    }, [config.defaultSortBy, list]);

    const handleLifecycleSuccess = useCallback(
        (message: string) => {
            setLifecycleError("");
            setLifecycleMessage(message);
            setSelectedId(null);
        },
        []
    );

    const handleLifecycleError = useCallback((message: string) => {
        setLifecycleMessage("");
        setLifecycleError(message);
    }, []);

    const handleApply = useCallback(() => {
        list.applyFilters();
    }, [list]);

    const verificationTotals = useCoreReviewVerificationTotals({
        apiSlug: config.apiSlug,
        appliedDraft: list.appliedDraft,
        filterSupport: config.filterSupport,
        enabled:
            config.apiSlug !== "streets" &&
            (Boolean(list.rows.length) || !list.isLoading),
        listVerificationCounts: list.verificationCounts,
    });

    const headerVerificationTotals = useMemo(() => {
        if (config.apiSlug === "streets" && config.filterSupport.isVerified) {
            return {
                total: list.verificationCounts?.total ?? 0,
                verified: list.verificationCounts?.verified ?? 0,
                unverified: list.verificationCounts?.unverified ?? 0,
                isLoading: list.totalLoading,
                countUnavailable: list.countUnavailable,
            };
        }
        return verificationTotals;
    }, [
        config.apiSlug,
        config.filterSupport.isVerified,
        list.countUnavailable,
        list.totalLoading,
        list.verificationCounts,
        verificationTotals,
    ]);

    const metaLabel =
        !list.error && (list.rows.length > 0 || !list.isLoading)
            ? formatCoreReviewHeaderMeta(
                  config.filterSupport.isVerified
                      ? headerVerificationTotals
                      : {
                            total: list.pagination.total ?? 0,
                            verified: 0,
                            unverified: 0,
                            isLoading: list.totalLoading,
                            countUnavailable: list.countUnavailable,
                        },
                  list.appliedDraft,
                  config.filterSupport.isVerified
              )
            : undefined;

    const headerActions = useMemo(() => {
        if (!dashboardAccess.canWrite) {
            return undefined;
        }
        if (config.extensions?.headerActions) {
            return config.extensions.headerActions;
        }
        if (!config.newPath) {
            return undefined;
        }
        return (
            <Link
                href={config.newPath}
                prefetch={false}
                className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
                {coreReviewCreateButtonLabel(config.title)}
            </Link>
        );
    }, [dashboardAccess.canWrite, config.extensions?.headerActions, config.newPath, config.title]);

    const content = (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title={config.title}
                description={config.description}
                meta={metaLabel}
                actions={headerActions}
            />

            {list.isLoading && list.rows.length === 0 ? (
                <CoreReviewLoadingCard message={`Loading ${config.title.toLowerCase()}…`} />
            ) : null}

            {!list.isLoading && list.error ? <CoreReviewErrorCard message={list.error} /> : null}

            {lifecycleMessage ? <CoreReviewSuccessBanner message={lifecycleMessage} /> : null}
            {lifecycleError ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {lifecycleError}
                </div>
            ) : null}

            {!list.error && (list.rows.length > 0 || !list.isLoading) ? (
                <>
                    <CoreReviewEntityFilters
                        draft={list.draft}
                        setDraft={list.setDraft}
                        sortOptions={config.sortOptions}
                        filterSupport={config.filterSupport}
                        searchPlaceholder={config.searchPlaceholder}
                        totalCount={
                            config.apiSlug === "streets" && !list.totalKnown
                                ? list.rows.length
                                : (list.pagination.total ?? 0)
                        }
                        filteredCount={list.rows.length}
                        onApply={handleApply}
                        onClear={handleClear}
                        onApplyVerificationFilter={list.applyVerificationFilter}
                        adminAreaTownshipOnly={
                            config.apiSlug === "streets" || config.apiSlug === "settlements"
                        }
                        extraFilters={config.extensions?.renderExtraFilters?.({
                            draft: list.draft,
                            setDraft: list.setDraft,
                        })}
                    />

                    <CoreReviewDataTableCard
                        caption={
                            selectedRow
                                ? "Row selected — open the detail panel for map preview and metadata."
                                : "Click a row to view details."
                        }
                    >
                        <table className="min-w-full text-left text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700">
                                <tr>
                                    {config.columns.map((col) => (
                                        <th key={col.id} className="px-4 py-3 font-medium whitespace-nowrap">
                                            {col.header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {list.rows.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={config.columns.length}
                                            className="px-4 py-8"
                                        >
                                            <ReviewEmptyState
                                                title={
                                                    list.appliedDraft.searchDraft
                                                        ? "No results match your filters"
                                                        : `No ${config.title.toLowerCase()} found`
                                                }
                                                description={
                                                    list.appliedDraft.searchDraft
                                                        ? "Try clearing filters or broadening your search."
                                                        : undefined
                                                }
                                            />
                                        </td>
                                    </tr>
                                ) : (
                                    list.rows.map((row) => {
                                        const id = config.getRowId(row);
                                        const isSelected = selectedId === id;
                                        const q = list.appliedDraft.searchDraft;
                                        const rowDeleted = isCoreReviewRowDeleted(
                                            row as Record<string, unknown>
                                        );
                                        return (
                                            <tr
                                                key={id}
                                                className={reviewTableRowClass(
                                                    "core",
                                                    isSelected,
                                                    rowDeleted ? "opacity-60" : undefined
                                                )}
                                                onClick={() => handleSelectRow(id)}
                                            >
                                                {config.columns.map((col) => (
                                                    <td
                                                        key={col.id}
                                                        className="px-4 py-3 whitespace-nowrap"
                                                    >
                                                        {col.cell(row, q)}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </CoreReviewDataTableCard>

                    <ReviewPagination
                        page={list.pagination.page}
                        pageSize={list.pagination.pageSize}
                        total={list.pagination.total ?? 0}
                        totalPages={list.pagination.totalPages ?? 1}
                        onPageChange={list.setPage}
                        disabled={list.isLoading}
                        hasNextPage={list.hasNextPage}
                        totalKnown={list.totalKnown}
                        totalLoading={list.totalLoading}
                        countUnavailable={list.countUnavailable}
                    />
                </>
            ) : null}

            <CoreReviewEntityDrawer
                config={config}
                open={Boolean(selectedId && drawerRow)}
                row={drawerRow}
                rowId={selectedId}
                startInEditMode={dashboardAccess.canWrite && startInEditMode}
                onClose={handleCloseDrawer}
                onRowPatched={(rowId, updater) => list.patchRow(rowId, updater)}
                onInlineEditGuardReady={
                    supportsInlineEdit ? handleInlineEditGuardReady : undefined
                }
                drawerActions={
                    dashboardAccess.canWrite && drawerRow ? (
                        <>
                            <CoreReviewLifecycleDrawerActions
                                apiSlug={config.apiSlug}
                                row={drawerRow as Record<string, unknown>}
                                recordId={config.getRowId(drawerRow)}
                                beforeAction={supportsInlineEdit ? runGuarded : undefined}
                                onSuccess={handleLifecycleSuccess}
                                onError={handleLifecycleError}
                                onAfterLifecycle={handleCloseDrawer}
                            />
                            {/* eslint-disable-next-line react-hooks/refs -- close/runGuarded run only on user action */}
                            {config.extensions?.renderDrawerActions?.({
                                row: drawerRow,
                                detail: drawerRow,
                                close: handleCloseDrawer,
                                reloadList: list.reload,
                            })}
                        </>
                    ) : undefined
                }
            />
        </CoreReviewPageShell>
    );

    return config.extensions?.wrapPage ? config.extensions.wrapPage(content) : content;
}

export default function CoreReviewEntityPage<T extends Record<string, unknown>>({
    config,
    initialSelectedRowId,
    initialDrawerMode,
}: CoreReviewEntityPageProps<T>) {
    return (
        <Suspense
            fallback={
                <CoreReviewPageShell>
                    <CoreReviewLoadingCard message="Loading…" />
                </CoreReviewPageShell>
            }
        >
            <CoreReviewEntityPageInner
                config={config}
                initialSelectedRowId={initialSelectedRowId}
                initialDrawerMode={initialDrawerMode}
            />
        </Suspense>
    );
}
