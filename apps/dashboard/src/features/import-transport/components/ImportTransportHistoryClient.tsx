"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ImportTransportInlineSpinner from "@/src/features/import-transport/components/ImportTransportInlineSpinner";
import ImportTransportSkeletonTable from "@/src/features/import-transport/components/ImportTransportSkeletonTable";
import { ImportTransportStatusBanner } from "@/src/features/import-transport/components/ImportTransportStatusBanner";
import {
    formatImportTransportHistoryDate,
    ImportTransportHistoryStatusBadge,
} from "@/src/features/import-transport/components/importTransportHistoryUi";
import {
    getImportTransportHistoryImportBatches,
    getImportTransportHistoryPromotionBatches,
    isAbortError,
} from "@/src/features/import-transport/api/importTransportApiClient";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import type {
    ImportTransportHistoryImportBatchListItem,
    ImportTransportHistoryPromotionBatchListItem,
} from "@/src/features/import-transport/config/types";
import {
    importTransportHistoryImportBatchHref,
    importTransportHistoryPromotionBatchHref,
} from "@/src/features/import-transport/navigation/importTransportRoutes";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";

type Tab = "import" | "promotion";

function ImportBatchTable({ items }: { items: ImportTransportHistoryImportBatchListItem[] }) {
    if (items.length === 0) {
        return (
            <ImportTransportStatusBanner message="No import batches match the filters." tone="info" compact />
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Dataset</th>
                        <th className="px-4 py-3">Snapshot</th>
                        <th className="px-4 py-3">Import</th>
                        <th className="px-4 py-3">Validation</th>
                        <th className="px-4 py-3">Imported</th>
                        <th className="px-4 py-3">Total</th>
                        <th className="px-4 py-3">Blocked</th>
                        <th className="px-4 py-3">Promotions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                                <Link
                                    href={importTransportHistoryImportBatchHref(row.id)}
                                    prefetch={false}
                                    className="font-medium text-blue-700 hover:underline"
                                >
                                    {row.batch_name}
                                </Link>
                                <div className="font-mono text-xs text-gray-500">#{row.id}</div>
                            </td>
                            <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{row.source_dataset.name}</div>
                                <div className="text-xs text-gray-500">{row.source_dataset.code}</div>
                            </td>
                            <td
                                className="px-4 py-3 max-w-[12rem] truncate text-gray-700"
                                title={row.source_snapshot_version ?? undefined}
                            >
                                {row.source_snapshot_version ?? "—"}
                            </td>
                            <td className="px-4 py-3">
                                <ImportTransportHistoryStatusBadge status={row.import_status} />
                            </td>
                            <td className="px-4 py-3">
                                <ImportTransportHistoryStatusBadge status={row.validation_status} />
                            </td>
                            <td className="px-4 py-3 text-gray-700">{formatImportTransportHistoryDate(row.imported_at)}</td>
                            <td className="px-4 py-3 tabular-nums">{row.total_candidates.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums text-red-800">
                                {row.validation.candidate_blocked_count.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-gray-700">
                                {row.promotion_batches.promotion_batch_count} batches
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PromotionBatchTable({ items }: { items: ImportTransportHistoryPromotionBatchListItem[] }) {
    if (items.length === 0) {
        return (
            <ImportTransportStatusBanner message="No promotion batches match the filters." tone="info" compact />
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Import batch</th>
                        <th className="px-4 py-3">Mode</th>
                        <th className="px-4 py-3">Promotion</th>
                        <th className="px-4 py-3">Validation</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3">Items</th>
                        <th className="px-4 py-3">Promoted</th>
                        <th className="px-4 py-3">Failed</th>
                        <th className="px-4 py-3">Skipped</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                                <Link
                                    href={importTransportHistoryPromotionBatchHref(row.id)}
                                    prefetch={false}
                                    className="font-medium text-blue-700 hover:underline"
                                >
                                    {row.batch_name}
                                </Link>
                                <div className="font-mono text-xs text-gray-500">#{row.id}</div>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                                <Link
                                    href={importTransportHistoryImportBatchHref(row.import_batch_id)}
                                    prefetch={false}
                                    className="text-blue-700 hover:underline"
                                >
                                    #{row.import_batch_id}
                                </Link>
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                                {row.mode ?? "—"}
                                {row.mode === "one_entity" && row.entity_family ? (
                                    <div className="text-xs text-gray-500">{row.entity_family}</div>
                                ) : null}
                            </td>
                            <td className="px-4 py-3">
                                <ImportTransportHistoryStatusBadge status={row.promotion_status} />
                            </td>
                            <td className="px-4 py-3">
                                <ImportTransportHistoryStatusBadge status={row.validation_status} />
                            </td>
                            <td className="px-4 py-3 text-gray-700">{formatImportTransportHistoryDate(row.created_at)}</td>
                            <td className="px-4 py-3 tabular-nums">{row.item_total.toLocaleString()}</td>
                            <td className="px-4 py-3 tabular-nums text-emerald-800">
                                {row.promoted_count.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-red-800">
                                {row.failed_count.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-gray-700">
                                {row.skipped_count.toLocaleString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ImportTransportHistoryClient() {
    const [tab, setTab] = useState<Tab>("import");
    const [importStatusFilter, setImportStatusFilter] = useState("");
    const [validationStatusFilter, setValidationStatusFilter] = useState("");
    const [snapshotFilter, setSnapshotFilter] = useState("");
    const [datasetFilter, setDatasetFilter] = useState("");
    const [promotionStatusFilter, setPromotionStatusFilter] = useState("");
    const [importBatchFilter, setImportBatchFilter] = useState("");
    const [modeFilter, setModeFilter] = useState("");
    const [entityFilter, setEntityFilter] = useState("");
    const [importItems, setImportItems] = useState<ImportTransportHistoryImportBatchListItem[]>([]);
    const [promotionItems, setPromotionItems] = useState<ImportTransportHistoryPromotionBatchListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const limit = 25;

    const activeItems = tab === "import" ? importItems : promotionItems;
    const isInitialLoad = loading && activeItems.length === 0;
    const isRefreshing = loading && activeItems.length > 0;

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            if (tab === "import") {
                const data = await getImportTransportHistoryImportBatches(
                    {
                        import_status: importStatusFilter || undefined,
                        validation_status: validationStatusFilter || undefined,
                        source_snapshot_version: snapshotFilter || undefined,
                        source_dataset_code: datasetFilter || undefined,
                        limit,
                        offset,
                    },
                    signal ? { signal } : undefined
                );
                setImportItems(data.items);
                setTotal(data.total);
            } else {
                const data = await getImportTransportHistoryPromotionBatches(
                    {
                        import_batch_id: importBatchFilter || undefined,
                        promotion_status: promotionStatusFilter || undefined,
                        validation_status: validationStatusFilter || undefined,
                        mode:
                            modeFilter === "one_entity" || modeFilter === "all_entities"
                                ? modeFilter
                                : undefined,
                        entity_family: entityFilter || undefined,
                        limit,
                        offset,
                    },
                    signal ? { signal } : undefined
                );
                setPromotionItems(data.items);
                setTotal(data.total);
            }
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : "Failed to load transport history.");
            }
        } finally {
            setLoading(false);
        }
    }, [
        tab,
        importStatusFilter,
        validationStatusFilter,
        snapshotFilter,
        datasetFilter,
        promotionStatusFilter,
        importBatchFilter,
        modeFilter,
        entityFilter,
        offset,
    ]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Import transport history</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Read-only audit of transport import batches, promotion batches, entity counts, validation
                        summaries, and stage logs.
                    </p>
                </header>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setTab("import");
                            setOffset(0);
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "import" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Import batches
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setTab("promotion");
                            setOffset(0);
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                            tab === "promotion" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                        }`}
                    >
                        Promotion batches
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    {tab === "import" ? (
                        <>
                            <input
                                type="text"
                                placeholder="Import status"
                                value={importStatusFilter}
                                onChange={(e) => {
                                    setImportStatusFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <input
                                type="text"
                                placeholder="Validation status"
                                value={validationStatusFilter}
                                onChange={(e) => {
                                    setValidationStatusFilter(e.target.value);
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
                                placeholder="Dataset code"
                                value={datasetFilter}
                                onChange={(e) => {
                                    setDatasetFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </>
                    ) : (
                        <>
                            <input
                                type="text"
                                placeholder="Import batch ID"
                                value={importBatchFilter}
                                onChange={(e) => {
                                    setImportBatchFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                            />
                            <input
                                type="text"
                                placeholder="Promotion status"
                                value={promotionStatusFilter}
                                onChange={(e) => {
                                    setPromotionStatusFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <input
                                type="text"
                                placeholder="Validation status"
                                value={validationStatusFilter}
                                onChange={(e) => {
                                    setValidationStatusFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                            <select
                                value={modeFilter}
                                onChange={(e) => {
                                    setModeFilter(e.target.value);
                                    setOffset(0);
                                }}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="">All modes</option>
                                <option value="one_entity">one_entity</option>
                                <option value="all_entities">all_entities</option>
                            </select>
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
                        </>
                    )}
                </div>

                {error ? <ImportTransportErrorState message={error} /> : null}

                {isRefreshing ? (
                    <div className="flex justify-end">
                        <ImportTransportInlineSpinner label={IMPORT_TRANSPORT_LOADING.loadingHistory} />
                    </div>
                ) : null}

                {isInitialLoad ? (
                    <ImportTransportSkeletonTable
                        columnCount={tab === "import" ? 9 : 10}
                        message={IMPORT_TRANSPORT_LOADING.loadingHistory}
                    />
                ) : tab === "import" ? (
                    <ImportBatchTable items={importItems} />
                ) : (
                    <PromotionBatchTable items={promotionItems} />
                )}

                <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>
                        Showing {activeItems.length} of {total}
                        {loading ? ` · ${IMPORT_TRANSPORT_LOADING.loadingHistory}` : ""}
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
