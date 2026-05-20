"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

import ImportReviewPromotionPromotePanel from "@/src/app/(admin)/import-review/_components/ImportReviewPromotionPromotePanel";
import ImportReviewPromotionValidationPanel from "@/src/app/(admin)/import-review/_components/ImportReviewPromotionValidationPanel";
import {
    PromotionCardBody,
    PromotionSectionHeading,
    PromotionStatusBadge,
} from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import {
    getImportReviewPromotionBatchById,
    isAbortError,
    type ImportReviewPublishBatchDetail,
} from "@/src/lib/api";
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
        ? `/import-review/promotion?${backQuery}`
        : "/import-review/promotion";

    const [batchDetail, setBatchDetail] = useState<ImportReviewPublishBatchDetail | null>(null);
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

    return (
        <main className="p-6">
            <p className="text-sm text-gray-600">
                <Link href={backHref} className="font-medium text-emerald-800 hover:underline">
                    ← Promotion
                </Link>
            </p>
            <PromotionSectionHeading
                title="Publish batch"
                subtitle="Validate publish items across entity families; promote buildings and places to core."
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
                            <PromotionStatusBadge value={batchDetail.status} />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Batch id {batchDetail.id}</p>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <PublishItemCountsPanel
                                title="All items"
                                rows={[
                                    ["Pending", batchDetail.item_counts.pending],
                                    ["Success", batchDetail.item_counts.success],
                                    ["Failed", batchDetail.item_counts.failed],
                                    ["Skipped", batchDetail.item_counts.skipped],
                                    ["Total", batchDetail.item_counts.total],
                                ]}
                            />
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
                        </div>
                        <ImportReviewPromotionValidationPanel
                            batchId={batchDetail.id}
                            batchStatus={batchDetail.status}
                            onBatchUpdated={setBatchDetail}
                            formatError={formatPromotionError}
                        />
                        <ImportReviewPromotionPromotePanel
                            batchId={batchDetail.id}
                            batchStatus={batchDetail.status}
                            onBatchUpdated={setBatchDetail}
                            formatError={formatPromotionError}
                        />
                    </PromotionCardBody>
                </section>
            ) : null}
        </main>
    );
}
