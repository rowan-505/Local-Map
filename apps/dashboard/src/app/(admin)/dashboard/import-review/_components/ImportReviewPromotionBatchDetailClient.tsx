"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import ImportReviewPromotionPromotePanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionPromotePanel";
import ImportReviewPromotionValidationPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionValidationPanel";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
    PublishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    formatImportReviewPromotionError,
    ImportReviewPromotionDryRunNotice,
    ImportReviewPromotionStepBar,
} from "@/src/features/import-review/promotion";
import {
    IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE,
    parseValidImportReviewPromotionBatchRouteId,
} from "@/src/features/import-review/promotion/promotionBatchRouteId";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import { IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import {
    batchHasDeprecatedTransportPromotionItems,
    importReviewPromotionTargetLabel,
    orderedBatchFamiliesForDisplay,
    orderedDeprecatedBatchFamiliesForDisplay,
    resolveBatchActiveFamilies,
    resolveBatchDeprecatedFamilies,
} from "@/src/features/import-review/utils/importReviewPromotionBatchFamilies";
import { importReviewHistoryHref } from "@/src/lib/importReviewEntityConfig";
import {
    getImportReviewPromotionBatchById,
    isAbortError,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchEntityItemCounts,
} from "@/src/lib/api";
import { importReviewPath, importTransportPath } from "@/src/lib/dashboardNavigation";

function BatchItemsByFamilyTable({
    families,
    countsByFamily,
    deprecatedFamilies = [],
}: {
    families: string[];
    countsByFamily: Record<string, ImportReviewPublishBatchEntityItemCounts>;
    deprecatedFamilies?: readonly string[];
}) {
    const deprecatedSet = new Set(deprecatedFamilies);
    if (families.length === 0) {
        return <p className="text-sm text-gray-600">No publish items in this batch.</p>;
    }
    return (
        <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-4 py-3">Family</th>
                        <th className="px-4 py-3">Target table</th>
                        <th className="px-4 py-3 text-right">Items</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                    {families.map((family) => {
                        const counts = countsByFamily[family];
                        const total = counts?.total ?? 0;
                        return (
                            <tr
                                key={family}
                                className={deprecatedSet.has(family) ? "bg-slate-50/80 text-gray-600" : undefined}
                            >
                                <td className="px-4 py-3 font-medium text-gray-900">
                                    <PublishEntityFamilyLabel family={family} />
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                                    {importReviewPromotionTargetLabel(family)}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums font-medium">{total}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default function ImportReviewPromotionBatchDetailClient() {
    const params = useParams();
    const searchParams = useSearchParams();
    const routeBatchId = typeof params.batchId === "string" ? params.batchId : "";
    const batchId = parseValidImportReviewPromotionBatchRouteId(routeBatchId);
    const invalidRouteBatchId = batchId === null;
    const backQuery = searchParams.toString();
    const backHref = backQuery
        ? `${importReviewPath("promotion")}?${backQuery}`
        : importReviewPath("promotion");

    const [batchDetail, setBatchDetail] = useState<ImportReviewPublishBatchDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(!invalidRouteBatchId);

    const loadBatch = useCallback(async (signal?: AbortSignal) => {
        if (!batchId) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const detail = await getImportReviewPromotionBatchById(
                batchId,
                signal ? { signal } : undefined
            );
            setBatchDetail(detail);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(formatImportReviewPromotionError(err));
                setBatchDetail(null);
            }
        } finally {
            setLoading(false);
        }
    }, [batchId]);

    useEffect(() => {
        if (invalidRouteBatchId) {
            setLoading(false);
            setBatchDetail(null);
            setError(null);
            return;
        }
        const controller = new AbortController();
        void loadBatch(controller.signal);
        return () => controller.abort();
    }, [invalidRouteBatchId, loadBatch]);

    const activeFamilies = useMemo(
        () => (batchDetail ? resolveBatchActiveFamilies(batchDetail) : []),
        [batchDetail]
    );

    const deprecatedFamilies = useMemo(
        () => (batchDetail ? resolveBatchDeprecatedFamilies(batchDetail) : []),
        [batchDetail]
    );

    const displayFamilies = useMemo(
        () =>
            batchDetail
                ? orderedBatchFamiliesForDisplay(
                      activeFamilies,
                      batchDetail.item_counts_by_entity_family ?? {}
                  )
                : [],
        [batchDetail, activeFamilies]
    );

    const displayDeprecatedFamilies = useMemo(
        () => orderedDeprecatedBatchFamiliesForDisplay(deprecatedFamilies),
        [deprecatedFamilies]
    );

    const hasRoadItems = (batchDetail?.item_counts_by_entity_family?.roads?.total ?? 0) > 0;
    const hasRoutingBarrierItems =
        (batchDetail?.item_counts_by_entity_family?.routing_barriers?.total ?? 0) > 0;
    const transportPromotionBlocked =
        batchHasDeprecatedTransportPromotionItems(batchDetail) || deprecatedFamilies.length > 0;

    const workflowStep =
        batchDetail?.status === "promoted" || batchDetail?.status === "partially_promoted"
            ? "verify"
            : batchDetail?.status === "ready" || batchDetail?.status === "partial"
              ? "promote"
              : "validate";

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <p className="text-sm text-gray-600">
                    <Link href={backHref} prefetch={false} className="font-medium text-emerald-800 hover:underline">
                        ← Promotion scope
                    </Link>
                    {" · "}
                    <Link href={importReviewHistoryHref()} prefetch={false} className="font-medium text-gray-700 hover:underline">
                        History
                    </Link>
                </p>

                <header className="space-y-3 border-b border-gray-200 pb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Publish batch</h1>
                    <p className="max-w-2xl text-sm text-gray-600">
                        Validate typed columns for every item, promote to the target tables, then verify core rows.
                    </p>
                    <ImportReviewPromotionStepBar activeStep={workflowStep} />
                </header>

                {invalidRouteBatchId ? (
                    <section className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
                        <ImportReviewStatusBanner
                            message={IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE}
                            tone="error"
                        />
                        <p className="mt-4">
                            <Link
                                href={backHref}
                                prefetch={false}
                                className="inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                            >
                                Back to promotion scope
                            </Link>
                        </p>
                    </section>
                ) : null}

                {loading ? (
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingPromotionBatch} />
                ) : null}
                {!invalidRouteBatchId && error ? (
                    <ImportReviewStatusBanner message={error} tone="error" />
                ) : null}

                {batchDetail ? (
                    <>
                        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                            <PromotionCardBody>
                                <div className="flex flex-wrap items-center gap-3">
                                    <h2 className="text-lg font-semibold text-gray-900">{batchDetail.batch_name}</h2>
                                    <PromotionStatusBadge value={batchDetail.derived_status ?? batchDetail.status} />
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    Batch #{batchDetail.id}
                                    {batchDetail.source_review_batch_id
                                        ? ` · review batch ${batchDetail.source_review_batch_id}`
                                        : ""}
                                </p>
                                {(batchDetail.derived_status_reason ?? batchDetail.status_note) ? (
                                    <p className="mt-2 text-sm text-amber-800">
                                        {batchDetail.derived_status_reason ?? batchDetail.status_note}
                                    </p>
                                ) : null}
                                <div className="mt-4">
                                    <BatchItemsByFamilyTable
                                        families={[...displayFamilies, ...displayDeprecatedFamilies]}
                                        deprecatedFamilies={displayDeprecatedFamilies}
                                        countsByFamily={batchDetail.item_counts_by_entity_family ?? {}}
                                    />
                                </div>
                                <ImportReviewPromotionDryRunNotice
                                    hasRoads={hasRoadItems}
                                    hasRoutingBarriers={hasRoutingBarrierItems}
                                    className="mt-4"
                                />
                            </PromotionCardBody>
                        </section>

                        {transportPromotionBlocked ? (
                            <>
                                <ImportReviewStatusBanner
                                    message={`${IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE} Validate and promote are disabled for this batch.`}
                                    tone="warning"
                                />
                                <p className="text-sm">
                                    <Link href={importTransportPath()} className="font-medium text-sky-800 underline">
                                        Open Import transport
                                    </Link>
                                </p>
                            </>
                        ) : null}

                        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                            <PromotionCardBody>
                                <PromotionSectionHeading
                                    title="Validate"
                                    subtitle="Runs batch validation and stores ready / warning / blocked on each publish item."
                                />
                                <ImportReviewPromotionValidationPanel
                                    batchId={batchDetail.id}
                                    batchStatus={batchDetail.status}
                                    selectedFamilies={displayFamilies}
                                    batchItemCount={batchDetail.item_counts.total}
                                    workflowBlocked={transportPromotionBlocked}
                                    workflowBlockedMessage={IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE}
                                    onBatchUpdated={setBatchDetail}
                                    formatError={formatImportReviewPromotionError}
                                />
                            </PromotionCardBody>
                        </section>

                        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                            <PromotionCardBody>
                                <PromotionSectionHeading
                                    title="Promote"
                                    subtitle="Writes typed candidate columns to core or routing targets. Warnings need a confirmation note."
                                />
                                <ImportReviewPromotionPromotePanel
                                    batchId={batchDetail.id}
                                    batchStatus={batchDetail.status}
                                    sourceReviewBatchId={batchDetail.source_review_batch_id}
                                    entityFamilies={displayFamilies}
                                    hasRoadItems={hasRoadItems}
                                    hasRoutingBarrierItems={hasRoutingBarrierItems}
                                    workflowBlocked={transportPromotionBlocked}
                                    workflowBlockedMessage={IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE}
                                    onBatchUpdated={setBatchDetail}
                                    formatError={formatImportReviewPromotionError}
                                />
                            </PromotionCardBody>
                        </section>
                    </>
                ) : null}
            </div>
        </main>
    );
}
