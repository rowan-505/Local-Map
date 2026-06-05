"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
    formatHistoryDate,
    HistoryStatusBadge,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewHistoryUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewSkeletonTable from "@/src/features/import-review/components/ImportReviewSkeletonTable";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    getImportReviewHistoryPublishBatches,
    getImportReviewHistoryReviewBatches,
    isAbortError,
    type ImportReviewHistoryPublishBatchListItem,
    type ImportReviewHistoryReviewBatchListItem,
} from "@/src/lib/api";

import {
    ImportReviewHistoryPublishBatchActions,
    ImportReviewHistoryReviewBatchActions,
} from "./ImportReviewHistoryActions";
import {
    IMPORT_REVIEW_HISTORY_ENTITY_FAMILIES,
    IMPORT_REVIEW_HISTORY_PAGE_SIZE,
    IMPORT_REVIEW_HISTORY_PUBLISH_STATUSES,
    IMPORT_REVIEW_HISTORY_REVIEW_STATUSES,
} from "./importReviewHistoryConstants";

type Tab = "review" | "publish";

type Filters = {
    status: string;
    entityFamily: string;
    reviewBatchId: string;
};

const EMPTY_FILTERS: Filters = {
    status: "",
    entityFamily: "",
    reviewBatchId: "",
};

function filterLabel(value: string, placeholder: string): string {
    return value.trim() || placeholder;
}

function ReviewBatchesTable({ items }: { items: ImportReviewHistoryReviewBatchListItem[] }) {
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-3 py-3">ID</th>
                        <th className="px-3 py-3">Batch</th>
                        <th className="px-3 py-3">Snapshot</th>
                        <th className="px-3 py-3">Region</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Candidates</th>
                        <th className="px-3 py-3">Created</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-3 py-3 font-mono text-xs text-gray-600">{row.id}</td>
                            <td className="px-3 py-3 font-medium text-gray-900">{row.batch_name}</td>
                            <td
                                className="max-w-[10rem] truncate px-3 py-3 text-gray-700"
                                title={row.source_snapshot_version}
                            >
                                {row.source_snapshot_version}
                            </td>
                            <td className="px-3 py-3 text-gray-700">{row.region_code ?? "—"}</td>
                            <td className="px-3 py-3">
                                <HistoryStatusBadge status={row.derived_status ?? row.status} />
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-700">
                                <div className="tabular-nums">
                                    Total {row.counts.batch_total_candidates.toLocaleString()}
                                </div>
                                <div className="tabular-nums text-gray-500">
                                    Active {row.counts.active_candidates.toLocaleString()} · Pending{" "}
                                    {row.counts.pending_review_candidates.toLocaleString()}
                                </div>
                                <div className="tabular-nums text-gray-500">
                                    Publish runs {row.publish_batches.publish_batch_count}
                                </div>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{formatHistoryDate(row.created_at)}</td>
                            <td className="px-3 py-3 text-right">
                                <ImportReviewHistoryReviewBatchActions batchId={row.id} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PublishBatchesTable({
    items,
    onRefresh,
}: {
    items: ImportReviewHistoryPublishBatchListItem[];
    onRefresh: () => void;
}) {
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-3 py-3">ID</th>
                        <th className="px-3 py-3">Batch</th>
                        <th className="px-3 py-3">Review batch</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Items</th>
                        <th className="px-3 py-3">Validation</th>
                        <th className="px-3 py-3">Stage</th>
                        <th className="px-3 py-3">Progress</th>
                        <th className="px-3 py-3">Created</th>
                        <th className="px-3 py-3">Promoted</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => {
                        const iv = row.item_validation_counts;
                        const progressLabel =
                            row.promotion_percent != null
                                ? `Val ${row.validation_percent}% · Promo ${row.promotion_percent}%`
                                : `Val ${row.validation_percent}%`;
                        return (
                            <tr key={row.id} className="hover:bg-gray-50">
                                <td className="px-3 py-3 font-mono text-xs text-gray-600">{row.id}</td>
                                <td className="px-3 py-3 font-medium text-gray-900">{row.batch_name}</td>
                                <td className="px-3 py-3 font-mono text-xs text-gray-700">
                                    {row.source_review_batch_id ?? "—"}
                                </td>
                                <td className="px-3 py-3">
                                    <HistoryStatusBadge status={row.derived_status ?? row.status} />
                                </td>
                                <td className="px-3 py-3 tabular-nums text-xs">
                                    <div>{row.total_item_count.toLocaleString()} total</div>
                                    <div className="text-gray-500">
                                        R {iv.ready} · W {iv.warning} · B {iv.blocked}
                                    </div>
                                    <div className="text-gray-500">
                                        OK {row.publish_status_counts.success} · Fail{" "}
                                        {row.publish_status_counts.failed} · Pend{" "}
                                        {row.publish_status_counts.pending}
                                    </div>
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-700">
                                    {row.validated_at ? formatHistoryDate(row.validated_at) : "—"}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-700">
                                    {row.current_stage_label ?? row.current_stage ?? "—"}
                                </td>
                                <td className="px-3 py-3 text-xs tabular-nums text-gray-700">
                                    {progressLabel}
                                </td>
                                <td className="px-3 py-3 text-gray-700">{formatHistoryDate(row.created_at)}</td>
                                <td className="px-3 py-3 text-gray-700">{formatHistoryDate(row.promoted_at)}</td>
                                <td className="px-3 py-3 text-right">
                                    <ImportReviewHistoryPublishBatchActions
                                        batchId={row.id}
                                        resumableActions={row.resumable_actions ?? []}
                                        onActionComplete={onRefresh}
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default function ImportReviewHistoryPage() {
    const [tab, setTab] = useState<Tab>("review");
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [reviewItems, setReviewItems] = useState<ImportReviewHistoryReviewBatchListItem[]>([]);
    const [publishItems, setPublishItems] = useState<ImportReviewHistoryPublishBatchListItem[]>([]);
    const [reviewBatchOptions, setReviewBatchOptions] = useState<
        { id: string; batch_name: string }[]
    >([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadedOnce, setLoadedOnce] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const limit = IMPORT_REVIEW_HISTORY_PAGE_SIZE;
    const activeItems = tab === "review" ? reviewItems : publishItems;
    const hasFilters = filters.status !== "" || filters.entityFamily !== "" || filters.reviewBatchId !== "";

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError(null);
            try {
                if (tab === "review") {
                    const data = await getImportReviewHistoryReviewBatches(
                        {
                            status: filters.status || undefined,
                            entity_family: filters.entityFamily || undefined,
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
                            status: filters.status || undefined,
                            entity_family: filters.entityFamily || undefined,
                            source_review_batch_id: filters.reviewBatchId || undefined,
                            limit,
                            offset,
                        },
                        signal ? { signal } : undefined
                    );
                    setPublishItems(data.items);
                    setTotal(data.total);
                }
                setLoadedOnce(true);
            } catch (err) {
                if (!isAbortError(err)) {
                    setError(err instanceof Error ? err.message : IMPORT_REVIEW_LOADING.failedToLoadHistory);
                }
            } finally {
                setLoading(false);
            }
        },
        [tab, filters.status, filters.entityFamily, filters.reviewBatchId, offset, limit]
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    useEffect(() => {
        if (tab !== "publish") {
            return;
        }
        const controller = new AbortController();
        void getImportReviewHistoryReviewBatches({ limit: 100, offset: 0 }, { signal: controller.signal })
            .then((data) => {
                setReviewBatchOptions(
                    data.items.map((row) => ({ id: row.id, batch_name: row.batch_name }))
                );
            })
            .catch(() => {
                setReviewBatchOptions([]);
            });
        return () => controller.abort();
    }, [tab]);

    const statusOptions = useMemo(
        () => (tab === "review" ? IMPORT_REVIEW_HISTORY_REVIEW_STATUSES : IMPORT_REVIEW_HISTORY_PUBLISH_STATUSES),
        [tab]
    );

    const clearFilters = () => {
        setFilters(EMPTY_FILTERS);
        setOffset(0);
    };

    const switchTab = (next: Tab) => {
        setTab(next);
        setOffset(0);
        setFilters(EMPTY_FILTERS);
    };

    const showEmpty = loadedOnce && !loading && !error && activeItems.length === 0;
    const showSkeleton = loading && !loadedOnce;
    const showRefreshing = loading && loadedOnce;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-[90rem] space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Import review history</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Audit review uploads and promotion runs. Lists load the latest {limit} rows by default — open
                        a row for full detail.
                    </p>
                </header>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => switchTab("review")}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "review" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Review batches
                    </button>
                    <button
                        type="button"
                        onClick={() => switchTab("publish")}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "publish" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Promotion runs
                    </button>
                </div>

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-medium text-gray-600">
                        Status
                        <select
                            value={filters.status}
                            onChange={(e) => {
                                setFilters((f) => ({ ...f, status: e.target.value }));
                                setOffset(0);
                            }}
                            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                        >
                            <option value="">All statuses</option>
                            {statusOptions
                                .filter((s) => s !== "")
                                .map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-medium text-gray-600">
                        Entity family
                        <select
                            value={filters.entityFamily}
                            onChange={(e) => {
                                setFilters((f) => ({ ...f, entityFamily: e.target.value }));
                                setOffset(0);
                            }}
                            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                        >
                            {IMPORT_REVIEW_HISTORY_ENTITY_FAMILIES.map((f) => (
                                <option key={f || "all"} value={f}>
                                    {f ? f : "All families"}
                                </option>
                            ))}
                        </select>
                    </label>
                    {tab === "publish" ? (
                        <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-medium text-gray-600">
                            Review batch
                            <select
                                value={filters.reviewBatchId}
                                onChange={(e) => {
                                    setFilters((f) => ({ ...f, reviewBatchId: e.target.value }));
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                            >
                                <option value="">All review batches</option>
                                {reviewBatchOptions.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                        #{opt.id} — {opt.batch_name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    <button
                        type="button"
                        onClick={clearFilters}
                        disabled={!hasFilters}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-40"
                    >
                        Clear filters
                    </button>
                    {showRefreshing ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.refreshingHistory} />
                    ) : null}
                </div>

                {error ? (
                    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
                        <p className="text-sm text-red-950">{error}</p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="rounded-md bg-red-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                {showSkeleton ? (
                    <ImportReviewSkeletonTable
                        columnCount={tab === "review" ? 8 : 11}
                        message={IMPORT_REVIEW_LOADING.loadingHistory}
                    />
                ) : null}

                {!showSkeleton && !error && tab === "review" ? (
                    <ReviewBatchesTable items={reviewItems} />
                ) : null}

                {!showSkeleton && !error && tab === "publish" ? (
                    <PublishBatchesTable items={publishItems} onRefresh={() => void load()} />
                ) : null}

                {showEmpty ? (
                    <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                        {hasFilters
                            ? "No batches match the selected filters."
                            : "No batches found yet."}
                    </p>
                ) : null}

                {loadedOnce && !error ? (
                    <div className="flex items-center justify-between text-sm text-gray-600">
                        <span>
                            Showing {activeItems.length.toLocaleString()} of {total.toLocaleString()}
                            {filterLabel(filters.status, "") ? ` · status ${filters.status}` : ""}
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
                ) : null}
            </div>
        </main>
    );
}
