"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";

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

import type { CoreReviewEntityConfig } from "../config/entity-config-types";
import { useCoreReviewListState } from "../hooks/useCoreReviewListState";
import { useCoreReviewVerificationTotals } from "../hooks/useCoreReviewVerificationTotals";
import { formatCoreReviewHeaderMeta } from "../utils/listHeaderMeta";
import { coreReviewCreateButtonLabel } from "../utils/createButtonLabel";
import CoreReviewEntityDetailDrawer from "./CoreReviewEntityDetailDrawer";
import CoreReviewEntityFilters from "./CoreReviewEntityFilters";
import CoreReviewLifecycleDrawerActions from "../lifecycle/CoreReviewLifecycleDrawerActions";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";

function CoreReviewEntityPageInner<T extends Record<string, unknown>>({
    config,
}: {
    config: CoreReviewEntityConfig<T>;
}) {
    const list = useCoreReviewListState<T>({
        apiSlug: config.apiSlug,
        defaultSortBy: config.defaultSortBy,
        filterSupport: config.filterSupport,
    });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [lifecycleMessage, setLifecycleMessage] = useState("");
    const [lifecycleError, setLifecycleError] = useState("");

    const selectedRow = useMemo(
        () => list.rows.find((r) => config.getRowId(r) === selectedId) ?? null,
        [list.rows, selectedId, config]
    );

    const handleClear = useCallback(() => {
        list.applyDraft({
            ...list.draft,
            searchDraft: "",
            sortBy: config.defaultSortBy,
            arrange: "newest",
            verifiedFilter: "all",
            adminAreaId: "",
            categoryId: "",
            buildingTypeId: "",
            roadClassId: "",
            isPublic: "",
            statusFilter: "active",
            routeId: "",
            landuseClassId: "",
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
            list.reload();
            setSelectedId(null);
        },
        [list]
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
        enabled: !list.isLoading && !list.error,
    });

    const metaLabel =
        !list.error && !list.isLoading
            ? formatCoreReviewHeaderMeta(
                  config.filterSupport.isVerified
                      ? verificationTotals
                      : {
                            total: list.pagination.total,
                            verified: 0,
                            unverified: 0,
                            isLoading: false,
                        },
                  list.appliedDraft,
                  config.filterSupport.isVerified
              )
            : undefined;

    const detailFields = selectedRow ? config.detailFields(selectedRow) : [];
    const listGeometry = selectedRow ? config.getGeometry(selectedRow) : null;

    const headerActions = useMemo(() => {
        if (config.extensions?.headerActions) {
            return config.extensions.headerActions;
        }
        if (!config.newPath) {
            return undefined;
        }
        return (
            <Link
                href={config.newPath}
                className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
                {coreReviewCreateButtonLabel(config.title)}
            </Link>
        );
    }, [config.extensions?.headerActions, config.newPath, config.title]);

    const content = (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title={config.title}
                description={config.description}
                meta={metaLabel}
                actions={headerActions}
            />

            {list.isLoading ? (
                <CoreReviewLoadingCard message={`Loading ${config.title.toLowerCase()}…`} />
            ) : null}

            {!list.isLoading && list.error ? <CoreReviewErrorCard message={list.error} /> : null}

            {lifecycleMessage ? <CoreReviewSuccessBanner message={lifecycleMessage} /> : null}
            {lifecycleError ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {lifecycleError}
                </div>
            ) : null}

            {!list.isLoading && !list.error ? (
                <>
                    <CoreReviewEntityFilters
                        draft={list.draft}
                        setDraft={list.setDraft}
                        sortOptions={config.sortOptions}
                        defaultSortBy={config.defaultSortBy}
                        filterSupport={config.filterSupport}
                        searchPlaceholder={config.searchPlaceholder}
                        totalCount={list.pagination.total}
                        filteredCount={list.rows.length}
                        onApply={handleApply}
                        onClear={handleClear}
                        showRoutePicker={config.apiSlug === "bus-route-variants"}
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
                                                onClick={() => setSelectedId(id)}
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
                        total={list.pagination.total}
                        totalPages={list.pagination.totalPages}
                        onPageChange={list.setPage}
                        disabled={list.isLoading}
                    />
                </>
            ) : null}

            {config.extensions?.renderDetailDrawer ? (
                config.extensions.renderDetailDrawer({
                    open: Boolean(selectedRow),
                    row: selectedRow,
                    rowId: selectedRow ? config.getRowId(selectedRow) : null,
                    title: selectedRow ? config.getRowTitle(selectedRow) : "",
                    subtitle: selectedRow ? config.getRowSubtitle?.(selectedRow) ?? null : null,
                    geometryKind: config.geometryKind,
                    mapEntityType: config.mapEntityType,
                    listGeometry: listGeometry,
                    editPath:
                        selectedRow && config.editPath
                            ? config.editPath(config.getRowId(selectedRow))
                            : undefined,
                    drawerActions: selectedRow ? (
                        <>
                            <CoreReviewLifecycleDrawerActions
                                apiSlug={config.apiSlug}
                                row={selectedRow as Record<string, unknown>}
                                recordId={config.getRowId(selectedRow)}
                                onSuccess={handleLifecycleSuccess}
                                onError={handleLifecycleError}
                                onAfterLifecycle={() => setSelectedId(null)}
                            />
                            {config.extensions?.renderDrawerActions?.({
                                row: selectedRow,
                                detail: selectedRow,
                                close: () => setSelectedId(null),
                                reloadList: list.reload,
                            })}
                        </>
                    ) : undefined,
                    onClose: () => setSelectedId(null),
                })
            ) : (
                <CoreReviewEntityDetailDrawer
                    open={Boolean(selectedRow)}
                    apiSlug={config.apiSlug}
                    idKind={config.idKind}
                    rowId={selectedRow ? config.getRowId(selectedRow) : null}
                    title={selectedRow ? config.getRowTitle(selectedRow) : ""}
                    subtitle={selectedRow ? config.getRowSubtitle?.(selectedRow) ?? null : null}
                    geometryKind={config.geometryKind}
                    mapEntityType={config.mapEntityType}
                    listGeometry={listGeometry}
                    detailFields={detailFields}
                    editPath={
                        selectedRow && config.editPath
                            ? config.editPath(config.getRowId(selectedRow))
                            : undefined
                    }
                    drawerActions={
                        selectedRow ? (
                            <>
                                <CoreReviewLifecycleDrawerActions
                                    apiSlug={config.apiSlug}
                                    row={selectedRow as Record<string, unknown>}
                                    recordId={config.getRowId(selectedRow)}
                                    onSuccess={handleLifecycleSuccess}
                                    onError={handleLifecycleError}
                                    onAfterLifecycle={() => setSelectedId(null)}
                                />
                                {config.extensions?.renderDrawerActions?.({
                                    row: selectedRow,
                                    detail: selectedRow,
                                    close: () => setSelectedId(null),
                                    reloadList: list.reload,
                                })}
                            </>
                        ) : undefined
                    }
                    onClose={() => setSelectedId(null)}
                />
            )}
        </CoreReviewPageShell>
    );

    return config.extensions?.wrapPage ? config.extensions.wrapPage(content) : content;
}

export default function CoreReviewEntityPage<T extends Record<string, unknown>>({
    config,
}: {
    config: CoreReviewEntityConfig<T>;
}) {
    return (
        <Suspense
            fallback={
                <CoreReviewPageShell>
                    <CoreReviewLoadingCard message="Loading…" />
                </CoreReviewPageShell>
            }
        >
            <CoreReviewEntityPageInner config={config} />
        </Suspense>
    );
}
