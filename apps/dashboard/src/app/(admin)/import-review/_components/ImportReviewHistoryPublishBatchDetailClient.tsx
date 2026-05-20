"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
    getImportReviewHistoryPublishBatchById,
    getImportReviewHistoryPublishBatchItems,
    isAbortError,
    type ImportReviewHistoryPublishBatchDetail,
    type ImportReviewHistoryPublishBatchItem,
} from "@/src/lib/api";
import {
    importReviewHistoryHref,
    importReviewHistoryReviewBatchHref,
} from "@/src/lib/importReviewEntityConfig";
import {
    CleanupPlaceholderButton,
    CollapsibleJson,
    formatHistoryDate,
    HistoryStatusBadge,
} from "@/src/app/(admin)/import-review/_components/importReviewHistoryUi";
import ImportReviewErrorState from "@/src/features/import-review/components/ImportReviewErrorState";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewSkeletonCards from "@/src/features/import-review/components/ImportReviewSkeletonCards";
import ImportReviewSkeletonTable from "@/src/features/import-review/components/ImportReviewSkeletonTable";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";

export default function ImportReviewHistoryPublishBatchDetailClient() {
    const params = useParams();
    const id = typeof params.id === "string" ? params.id : "";
    const [data, setData] = useState<ImportReviewHistoryPublishBatchDetail | null>(null);
    const [items, setItems] = useState<ImportReviewHistoryPublishBatchItem[]>([]);
    const [itemsTotal, setItemsTotal] = useState(0);
    const [itemsOffset, setItemsOffset] = useState(0);
    const [statusFilter, setStatusFilter] = useState("");
    const [entityFilter, setEntityFilter] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [itemsLoading, setItemsLoading] = useState(false);
    const itemsLimit = 25;

    const loadDetail = useCallback(async (signal?: AbortSignal) => {
        if (!id) {
            setError("Missing batch id.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setData(await getImportReviewHistoryPublishBatchById(id, signal ? { signal } : undefined));
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : "Failed to load batch.");
                setData(null);
            }
        } finally {
            setLoading(false);
        }
    }, [id]);

    const loadItems = useCallback(async (signal?: AbortSignal) => {
        if (!id) {
            return;
        }
        setItemsLoading(true);
        try {
            const res = await getImportReviewHistoryPublishBatchItems(
                id,
                {
                    publish_status: statusFilter || undefined,
                    entity_family: entityFilter || undefined,
                    limit: itemsLimit,
                    offset: itemsOffset,
                },
                signal ? { signal } : undefined
            );
            setItems(res.items);
            setItemsTotal(res.total);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : IMPORT_REVIEW_LOADING.loadingHistoryItems);
            }
        } finally {
            setItemsLoading(false);
        }
    }, [id, statusFilter, entityFilter, itemsOffset]);

    useEffect(() => {
        const controller = new AbortController();
        void loadDetail(controller.signal);
        return () => controller.abort();
    }, [loadDetail]);

    useEffect(() => {
        const controller = new AbortController();
        void loadItems(controller.signal);
        return () => controller.abort();
    }, [loadItems]);

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
                                    <p className="mt-1 font-mono text-sm text-gray-600">Publish batch #{data.id}</p>
                                    {data.source_review_batch ? (
                                        <p className="mt-1 text-sm text-gray-600">
                                            Review batch{" "}
                                            <Link
                                                href={importReviewHistoryReviewBatchHref(data.source_review_batch.id)}
                                                className="font-medium text-blue-700 hover:underline"
                                            >
                                                #{data.source_review_batch.id} · {data.source_review_batch.batch_name}
                                            </Link>
                                        </p>
                                    ) : null}
                                </div>
                                <HistoryStatusBadge status={data.status} />
                            </div>
                        </header>

                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {[
                                ["Items", data.item_counts.total],
                                ["Success", data.item_counts.success],
                                ["Failed", data.item_counts.failed],
                                ["Skipped", data.item_counts.skipped],
                                ["Pending", data.item_counts.pending],
                                ["Validated", data.validation_percent],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="text-xs text-gray-500">{label}</div>
                                    <div className="text-lg font-semibold tabular-nums">
                                        {typeof value === "number" ? value.toLocaleString() : String(value)}
                                        {label === "Validated" ? "%" : ""}
                                    </div>
                                </div>
                            ))}
                        </section>

                        <section className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <h2 className="text-sm font-semibold text-gray-900">Data state summary</h2>
                                <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Failed items</dt>
                                        <dd className="tabular-nums">{data.data_state_summary.failed_items}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Skipped items</dt>
                                        <dd className="tabular-nums">{data.data_state_summary.skipped_items}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Success with core target ID</dt>
                                        <dd className="tabular-nums">
                                            {data.data_state_summary.success_with_target_id}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Success missing target ID</dt>
                                        <dd className="tabular-nums">
                                            {data.data_state_summary.success_missing_target_id}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
                                <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Created</dt>
                                        <dd>{formatHistoryDate(data.created_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Validated</dt>
                                        <dd>{formatHistoryDate(data.validated_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Promoted</dt>
                                        <dd>{formatHistoryDate(data.promoted_at)}</dd>
                                    </div>
                                </dl>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Process-state logs</h2>
                            {data.process_state_logs.length === 0 ? (
                                <p className="mt-2 text-sm text-gray-600">No stage logs recorded.</p>
                            ) : (
                                <ol className="mt-3 space-y-2">
                                    {data.process_state_logs.map((log) => (
                                        <li
                                            key={log.id}
                                            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-gray-900">{log.stage_label}</span>
                                                <HistoryStatusBadge status={log.stage_status} />
                                                <span className="text-xs text-gray-500">
                                                    {formatHistoryDate(log.started_at)}
                                                </span>
                                            </div>
                                            {log.message ? (
                                                <p className="mt-1 text-gray-700">{log.message}</p>
                                            ) : null}
                                            <CollapsibleJson label="Stage details" value={log.details} />
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </section>

                        <CollapsibleJson label="Validation summary" value={data.validation_summary} />
                        <CollapsibleJson label="Promotion summary" value={data.promotion_summary} />
                        {data.validation_logs_summary ? (
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">Validation log summary:</span>{" "}
                                {data.validation_logs_summary}
                            </p>
                        ) : null}
                        {data.promotion_logs_summary ? (
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">Promotion log summary:</span>{" "}
                                {data.promotion_logs_summary}
                            </p>
                        ) : null}

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Publish items</h2>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <input
                                    type="text"
                                    placeholder="publish_status"
                                    value={statusFilter}
                                    onChange={(e) => {
                                        setStatusFilter(e.target.value);
                                        setItemsOffset(0);
                                    }}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="entity_family"
                                    value={entityFilter}
                                    onChange={(e) => {
                                        setEntityFilter(e.target.value);
                                        setItemsOffset(0);
                                    }}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                            </div>
                            {itemsLoading && items.length === 0 ? (
                                <div className="mt-3">
                                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingHistoryItems} />
                                    <ImportReviewSkeletonTable columnCount={6} rowCount={6} />
                                </div>
                            ) : (
                            <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2">Family</th>
                                            <th className="px-3 py-2">Status</th>
                                            <th className="px-3 py-2">Action</th>
                                            <th className="px-3 py-2">Candidate</th>
                                            <th className="px-3 py-2">Core target</th>
                                            <th className="px-3 py-2">Error</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {items.map((item) => (
                                            <tr key={item.id}>
                                                <td className="px-3 py-2">{item.entity_family}</td>
                                                <td className="px-3 py-2">
                                                    <HistoryStatusBadge status={item.publish_status} />
                                                </td>
                                                <td className="px-3 py-2">{item.publish_action ?? "—"}</td>
                                                <td className="px-3 py-2 font-mono text-xs">
                                                    {item.review_candidate_id ?? "—"}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs">
                                                    {item.target_table && item.target_id
                                                        ? `${item.target_table}#${item.target_id}`
                                                        : "—"}
                                                </td>
                                                <td className="px-3 py-2 max-w-xs truncate text-red-800" title={item.error_message ?? undefined}>
                                                    {item.error_message ?? "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            )}
                            {itemsLoading && items.length > 0 ? (
                                <div className="mt-2 flex justify-end">
                                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingHistoryItems} />
                                </div>
                            ) : null}
                            <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
                                <span>
                                    {items.length} of {itemsTotal} items
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={itemsOffset <= 0}
                                        onClick={() => setItemsOffset((o) => Math.max(0, o - itemsLimit))}
                                        className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        disabled={itemsOffset + itemsLimit >= itemsTotal}
                                        onClick={() => setItemsOffset((o) => o + itemsLimit)}
                                        className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        </section>

                        <CleanupPlaceholderButton />
                    </>
                ) : null}
            </div>
        </main>
    );
}
