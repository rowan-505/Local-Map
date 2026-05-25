"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

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
} from "@/src/lib/api";
import { importReviewPath } from "@/src/lib/dashboardNavigation";
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

    const hasRoadItems = (batchDetail?.item_counts_by_entity_family?.roads?.total ?? 0) > 0;
    const hasBusRouteItems = (batchDetail?.item_counts_by_entity_family?.bus_routes?.total ?? 0) > 0;
    const hasBusRouteVariantItems =
        (batchDetail?.item_counts_by_entity_family?.bus_route_variants?.total ?? 0) > 0;
    const hasBusRouteStopItems =
        (batchDetail?.item_counts_by_entity_family?.bus_route_stops?.total ?? 0) > 0;
    const hasAdminAreaItems = (batchDetail?.item_counts_by_entity_family?.admin_areas?.total ?? 0) > 0;
    const hasRoutingBarrierItems =
        (batchDetail?.item_counts_by_entity_family?.routing_barriers?.total ?? 0) > 0;

    return (
        <main className="p-6">
            <p className="text-sm text-gray-600">
                <Link href={backHref} className="font-medium text-emerald-800 hover:underline">
                    ← Promotion
                </Link>
            </p>
            <PromotionSectionHeading
                title="Publish batch"
                subtitle="Validate publish items across entity families; promote buildings, places, landuse, and water features to core."
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
                <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
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
                                        : batchDetail.derived_status === "needs_attention"
                                          ? "text-amber-800"
                                          : "text-amber-800"
                                }`}
                            >
                                {batchDetail.derived_status_reason ?? batchDetail.status_note}
                            </p>
                        ) : null}
                        <p className="mt-1 text-xs text-gray-500">Batch id {batchDetail.id}</p>
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
                                    ["Import review marked", batchDetail.import_review_marked_promoted_count],
                                    ["Inserted", batchDetail.inserted_count],
                                    ["Updated", batchDetail.updated_count],
                                ]}
                            />
                            {Object.keys(batchDetail.item_counts_by_entity_family ?? {}).length > 0 ? (
                                <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 lg:col-span-1">
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        By entity family
                                    </h4>
                                    <div className="mt-2 space-y-3">
                                        {Object.entries(batchDetail.item_counts_by_entity_family)
                                            .sort(([a], [b]) => a.localeCompare(b))
                                            .map(([family, counts]) => (
                                                <div key={family}>
                                                    <p className="text-sm font-medium text-gray-900">
                                                        <PublishEntityFamilyLabel family={family} />
                                                    </p>
                                                    <p className="text-xs text-gray-600">
                                                        {counts.success} success · {counts.pending} pending ·{" "}
                                                        {counts.failed} failed · {counts.total} total
                                                    </p>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            ) : (
                                <PublishItemCountsPanel
                                    title="Building items"
                                    rows={[
                                        ["Pending", batchDetail.building_item_counts.pending],
                                        ["Success", batchDetail.building_item_counts.success],
                                        ["Failed", batchDetail.building_item_counts.failed],
                                        ["Skipped", batchDetail.building_item_counts.skipped],
                                        ["Total", batchDetail.building_item_counts.total],
                                    ]}
                                />
                            )}
                        </div>
                        {hasAdminAreaItems ? (
                            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                                Admin area promotion is high risk. These rows affect search filters, address
                                hierarchy, clipping, analytics, routing region selection, and dashboard filters.
                                Batches with more than 3 admin area items require{" "}
                                <code className="rounded bg-white/70 px-1 text-xs">
                                    ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION=true
                                </code>
                                .
                            </div>
                        ) : null}
                        {hasBusRouteItems ? (
                            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                                Bus route promotion writes routes and route names only. Route variants and route
                                stops are separate transit phases.
                            </div>
                        ) : null}
                        {hasBusRouteVariantItems ? (
                            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                                Bus route variants require an existing promoted/core bus route. Validation shows
                                DEPENDENCY_ROUTE_MISSING when route_id, route_code, or external route references
                                cannot resolve.
                            </div>
                        ) : null}
                        {hasBusRouteStopItems ? (
                            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                                Bus route stops require both dependencies first: a promoted/core route variant and
                                a promoted/core bus stop. Validation shows DEPENDENCY_VARIANT_MISSING or
                                DEPENDENCY_STOP_MISSING, plus sequence warnings for gaps and non-increasing
                                distance.
                            </div>
                        ) : null}
                        <ImportReviewPromotionValidationPanel
                            batchId={batchDetail.id}
                            batchStatus={batchDetail.status}
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
                            hasRoadItems={hasRoadItems}
                            hasAdminAreaItems={hasAdminAreaItems}
                            hasRoutingBarrierItems={hasRoutingBarrierItems}
                            roadDryRunResult={roadDryRunResult}
                            routingBarrierDryRunResult={routingBarrierDryRunResult}
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
                </section>
            ) : null}
        </main>
    );
}
