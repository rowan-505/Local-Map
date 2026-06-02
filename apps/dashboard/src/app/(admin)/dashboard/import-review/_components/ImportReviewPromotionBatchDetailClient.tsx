"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
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

import ImportReviewPromotionPromotePanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionPromotePanel";
import ImportReviewPromotionCleanupPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionCleanupPanel";
import ImportReviewPromotionRoadDryRunPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionRoadDryRunPanel";
import ImportReviewPromotionRoutingBarrierDryRunPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionRoutingBarrierDryRunPanel";
import ImportReviewPromotionValidationPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionValidationPanel";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
    PublishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import {
    getImportReviewPromotionBatchById,
    isAbortError,
    type ImportReviewPromotionRoadDryRunResult,
    type ImportReviewPromotionRoutingBarrierDryRunResult,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchEntityItemCounts,
} from "@/src/lib/api";
import { importReviewPath, importTransportPath } from "@/src/lib/dashboardNavigation";
import { isImportReviewDevTokenConfigured } from "@/src/lib/importReviewDevAccess";

function formatPromotionError(err: unknown): string {
    if (!(err instanceof Error)) {
        return "Request failed.";
    }
    const m = err.message;
    if (m.includes("401") || m.toLowerCase().includes("authentication")) {
        if (isImportReviewDevTokenConfigured()) {
            return "Unauthorized — check NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN matches the API IMPORT_REVIEW_ADMIN_TOKEN.";
        }
        return "Unauthorized — sign in as an admin or configure the dev admin token.";
    }
    if (m.includes("403") || m.toLowerCase().includes("forbidden")) {
        return "Forbidden — import review requires admin access.";
    }
    return m;
}

function PublishItemCountsPanel({ title, rows }: { title: string; rows: [string, number][] }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
            <dl className="mt-2 space-y-1 text-sm">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                        <dt className="text-gray-600">{label}</dt>
                        <dd className="tabular-nums font-medium text-gray-900">{value.toLocaleString()}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

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
                        <th className="px-4 py-3">Target</th>
                        <th className="px-4 py-3 text-right">Pending</th>
                        <th className="px-4 py-3 text-right">Success</th>
                        <th className="px-4 py-3 text-right">Failed</th>
                        <th className="px-4 py-3 text-right">Skipped</th>
                        <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                    {families.map((family) => {
                        const counts = countsByFamily[family] ?? {
                            pending: 0,
                            success: 0,
                            failed: 0,
                            skipped: 0,
                            total: 0,
                        };
                        const isDeprecated = deprecatedSet.has(family);
                        return (
                            <tr
                                key={family}
                                className={isDeprecated ? "bg-slate-50/80 text-gray-600" : undefined}
                            >
                                <td className="px-4 py-3 font-medium text-gray-900">
                                    <PublishEntityFamilyLabel family={family} />
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                                    {importReviewPromotionTargetLabel(family)}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{counts.pending}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                                    {counts.success}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums text-red-700">{counts.failed}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{counts.skipped}</td>
                                <td className="px-4 py-3 text-right tabular-nums font-medium">{counts.total}</td>
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
    const batchId = typeof params.batchId === "string" ? params.batchId : "";
    const backQuery = searchParams.toString();
    const backHref = backQuery
        ? `${importReviewPath("promotion")}?${backQuery}`
        : importReviewPath("promotion");

    const [batchDetail, setBatchDetail] = useState<ImportReviewPublishBatchDetail | null>(null);
    const [roadDryRunResult, setRoadDryRunResult] = useState<ImportReviewPromotionRoadDryRunResult | null>(
        null
    );
    const [routingBarrierDryRunResult, setRoutingBarrierDryRunResult] =
        useState<ImportReviewPromotionRoutingBarrierDryRunResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const loadBatch = useCallback(async (signal?: AbortSignal) => {
        if (!batchId) {
            setError("Missing batch id.");
            setLoading(false);
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
                setError(formatPromotionError(err));
                setBatchDetail(null);
            }
        } finally {
            setLoading(false);
        }
    }, [batchId]);

    useEffect(() => {
        const controller = new AbortController();
        void loadBatch(controller.signal);
        return () => controller.abort();
    }, [loadBatch]);

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
    const hasDeprecatedTransportItems = batchHasDeprecatedTransportPromotionItems(batchDetail);
    const transportPromotionBlocked = hasDeprecatedTransportItems || deprecatedFamilies.length > 0;
    const hasAdminAreaItems = (batchDetail?.item_counts_by_entity_family?.admin_areas?.total ?? 0) > 0;
    const hasRoutingBarrierItems =
        (batchDetail?.item_counts_by_entity_family?.routing_barriers?.total ?? 0) > 0;

    return (
        <main className="p-6">
            <p className="text-sm text-gray-600">
                <Link href={backHref} prefetch={false} className="font-medium text-emerald-800 hover:underline">
                    ← Promotion
                </Link>
            </p>
            <PromotionSectionHeading
                title="Publish batch"
                subtitle="Validate and promote approved import-review candidates across the entity families in this batch."
            />

            {loading ? (
                <div className="mt-4">
                    <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingPromotionBatch} />
                </div>
            ) : null}
            {error ? (
                <div className="mt-4">
                    <ImportReviewStatusBanner message={error} tone="error" />
                </div>
            ) : null}

            {batchDetail ? (
                <section className="mt-6 space-y-6">
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 className="text-lg font-semibold text-gray-900">{batchDetail.batch_name}</h2>
                                <PromotionStatusBadge value={batchDetail.derived_status ?? batchDetail.status} />
                                {batchDetail.derived_status !== batchDetail.status ? (
                                    <span className="text-xs text-gray-500">stored: {batchDetail.status}</span>
                                ) : null}
                            </div>
                            {(batchDetail.derived_status_reason ?? batchDetail.status_note) ? (
                                <p
                                    className={`mt-2 text-sm ${
                                        batchDetail.derived_status === "invalid_empty_promoted"
                                            ? "text-red-800"
                                            : "text-amber-800"
                                    }`}
                                >
                                    {batchDetail.derived_status_reason ?? batchDetail.status_note}
                                </p>
                            ) : null}
                            <p className="mt-1 text-xs text-gray-500">
                                Batch id {batchDetail.id}
                                {batchDetail.source_review_batch_id
                                    ? ` · review batch ${batchDetail.source_review_batch_id}`
                                    : ""}
                            </p>

                            <div className="mt-4 space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">Selected families</h3>
                                    {activeFamilies.length > 0 ? (
                                        <ul className="mt-2 space-y-2">
                                            {activeFamilies.map((family) => (
                                                <li
                                                    key={family}
                                                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                                                >
                                                    <PublishEntityFamilyLabel family={family} />
                                                    <span className="font-mono text-xs text-gray-500">
                                                        {importReviewPromotionTargetLabel(family)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="mt-1 text-sm text-gray-600">
                                            No active promotion families on this batch.
                                        </p>
                                    )}
                                </div>
                                {displayDeprecatedFamilies.length > 0 ? (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                                        <h4 className="text-sm font-semibold text-slate-800">
                                            Deprecated transport families (read-only)
                                        </h4>
                                        <p className="mt-1 text-sm text-slate-700">
                                            {IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE}
                                        </p>
                                        <ul className="mt-3 space-y-2">
                                            {displayDeprecatedFamilies.map((family) => (
                                                <li
                                                    key={family}
                                                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-700"
                                                >
                                                    <PublishEntityFamilyLabel family={family} />
                                                    <span className="font-mono text-xs text-slate-500">
                                                        {importReviewPromotionTargetLabel(family)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                            </div>
                        </PromotionCardBody>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <PromotionSectionHeading
                                title="Publish items by family"
                                subtitle="Live item counts grouped by entity family in this batch."
                            />
                            <div className="mt-4">
                                <BatchItemsByFamilyTable
                                    families={[...displayFamilies, ...displayDeprecatedFamilies]}
                                    deprecatedFamilies={displayDeprecatedFamilies}
                                    countsByFamily={batchDetail.item_counts_by_entity_family ?? {}}
                                />
                            </div>
                        </PromotionCardBody>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <PromotionSectionHeading title="Batch totals" />
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <PublishItemCountsPanel
                                    title="All items (live)"
                                    rows={[
                                        ["Pending", batchDetail.item_counts.pending],
                                        ["Success", batchDetail.item_counts.success],
                                        ["Failed", batchDetail.item_counts.failed],
                                        ["Skipped", batchDetail.item_counts.skipped],
                                        ["Total", batchDetail.item_counts.total],
                                    ]}
                                />
                                <PublishItemCountsPanel
                                    title="Verification"
                                    rows={[
                                        ["Core verified", batchDetail.core_verified_count],
                                        [
                                            "Import review marked",
                                            batchDetail.import_review_marked_promoted_count,
                                        ],
                                        ["Inserted", batchDetail.inserted_count],
                                        ["Updated", batchDetail.updated_count],
                                    ]}
                                />
                            </div>
                        </PromotionCardBody>
                    </div>

                    {hasAdminAreaItems ? (
                        <ImportReviewStatusBanner
                            message="Admin area promotion is high risk. These rows affect search filters, address hierarchy, clipping, analytics, routing region selection, and dashboard filters. Batches with more than 3 admin area items require ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION=true."
                            tone="warning"
                            compact
                        />
                    ) : null}
                    {transportPromotionBlocked ? (
                        <ImportReviewStatusBanner
                            message={`${IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE} Validate and promote are disabled for this batch.`}
                            tone="warning"
                            compact
                        />
                    ) : null}
                    {transportPromotionBlocked ? (
                        <p className="text-sm">
                            <Link href={importTransportPath()} className="font-medium text-sky-800 underline">
                                Open Import transport
                            </Link>
                        </p>
                    ) : null}

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                        <PromotionCardBody>
                            <ImportReviewPromotionValidationPanel
                                batchId={batchDetail.id}
                                batchStatus={batchDetail.status}
                                selectedFamilies={displayFamilies}
                                workflowBlocked={transportPromotionBlocked}
                                workflowBlockedMessage={IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE}
                                onBatchUpdated={setBatchDetail}
                                formatError={formatPromotionError}
                            />
                            {hasRoadItems ? (
                                <ImportReviewPromotionRoadDryRunPanel
                                    batchId={batchDetail.id}
                                    formatError={formatPromotionError}
                                    onDryRunUpdated={setRoadDryRunResult}
                                />
                            ) : null}
                            {hasRoutingBarrierItems ? (
                                <ImportReviewPromotionRoutingBarrierDryRunPanel
                                    batchId={batchDetail.id}
                                    formatError={formatPromotionError}
                                    onDryRunUpdated={setRoutingBarrierDryRunResult}
                                />
                            ) : null}
                            <ImportReviewPromotionPromotePanel
                                batchId={batchDetail.id}
                                batchStatus={batchDetail.status}
                                sourceReviewBatchId={batchDetail.source_review_batch_id}
                                hasRoadItems={hasRoadItems}
                                hasAdminAreaItems={hasAdminAreaItems}
                                hasRoutingBarrierItems={hasRoutingBarrierItems}
                                roadDryRunResult={roadDryRunResult}
                                routingBarrierDryRunResult={routingBarrierDryRunResult}
                                workflowBlocked={transportPromotionBlocked}
                                workflowBlockedMessage={IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE}
                                onBatchUpdated={setBatchDetail}
                                formatError={formatPromotionError}
                            />
                            {batchDetail.status === "promoted" && batchDetail.source_review_batch_id ? (
                                <ImportReviewPromotionCleanupPanel
                                    reviewBatchId={batchDetail.source_review_batch_id}
                                    publishBatchId={batchDetail.id}
                                    formatError={formatPromotionError}
                                />
                            ) : null}
                        </PromotionCardBody>
                    </div>
                </section>
            ) : null}
        </main>
    );
}
