"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";

import { useImportTransportEntityPage } from "../hooks/useImportTransportEntityPage";
import { getImportTransportEntitySlugFromPathname } from "../navigation/importTransportRoutes";
import type { ImportTransportEntitySlug } from "../config/types";
import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";

import ImportTransportBatchScopePanel from "./ImportTransportBatchScopePanel";
import ImportTransportCandidatesTable from "./ImportTransportCandidatesTable";
import ImportTransportDetailDrawer from "./ImportTransportDetailDrawer";
import ImportTransportEmptyState from "./ImportTransportEmptyState";
import ImportTransportErrorState from "./ImportTransportErrorState";
import ImportTransportFiltersPanel from "./ImportTransportFiltersPanel";
import { ImportTransportLoadingBannerWithSpinner } from "./ImportTransportLoadingState";
import ImportTransportMapPreview from "./ImportTransportMapPreview";
import ImportTransportPageHeader from "./ImportTransportPageHeader";

function ImportTransportEntityPageInner({
    slug,
    showMapPreview = false,
}: {
    slug: ImportTransportEntitySlug;
    showMapPreview?: boolean;
}) {
    const pathname = usePathname() ?? "";
    const routeActive = getImportTransportEntitySlugFromPathname(pathname) === slug.trim().toLowerCase();
    const page = useImportTransportEntityPage(slug, { showMapPreview, enabled: routeActive });

    if (!routeActive) {
        return null;
    }

    if (!page.config) {
        return (
            <main className="p-6">
                <ImportTransportErrorState
                    message={`Unknown import-transport entity "${slug}". Check entity config registration.`}
                />
            </main>
        );
    }

    const config = page.config;
    const total = page.listTotal;
    const items = page.list?.items ?? [];
    const displayColumns = config.tableColumns.filter((c) => c.key !== "id");
    const hasMore = items.length >= page.limit && page.offset + items.length < total;

    const totalLabel = !page.hasValidScope
        ? "Set scope to load."
        : page.isInitialCandidatesLoad
          ? IMPORT_TRANSPORT_LOADING.loadingCandidates
          : page.isRefreshingCandidates
            ? "Refreshing…"
            : `${total.toLocaleString()} candidates`;

    const batchId =
        page.list?.import_batch_id ??
        (page.searchParams.get("import_batch_id")?.trim() || null);

    const mapSidebar =
        showMapPreview && config.supportsMapPreview ? (
            <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[min(420px,40vw)]">
                <ImportTransportMapPreview
                    enabled={Boolean(page.detailRow && page.drawerOpen)}
                    geometry={page.sidebarMap?.geometry ?? null}
                    geometryKind={page.sidebarMap?.geometryKind ?? "point"}
                    externalId={page.detailRow?.external_id ?? null}
                    title={`${config.label} geometry`}
                    subtitle={page.detailRow?.id ?? null}
                    isLoading={page.detailLoading && Boolean(page.detailRow)}
                    size="default"
                />
                {!page.drawerOpen || !page.detailRow ? (
                    <p className="mt-2 text-center text-xs text-gray-500">
                        Open a row to preview geometry on the map.
                    </p>
                ) : null}
            </aside>
        ) : null;

    return (
        <main className="min-h-screen overflow-x-hidden bg-gray-50 p-4 sm:p-6">
            <div
                className={
                    showMapPreview && config.supportsMapPreview
                        ? "mx-auto flex max-w-[1920px] flex-col gap-6 xl:flex-row xl:items-start"
                        : "mx-auto max-w-[1680px] space-y-6"
                }
            >
                <div
                    className={
                        showMapPreview && config.supportsMapPreview
                            ? "min-w-0 flex-1 space-y-6"
                            : "contents"
                    }
                >
                    <ImportTransportPageHeader
                        pluralLabel={config.pluralLabel}
                        batchId={batchId}
                        selectedBy={page.list?.selected_by}
                        overviewHref={page.overviewHref}
                    />

                    <ImportTransportBatchScopePanel disabled={page.isApplyingScope} />

                    <ImportTransportErrorState message={page.listError} />

                    {page.batchContext.status === "no_batches" ? null : !page.hasValidScope ? (
                        <ImportTransportEmptyState
                            title="Resolving import batch"
                            description="Loading the current import transport batch scope."
                        />
                    ) : null}

                    {page.hasValidScope ? (
                        <>
                            <ImportTransportFiltersPanel
                                slug={config.slug}
                                filterFields={config.filterFields}
                                filters={page.filters}
                                options={page.filterOptions}
                                qDraft={page.qDraft}
                                sort={page.sort}
                                limit={page.limit}
                                showPromoted={page.showPromoted}
                                isLoadingOptions={page.isLoadingOptions}
                                isApplyingFilters={page.isApplyingFilters}
                                totalLabel={totalLabel}
                                onFiltersChange={page.setFilters}
                                onQDraftChange={page.setQDraft}
                                onSortChange={page.setSort}
                                onLimitChange={page.setLimit}
                                onShowPromotedChange={page.setShowPromoted}
                                onApply={page.applyFiltersToUrl}
                                onClear={page.clearFilters}
                            />

                            {page.isInitialCandidatesLoad ? (
                                <ImportTransportLoadingBannerWithSpinner
                                    message={IMPORT_TRANSPORT_LOADING.loadingCandidates}
                                />
                            ) : (
                                <ImportTransportCandidatesTable
                                    displayColumns={displayColumns}
                                    items={items}
                                    emptyMessage={
                                        page.listError
                                            ? "Could not load candidates."
                                            : "No transport candidates match this scope."
                                    }
                                    isLoading={page.isInitialCandidatesLoad}
                                    onRowClick={(row) => void page.openDrawer(row)}
                                />
                            )}

                            {!page.isInitialCandidatesLoad &&
                            (hasMore || page.offset > 0 || total > page.limit) ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                                    <span className="text-sm text-gray-600">
                                        Showing {page.offset + 1}–
                                        {Math.min(page.offset + page.limit, total || page.offset + items.length)}{" "}
                                        of {total.toLocaleString()}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={page.offset <= 0 || page.isInitialCandidatesLoad}
                                            onClick={() =>
                                                page.replaceQuery((p) => {
                                                    p.set(
                                                        "offset",
                                                        String(Math.max(0, page.offset - page.limit))
                                                    );
                                                })
                                            }
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
                                        >
                                            Previous
                                        </button>
                                        <button
                                            type="button"
                                            disabled={
                                                (!hasMore && page.offset + page.limit >= total) ||
                                                page.isInitialCandidatesLoad
                                            }
                                            onClick={() =>
                                                page.replaceQuery((p) => {
                                                    p.set("offset", String(page.offset + page.limit));
                                                })
                                            }
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>

                {mapSidebar}
            </div>

            {page.drawerOpen && page.detailRow && page.config ? (
                <ImportTransportDetailDrawer
                    config={page.config}
                    row={page.detailRow}
                    isLoadingDetail={page.detailLoading}
                    detailError={page.detailError}
                    drawerMap={page.drawerMap}
                    validationIssues={page.validationIssues}
                    validationIssuesLoading={page.validationIssuesLoading}
                    validationIssuesError={page.validationIssuesError}
                    isValidating={page.isValidating}
                    validateError={page.validateError}
                    onValidate={(input) => void page.validateCandidate(input)}
                    onClose={page.closeDrawer}
                />
            ) : null}
        </main>
    );
}

export function ImportTransportEntityPageShell({
    slug,
    showMapPreview = false,
}: {
    slug: ImportTransportEntitySlug;
    showMapPreview?: boolean;
}) {
    return (
        <Suspense fallback={null}>
            <ImportTransportEntityPageInner slug={slug} showMapPreview={showMapPreview} />
        </Suspense>
    );
}

export default ImportTransportEntityPageShell;
