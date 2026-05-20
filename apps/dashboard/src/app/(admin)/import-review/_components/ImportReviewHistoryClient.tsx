"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ImportReviewErrorState from "@/src/features/import-review/components/ImportReviewErrorState";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewSkeletonTable from "@/src/features/import-review/components/ImportReviewSkeletonTable";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    getImportReviewHistoryPublishBatches,
    getImportReviewHistoryReviewBatches,
    isAbortError,
    type ImportReviewHistoryPublishBatchListItem,
    type ImportReviewHistoryReviewBatchListItem,
} from "@/src/lib/api";
import {
    importReviewHistoryPublishBatchHref,
    importReviewHistoryReviewBatchHref,
} from "@/src/lib/importReviewEntityConfig";
import {
    formatHistoryDate,
    HistoryStatusBadge,
} from "@/src/app/(admin)/import-review/_components/importReviewHistoryUi";

type Tab = "review" | "publish";

function ReviewBatchTable({ items }: { items: ImportReviewHistoryReviewBatchListItem[] }) {
    if (items.length === 0) {
        return (
            <ImportReviewStatusBanner message="No review batches match the filters." tone="info" compact />
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Snapshot</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Uploaded</th>
                        <th className="px-4 py-3">Total</th>
                        <th className="px-4 py-3">Pending</th>
                        <th className="px-4 py-3">Promoted</th>
                        <th className="px-4 py-3">Publish</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                                <Link
                                    href={importReviewHistoryReviewBatchHref(row.id)}
                                    className="font-medium text-blue-700 hover:underline"
                                >
                                    {row.batch_name}
                                </Link>
                                <div className="font-mono text-xs text-gray-500">#{row.id}</div>
                            </td>
                            <td className="px-4 py-3 max-w-[12rem] truncate text-gray-700" title={row.source_snapshot_version}>
                                {row.source_snapshot_version}
                            </td>
                            <td className="px-4 py-3">
                                <HistoryStatusBadge status={row.status} />
                            </td>
                            <td className="px-4 py-3 text-gray-700">{formatHistoryDate(row.uploaded_at)}</td>
                            <td className="px-4 py-3 tabular-nums">{row.counts.batch_total_candidates.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums">{row.counts.pending_review_candidates.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums">{row.counts.promoted_candidates.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums text-gray-700">
                                {row.publish_batches.publish_batch_count} batches · promo ok{" "}
                                {row.publish_batches.promotion_success_count}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PublishBatchTable({ items }: { items: ImportReviewHistoryPublishBatchListItem[] }) {
    if (items.length === 0) {
        return (
            <ImportReviewStatusBanner message="No publish batches match the filters." tone="info" compact />
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Review batch</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3">Items</th>
                        <th className="px-4 py-3">Success</th>
                        <th className="px-4 py-3">Failed</th>
                        <th className="px-4 py-3">Promoted</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                                <Link
                                    href={importReviewHistoryPublishBatchHref(row.id)}
                                    className="font-medium text-blue-700 hover:underline"
                                >
                                    {row.batch_name}
                                </Link>
                                <div className="font-mono text-xs text-gray-500">#{row.id}</div>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-700">
                                {row.source_review_batch_id ? (
                                    <Link
                                        href={importReviewHistoryReviewBatchHref(row.source_review_batch_id)}
                                        className="text-blue-700 hover:underline"
                                    >
                                        #{row.source_review_batch_id}
                                    </Link>
                                ) : (
                                    "—"
                                )}
                            </td>
                            <td className="px-4 py-3">
                                <HistoryStatusBadge status={row.status} />
                            </td>
                            <td className="px-4 py-3 text-gray-700">{formatHistoryDate(row.created_at)}</td>
                            <td className="px-4 py-3 tabular-nums">{row.total_item_count.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums text-emerald-800">{row.success_count.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums text-red-800">{row.failed_count.toLocaleString()}</td>
                            <td className="px-4 py-3 text-gray-700">{formatHistoryDate(row.promoted_at)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ImportReviewHistoryClient() {
    const [tab, setTab] = useState<Tab>("review");
    const [statusFilter, setStatusFilter] = useState("");
    const [snapshotFilter, setSnapshotFilter] = useState("");
    const [entityFilter, setEntityFilter] = useState("");
    const [reviewBatchFilter, setReviewBatchFilter] = useState("");
    const [reviewItems, setReviewItems] = useState<ImportReviewHistoryReviewBatchListItem[]>([]);
    const [publishItems, setPublishItems] = useState<ImportReviewHistoryPublishBatchListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const limit = 25;

    const activeItems = tab === "review" ? reviewItems : publishItems;
    const isInitialLoad = loading && activeItems.length === 0;
    const isRefreshing = loading && activeItems.length > 0;

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            if (tab === "review") {
                const data = await getImportReviewHistoryReviewBatches(
                    {
                        status: statusFilter || undefined,
                        source_snapshot_version: snapshotFilter || undefined,
                        entity_family: entityFilter || undefined,
                        limit,
                        offset,
                    },
                    signal ? { signal } : undefined
                );
                setReviewItems(data.items);
                setTotal(data.total);
            } else {
                const data = await getImportReviewHistoryPublishBatches(
                    {
                        status: statusFilter || undefined,
                        source_snapshot_version: snapshotFilter || undefined,
                        source_review_batch_id: reviewBatchFilter || undefined,
                        entity_family: entityFilter || undefined,
                        limit,
                        offset,
                    },
                    signal ? { signal } : undefined
                );
                setPublishItems(data.items);
                setTotal(data.total);
            }
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : IMPORT_REVIEW_LOADING.failedToLoadHistory);
            }
        } finally {
            setLoading(false);
        }
    }, [tab, statusFilter, snapshotFilter, entityFilter, reviewBatchFilter, offset]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const tableColumnCount = tab === "review" ? 8 : 8;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Import review history</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Read-only audit of upload batches, publish batches, counts, and process logs. Promoted rows
                        remain in import_review (soft-hidden).
                    </p>
                </header>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setTab("review");
                            setOffset(0);
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "review" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Review batches
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setTab("publish");
                            setOffset(0);
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "publish" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Publish batches
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <input
                        type="text"
                        placeholder="Status filter"
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value);
                            setOffset(0);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="text"
                        placeholder="Source snapshot version"
                        value={snapshotFilter}
                        onChange={(e) => {
                            setSnapshotFilter(e.target.value);
                            setOffset(0);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="text"
                        placeholder="Entity family"
                        value={entityFilter}
                        onChange={(e) => {
                            setEntityFilter(e.target.value);
                            setOffset(0);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    {tab === "publish" ? (
                        <input
                            type="text"
                            placeholder="Source review batch ID"
                            value={reviewBatchFilter}
                            onChange={(e) => {
                                setReviewBatchFilter(e.target.value);
                                setOffset(0);
                            }}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                        />
                    ) : null}
                </div>

                {error ? <ImportReviewErrorState message={error} /> : null}

                {isRefreshing ? (
                    <div className="flex justify-end">
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.refreshingHistory} />
                    </div>
                ) : null}

                {isInitialLoad ? (
                    <ImportReviewSkeletonTable
                        columnCount={tableColumnCount}
                        message={IMPORT_REVIEW_LOADING.loadingHistory}
                    />
                ) : tab === "review" ? (
                    <ReviewBatchTable items={reviewItems} />
                ) : (
                    <PublishBatchTable items={publishItems} />
                )}

                <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>
                        Showing {tab === "review" ? reviewItems.length : publishItems.length} of {total}
                        {loading ? ` · ${IMPORT_REVIEW_LOADING.refreshingHistory}` : ""}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={offset <= 0 || loading}
                            onClick={() => setOffset((o) => Math.max(0, o - limit))}
                            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            disabled={offset + limit >= total || loading}
                            onClick={() => setOffset((o) => o + limit)}
                            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
