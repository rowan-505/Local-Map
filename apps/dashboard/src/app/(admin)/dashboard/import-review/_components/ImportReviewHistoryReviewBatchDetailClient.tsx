"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
    getImportReviewHistoryReviewBatchById,
    isAbortError,
    type ImportReviewHistoryReviewBatchDetail,
} from "@/src/lib/api";
import {
    getImportReviewEntityByApiFamily,
    importReviewEntityHref,
    importReviewHistoryHref,
    importReviewHistoryPublishBatchHref,
} from "@/src/lib/importReviewEntityConfig";
import {
    CollapsibleJson,
    formatHistoryDate,
    HistoryStatusBadge,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewHistoryUi";
import ImportReviewPromotionCleanupPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionCleanupPanel";
import ImportReviewErrorState from "@/src/features/import-review/components/ImportReviewErrorState";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewSkeletonCards from "@/src/features/import-review/components/ImportReviewSkeletonCards";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

export default function ImportReviewHistoryReviewBatchDetailClient() {
    const params = useParams();
    const id = typeof params.id === "string" ? params.id : "";
    const [data, setData] = useState<ImportReviewHistoryReviewBatchDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (signal?: AbortSignal) => {
        if (!id) {
            setError("Missing batch id.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setData(await getImportReviewHistoryReviewBatchById(id, signal ? { signal } : undefined));
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : "Failed to load batch.");
                setData(null);
            }
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <p className="text-sm text-gray-600">
                    <Link href={importReviewHistoryHref()} className="font-medium text-blue-700 hover:underline">
                        ← History
                    </Link>
                </p>

                {loading ? (
                    <>
                        <ImportReviewLoadingBannerWithSpinner message={IMPORT_REVIEW_LOADING.loadingHistoryBatch} />
                        <ImportReviewSkeletonCards count={6} columns={3} />
                    </>
                ) : null}
                {error ? <ImportReviewErrorState message={error} /> : null}

                {data ? (
                    <>
                        <header className="border-b border-gray-200 pb-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">{data.batch_name}</h1>
                                    <p className="mt-1 font-mono text-sm text-gray-600">Review batch #{data.id}</p>
                                </div>
                                <HistoryStatusBadge status={data.derived_status ?? data.status} />
                            </div>
                            {(data.derived_status_reason ?? data.status_note) ? (
                                <p
                                    className={`mt-2 text-sm ${
                                        data.derived_status === "needs_attention"
                                            ? "text-amber-800"
                                            : data.derived_status === "invalid_empty_promoted"
                                              ? "text-red-800"
                                              : "text-gray-700"
                                    }`}
                                >
                                    {data.derived_status_reason ?? data.status_note}
                                </p>
                            ) : null}
                            {data.derived_status !== data.status ? (
                                <p className="mt-1 text-xs text-gray-500">Stored status: {data.status}</p>
                            ) : null}
                            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <dt className="text-gray-500">Snapshot</dt>
                                    <dd className="font-medium text-gray-900">{data.source_snapshot_version}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Uploaded</dt>
                                    <dd>{formatHistoryDate(data.uploaded_at)}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Validated (latest publish)</dt>
                                    <dd>{formatHistoryDate(data.validated_at)}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Promoted (latest publish)</dt>
                                    <dd>{formatHistoryDate(data.promoted_at)}</dd>
                                </div>
                            </dl>
                        </header>

                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {[
                                ["Batch total", data.counts.batch_total_candidates],
                                ["Active", data.counts.active_candidates],
                                ["Pending", data.counts.pending_review_candidates],
                                ["Approved", data.counts.approved_candidates],
                                ["Rejected", data.counts.rejected_candidates],
                                ["Promoted", data.counts.promoted_candidates],
                                ["Promotion failed", data.counts.promotion_failed_candidates],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="text-xs text-gray-500">{label}</div>
                                    <div className="text-lg font-semibold tabular-nums">{Number(value).toLocaleString()}</div>
                                </div>
                            ))}
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Entity breakdown</h2>
                            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                                {data.counts_by_entity_family.map((f) => {
                                    const cfg = getImportReviewEntityByApiFamily(f.entity_family);
                                    const slug = cfg?.slug;
                                    return (
                                        <div
                                            key={f.entity_family}
                                            className="rounded-lg border border-gray-200 bg-white p-4 text-sm"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <h3 className="font-semibold text-gray-900">
                                                    {cfg?.pluralLabel ?? f.entity_family}
                                                </h3>
                                                {slug ? (
                                                    <Link
                                                        href={importReviewEntityHref(slug, {
                                                            get: (k) =>
                                                                k === "review_batch_id" ? data.id : null,
                                                            toString: () => `review_batch_id=${data.id}`,
                                                        })}
                                                        className="text-xs text-blue-700 underline"
                                                    >
                                                        Open queue
                                                    </Link>
                                                ) : null}
                                            </div>
                                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                                                <dt className="text-gray-500">Batch total</dt>
                                                <dd className="tabular-nums">{f.batch_total.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Active</dt>
                                                <dd className="tabular-nums">{f.active.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Pending</dt>
                                                <dd className="tabular-nums">{f.pending_review.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Promoted</dt>
                                                <dd className="tabular-nums">{f.promoted.toLocaleString()}</dd>
                                            </dl>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Publish batch attempts</h2>
                            {(data.publish_batch_attempts?.length ?? data.publish_batch_summaries.length) === 0 ? (
                                <p className="mt-2 text-sm text-gray-600">No publish batches linked yet.</p>
                            ) : (
                                <ul className="mt-3 space-y-2">
                                    {(data.publish_batch_attempts ?? data.publish_batch_summaries.map((pb) => ({
                                        id: pb.id,
                                        batch_name: pb.batch_name,
                                        stored_status: pb.status,
                                        derived_status: pb.derived_status ?? pb.status,
                                        created_at: pb.created_at,
                                        promoted_at: pb.promoted_at,
                                        total_item_count: pb.total_item_count,
                                        success_count: pb.success_count,
                                        failed_count: pb.failed_count,
                                        core_verified_count: pb.core_verified_count ?? 0,
                                        import_review_marked_promoted_count: pb.import_review_marked_promoted_count ?? 0,
                                    }))).map((pb) => (
                                        <li key={pb.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                                            <Link
                                                href={importReviewHistoryPublishBatchHref(pb.id)}
                                                className="font-medium text-blue-700 hover:underline"
                                            >
                                                {pb.batch_name}
                                            </Link>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <HistoryStatusBadge status={pb.derived_status} />
                                                <span className="text-xs text-gray-500">
                                                    {pb.success_count}/{pb.total_item_count} success · core verified{" "}
                                                    {pb.core_verified_count}
                                                </span>
                                                {pb.stored_status !== pb.derived_status ? (
                                                    <span className="text-xs text-gray-400">
                                                        stored: {pb.stored_status}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <CollapsibleJson label="Upload batch summary (JSON)" value={data.summary} />
                        <ImportReviewPromotionCleanupPanel reviewBatchId={id} />
                    </>
                ) : null}
            </div>
        </main>
    );
}
