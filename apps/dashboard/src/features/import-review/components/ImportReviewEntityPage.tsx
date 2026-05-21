"use client";

import { Suspense } from "react";

import ImportReviewBatchPicker from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBatchPicker";
import { useImportReviewEntityPage } from "@/src/features/import-review/hooks/useImportReviewEntityPage";
import { toDataReviewGeometryKind } from "@/src/features/import-review/config";
import { preserveImportReviewScopeInParams } from "@/src/lib/importReviewSnapshot";

import ImportReviewBatchScopeBar from "./ImportReviewBatchScopeBar";
import ImportReviewCandidatesTable from "./ImportReviewCandidatesTable";
import ImportReviewMapPreview from "./ImportReviewMapPreview";
import ImportReviewDetailDrawer from "./ImportReviewDetailDrawer";
import ImportReviewEmptyState from "./ImportReviewEmptyState";
import ImportReviewErrorState from "./ImportReviewErrorState";
import ImportReviewFiltersPanel from "./ImportReviewFiltersPanel";
import { ImportReviewLoadingBannerWithSpinner } from "./ImportReviewLoadingState";
import ImportReviewPageHeader from "./ImportReviewPageHeader";
import ImportReviewSelectedActionBar from "./ImportReviewSelectedActionBar";
import ImportReviewSkeletonTable from "./ImportReviewSkeletonTable";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";

function ImportReviewEntityPageInner({
    slug,
    showMapPreview = false,
}: {
    slug: string;
    showMapPreview?: boolean;
}) {
    const page = useImportReviewEntityPage(slug, { showMapPreview });

    if (!page.config) {
        return (
            <main className="p-6">
                <ImportReviewErrorState
                    message={`Unknown import-review entity "${slug}". Check entity config registration.`}
                />
            </main>
        );
    }

    const config = page.config;
    const total = page.list?.total ?? 0;
    const items = page.list?.items ?? [];
    const displayColumns = config.tableColumns.filter((c) => c.key !== "id");

    const listError = page.batchContext.error || page.listError;
    const showBatchPicker = (page.ambiguousBatches?.length ?? 0) > 0;

    const totalLabel = !page.hasValidScope
        ? "Set scope to load."
        : page.isInitialCandidatesLoad
          ? IMPORT_REVIEW_LOADING.loadingCandidates
          : page.isRefreshingCandidates
            ? IMPORT_REVIEW_LOADING.refreshingCandidates
            : `${total.toLocaleString()} candidates`;

    const batchActivityMessage = page.batchContext.isResolvingReviewBatch
        ? IMPORT_REVIEW_LOADING.resolvingReviewBatch
        : page.batchContext.isLoadingBatchContext
          ? IMPORT_REVIEW_LOADING.loadingBatchContext
          : null;

    const mapSidebar =
        showMapPreview && config.supportsMapPreview ? (
            <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[min(420px,40vw)]">
                <ImportReviewMapPreview
                    enabled={Boolean(page.sidebarMapRow)}
                    geometry={page.sidebarMap?.geometry ?? null}
                    geometryKind={
                        page.sidebarMap?.geometryKind ?? toDataReviewGeometryKind(config.geometryType)
                    }
                    entityType={config.mapEntityType}
                    externalId={page.sidebarMapRow?.external_id ?? null}
                    title={`${config.label} geometry`}
                    fallbackNote={page.sidebarMap?.fallbackNote}
                    isLoadingDetail={page.isLoadingDetail && Boolean(page.drawerRow)}
                    size="default"
                />
                {!page.sidebarMapRow ? (
                    <p className="mt-2 text-center text-xs text-gray-500">
                        Open a row or select exactly one candidate to preview on the map.
                    </p>
                ) : null}
            </aside>
        ) : null;

    return (
        <main className="min-h-screen overflow-x-hidden bg-gray-50 p-4 sm:p-6">
            <div
                className={
                    showMapPreview
                        ? "mx-auto flex max-w-[1920px] flex-col gap-6 xl:flex-row xl:items-start"
                        : "mx-auto max-w-[1680px] space-y-6"
                }
            >
                <div className={showMapPreview ? "min-w-0 flex-1 space-y-6" : "contents"}>
                <ImportReviewPageHeader
                    pluralLabel={config.pluralLabel}
                    batchId={page.list?.review_batch_id ?? page.batchContext.reviewBatchId}
                    selectedBy={page.list?.selected_by}
                    overviewHref={page.overviewHref}
                />

                <ImportReviewBatchScopeBar
                    snapshotInput={page.snapshotInput}
                    batchInput={page.batchInput}
                    onSnapshotChange={page.setSnapshotInput}
                    onBatchChange={page.setBatchInput}
                    onApplyScope={page.applyScopeToUrl}
                    disabled={page.batchContext.isLoadingBatchContext}
                />

                {batchActivityMessage ? (
                    <ImportReviewLoadingBannerWithSpinner message={batchActivityMessage} />
                ) : null}

                {showBatchPicker ? (
                    <>
                        <ImportReviewStatusBanner
                            message={IMPORT_REVIEW_LOADING.multipleBatchesFound}
                            tone="warning"
                        />
                        <ImportReviewBatchPicker
                            sourceSnapshotVersion={page.ambiguousSnapshot}
                            batches={page.ambiguousBatches ?? []}
                            onUseLatest={page.batchContext.selectLatestForSnapshot}
                        />
                    </>
                ) : null}

                <ImportReviewErrorState message={listError} />

                {!showBatchPicker && !page.hasValidScope && !page.batchContext.isLoadingBatchContext ? (
                    <ImportReviewEmptyState
                        title="Set review scope"
                        description="Enter review_batch_id (preferred) or source_snapshot_version, then apply scope."
                    />
                ) : null}

                {page.hasValidScope ? (
                    <>
                        <ImportReviewFiltersPanel
                            filterFields={config.filterFields}
                            filters={page.filters}
                            filterOptions={page.filterOptions}
                            qDraft={page.qDraft}
                            sort={page.sort}
                            limit={page.limit}
                            showPromoted={page.showPromoted}
                            isLoadingFilters={page.isLoadingFilters}
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

                        {page.isApplyingFilters ? (
                            <ImportReviewStatusBanner
                                message={IMPORT_REVIEW_LOADING.applyingFilters}
                                tone="info"
                                compact
                            />
                        ) : null}

                        {config.supportsBulkActions ? (
                            <ImportReviewSelectedActionBar
                                selectedCount={page.selectedIds.size}
                                analysis={page.bulk.analysis}
                                bulkNote={page.bulk.bulkNote}
                                bulkBusy={page.bulk.isBulkActionRunning}
                                bulkPhase={page.bulk.bulkPhase}
                                bulkMessage={page.bulk.bulkMessage}
                                bulkPreview={page.bulk.bulkPreview}
                                canEdit={page.canEditImportReview}
                                hasValidScope={page.hasValidScope}
                                approveBlockedReason={page.bulk.approveBlockedReason}
                                dangerForce={page.bulk.dangerForce}
                                overrideManualProtected={page.bulk.overrideManualProtected}
                                overrideDuplicate={page.bulk.overrideDuplicate}
                                onBulkNoteChange={page.bulk.setBulkNote}
                                onDangerForceChange={page.bulk.setDangerForce}
                                onOverrideManualProtectedChange={page.bulk.setOverrideManualProtected}
                                onOverrideDuplicateChange={page.bulk.setOverrideDuplicate}
                                onClearSelection={page.bulk.clearSelection}
                                onPreviewApprove={() => void page.bulk.bulkPreviewApprove()}
                                onApproveSelected={() => void page.bulk.bulkApproveSelected()}
                                onRejectSelected={() => void page.bulk.bulkRejectSelected()}
                                onNeedsMoreReviewSelected={() =>
                                    void page.bulk.bulkNeedsMoreReviewSelected()
                                }
                                onIgnoreSelected={() => void page.bulk.bulkIgnoreSelected()}
                                showFilterBulkActions={config.slug === "buildings"}
                                onDryRunSafeBulkApprove={() => void page.bulk.bulkSafeFilterDryRun()}
                                onRealSafeBulkApprove={() => void page.bulk.bulkSafeFilterApply()}
                            />
                        ) : null}

                        {page.isRefreshingCandidates ? (
                            <div className="flex justify-end">
                                <ImportReviewInlineSpinner
                                    label={IMPORT_REVIEW_LOADING.refreshingCandidates}
                                />
                            </div>
                        ) : null}

                        {page.isInitialCandidatesLoad ? (
                            <>
                                <ImportReviewLoadingBannerWithSpinner
                                    message={IMPORT_REVIEW_LOADING.loadingCandidates}
                                />
                                <ImportReviewSkeletonTable
                                    columnCount={displayColumns.length + (config.supportsBulkActions ? 2 : 1)}
                                    message={IMPORT_REVIEW_LOADING.loadingCandidates}
                                />
                            </>
                        ) : (
                            <ImportReviewCandidatesTable
                                displayColumns={displayColumns}
                                items={items}
                                supportsSelection={config.supportsBulkActions}
                                selectedIds={page.selectedIds}
                                canEdit={page.canEditImportReview}
                                rowActionBusyId={page.rowActionBusyId}
                                emptyMessage={IMPORT_REVIEW_LOADING.noCandidatesFound}
                                isLoading={false}
                                onToggleSelectAll={(checked) => {
                                    if (checked) {
                                        page.setSelectedIds(new Set(items.map((r) => r.id)));
                                    } else {
                                        page.setSelectedIds(new Set());
                                    }
                                }}
                                onToggleRow={(id, checked) => {
                                    page.setSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (checked) {
                                            next.add(id);
                                        } else {
                                            next.delete(id);
                                        }
                                        return next;
                                    });
                                }}
                                onRowClick={(row) => page.openDrawer(row)}
                                onRowDecision={(row, d) => void page.handleRowAction(row, d)}
                                onViewDetails={(row) => page.openDrawer(row)}
                            />
                        )}

                        {total > page.limit ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                                <span className="text-sm text-gray-600">
                                    Showing {page.offset + 1}–{Math.min(page.offset + page.limit, total)} of{" "}
                                    {total.toLocaleString()}
                                    {page.selectedIds.size > 0 ? (
                                        <span className="mt-1 block text-xs text-gray-500">
                                            Selection is cleared when you change pages.
                                        </span>
                                    ) : null}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={page.offset <= 0 || page.isLoadingCandidates}
                                        onClick={() =>
                                            page.replaceQuery((p) => {
                                                preserveImportReviewScopeInParams(p, page.searchParams);
                                                p.set("offset", String(Math.max(0, page.offset - page.limit)));
                                            })
                                        }
                                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        disabled={
                                            page.offset + page.limit >= total || page.isLoadingCandidates
                                        }
                                        onClick={() =>
                                            page.replaceQuery((p) => {
                                                preserveImportReviewScopeInParams(p, page.searchParams);
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

            {page.drawerRow ? (
                <ImportReviewDetailDrawer
                    config={config}
                    row={page.drawerRow}
                    mapEntityType={config.mapEntityType}
                    geometryKind={page.drawerMap?.geometryKind ?? toDataReviewGeometryKind(config.geometryType)}
                    geometry={page.drawerMap?.geometry ?? null}
                    fallbackNote={page.drawerMap?.fallbackNote}
                    isLoadingDetail={page.isLoadingDetail}
                    isLoadingGeometry={page.isLoadingGeometry}
                    detailError={page.detailError}
                    detailNotFound={page.detailNotFound}
                    isSaving={page.isSaving}
                    isSavingOverrides={page.isSavingOverrides}
                    overrideSaveMessage={page.overrideSaveMessage}
                    decisionSaveMessage={page.decisionSaveMessage}
                    apiScope={page.apiScopeQuery}
                    onSaveOverrides={page.handleDrawerOverridesSave}
                    drawerNote={page.drawerNote}
                    drawerDecision={page.drawerDecision}
                    canEdit={page.canEditImportReview}
                    onClose={page.closeDrawer}
                    onNoteChange={page.setDrawerNote}
                    onDecisionChange={page.setDrawerDecision}
                    onSave={() => void page.handleDrawerSave()}
                />
            ) : null}
        </main>
    );
}

export default function ImportReviewEntityPage({
    slug,
    showMapPreview = false,
}: {
    slug: string;
    showMapPreview?: boolean;
}) {
    return <ImportReviewEntityPageInner slug={slug} showMapPreview={showMapPreview} />;
}

export function ImportReviewEntityPageShell({
    slug,
    showMapPreview = false,
}: {
    slug: string;
    showMapPreview?: boolean;
}) {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-gray-50 p-6">
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingBatchContext} />
                </main>
            }
        >
            <ImportReviewEntityPage slug={slug} showMapPreview={showMapPreview} />
        </Suspense>
    );
}
