"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ImportTransportInlineSpinner from "@/src/features/import-transport/components/ImportTransportInlineSpinner";
import ImportTransportSkeletonCards from "@/src/features/import-transport/components/ImportTransportSkeletonCards";
import ImportTransportSkeletonTable from "@/src/features/import-transport/components/ImportTransportSkeletonTable";
import {
    ImportTransportCollapsibleJson,
    formatImportTransportHistoryDate,
    ImportTransportHistoryStatusBadge,
} from "@/src/features/import-transport/components/importTransportHistoryUi";
import {
    getImportTransportHistoryPromotionBatchById,
    getImportTransportHistoryPromotionBatchItems,
    getImportTransportHistoryPromotionBatchLogs,
    isAbortError,
} from "@/src/features/import-transport/api/importTransportApiClient";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import type {
    ImportTransportHistoryPromotionBatchDetail,
    ImportTransportHistoryPromotionBatchItem,
} from "@/src/features/import-transport/config/types";
import { getImportTransportEntityConfigByApiFamily } from "@/src/features/import-transport/config/importTransportEntityConfigs";
import {
    importTransportHistoryHref,
    importTransportHistoryImportBatchHref,
    importTransportPromotionBatchHref,
} from "@/src/features/import-transport/navigation/importTransportRoutes";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";

export default function ImportTransportHistoryPromotionBatchDetailClient() {
    const params = useParams();
    const id = typeof params.id === "string" ? params.id : "";
    const [data, setData] = useState<ImportTransportHistoryPromotionBatchDetail | null>(null);
    const [items, setItems] = useState<ImportTransportHistoryPromotionBatchItem[]>([]);
    const [logs, setLogs] = useState<
        Awaited<ReturnType<typeof getImportTransportHistoryPromotionBatchLogs>>["items"]
    >([]);
    const [itemsTotal, setItemsTotal] = useState(0);
    const [itemsOffset, setItemsOffset] = useState(0);
    const [statusFilter, setStatusFilter] = useState("");
    const [entityFilter, setEntityFilter] = useState("");
    const [validationFilter, setValidationFilter] = useState("");
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
            const [detail, logsResponse] = await Promise.all([
                getImportTransportHistoryPromotionBatchById(id, signal ? { signal } : undefined),
                getImportTransportHistoryPromotionBatchLogs(id, signal ? { signal } : undefined),
            ]);
            setData(detail);
            setLogs(logsResponse.items);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : "Failed to load promotion batch.");
                setData(null);
                setLogs([]);
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
            const res = await getImportTransportHistoryPromotionBatchItems(
                id,
                {
                    promotion_status: statusFilter || undefined,
                    entity_kind: entityFilter || undefined,
                    item_validation_status: validationFilter || undefined,
                    limit: itemsLimit,
                    offset: itemsOffset,
                },
                signal ? { signal } : undefined
            );
            setItems(res.items);
            setItemsTotal(res.total);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : IMPORT_TRANSPORT_LOADING.loadingHistoryItems);
            }
        } finally {
            setItemsLoading(false);
        }
    }, [id, statusFilter, entityFilter, validationFilter, itemsOffset]);

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
                    <Link
                        href={importTransportHistoryHref()}
                        prefetch={false}
                        className="font-medium text-blue-700 hover:underline"
                    >
                        ← History
                    </Link>
                </p>

                {loading ? (
                    <>
                        <ImportTransportLoadingBannerWithSpinner
                            message={IMPORT_TRANSPORT_LOADING.loadingHistoryBatch}
                        />
                        <ImportTransportSkeletonCards count={6} columns={3} />
                    </>
                ) : null}
                {error ? <ImportTransportErrorState message={error} /> : null}

                {data ? (
                    <>
                        <header className="border-b border-gray-200 pb-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">{data.batch_name}</h1>
                                    <p className="mt-1 font-mono text-sm text-gray-600">
                                        Promotion batch #{data.id}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-600">
                                        Import batch{" "}
                                        <Link
                                            href={importTransportHistoryImportBatchHref(data.import_batch_id)}
                                            prefetch={false}
                                            className="font-medium text-blue-700 hover:underline"
                                        >
                                            #{data.import_batch_id} · {data.import_batch_name}
                                        </Link>
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ImportTransportHistoryStatusBadge status={data.promotion_status} />
                                    <ImportTransportHistoryStatusBadge status={data.validation_status} />
                                </div>
                            </div>
                            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <dt className="text-gray-500">Mode</dt>
                                    <dd className="font-medium text-gray-900">{data.mode ?? "—"}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Entity family</dt>
                                    <dd>
                                        {data.mode === "one_entity" && data.entity_family
                                            ? data.entity_family
                                            : "—"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Include warnings</dt>
                                    <dd>{data.include_warnings ? "Yes" : "No"}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Target schema</dt>
                                    <dd>{data.target_schema}</dd>
                                </div>
                            </dl>
                        </header>

                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {[
                                ["Items", data.item_total],
                                ["Promoted", data.promoted_count],
                                ["Failed", data.failed_count],
                                ["Skipped", data.skipped_count],
                                ["Val. blocked", data.validation_blocked_count],
                                ["Val. warning", data.validation_warning_count],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="text-xs text-gray-500">{label}</div>
                                    <div className="text-lg font-semibold tabular-nums">
                                        {Number(value).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </section>

                        <section className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <h2 className="text-sm font-semibold text-gray-900">Source import batch</h2>
                                <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Dataset</dt>
                                        <dd>{data.source_import_batch.source_dataset.name}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Import status</dt>
                                        <dd>{data.source_import_batch.import_status}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Snapshot</dt>
                                        <dd>{data.source_import_batch.source_snapshot_version ?? "—"}</dd>
                                    </div>
                                </dl>
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
                                <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Created</dt>
                                        <dd>{formatImportTransportHistoryDate(data.created_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Updated</dt>
                                        <dd>{formatImportTransportHistoryDate(data.updated_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Validated</dt>
                                        <dd>{formatImportTransportHistoryDate(data.validated_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Promoted</dt>
                                        <dd>{formatImportTransportHistoryDate(data.promoted_at)}</dd>
                                    </div>
                                </dl>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Import batch entity counts</h2>
                            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                                {data.counts_by_entity.map((family) => {
                                    const cfg = getImportTransportEntityConfigByApiFamily(family.entity_family);
                                    return (
                                        <div
                                            key={family.entity_family}
                                            className="rounded-lg border border-gray-200 bg-white p-4 text-sm"
                                        >
                                            <h3 className="font-semibold text-gray-900">
                                                {cfg?.pluralLabel ?? family.entity_family}
                                            </h3>
                                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                                                <dt className="text-gray-500">Total</dt>
                                                <dd className="tabular-nums">{family.total.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Promoted</dt>
                                                <dd className="tabular-nums">{family.promoted.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Blocked</dt>
                                                <dd className="tabular-nums text-red-800">
                                                    {family.validation_blocked.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Warning</dt>
                                                <dd className="tabular-nums text-amber-800">
                                                    {family.validation_warning.toLocaleString()}
                                                </dd>
                                            </dl>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Stage logs</h2>
                            {logs.length === 0 ? (
                                <p className="mt-2 text-sm text-gray-600">No stage logs recorded.</p>
                            ) : (
                                <ol className="mt-3 space-y-2">
                                    {logs.map((log) => (
                                        <li
                                            key={log.id}
                                            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-gray-900">{log.stage_label}</span>
                                                <ImportTransportHistoryStatusBadge status={log.stage_status} />
                                                <span className="text-xs text-gray-500">
                                                    {formatImportTransportHistoryDate(log.started_at)}
                                                    {log.finished_at ? ` → ${formatImportTransportHistoryDate(log.finished_at)}` : ""}
                                                </span>
                                            </div>
                                            {log.message ? (
                                                <p className="mt-1 text-gray-700">{log.message}</p>
                                            ) : null}
                                            <ImportTransportCollapsibleJson label="Stage details" value={log.details} />
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </section>

                        <ImportTransportCollapsibleJson label="Item counts" value={data.item_counts} />
                        <ImportTransportCollapsibleJson label="Summary" value={data.summary} />

                        {data.error_message ? (
                            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                {data.error_message}
                            </p>
                        ) : null}

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Promotion items</h2>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <input
                                    type="text"
                                    placeholder="promotion_status"
                                    value={statusFilter}
                                    onChange={(e) => {
                                        setStatusFilter(e.target.value);
                                        setItemsOffset(0);
                                    }}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="entity_kind"
                                    value={entityFilter}
                                    onChange={(e) => {
                                        setEntityFilter(e.target.value);
                                        setItemsOffset(0);
                                    }}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="item_validation_status"
                                    value={validationFilter}
                                    onChange={(e) => {
                                        setValidationFilter(e.target.value);
                                        setItemsOffset(0);
                                    }}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                />
                            </div>
                            {itemsLoading && items.length === 0 ? (
                                <div className="mt-3">
                                    <ImportTransportInlineSpinner label={IMPORT_TRANSPORT_LOADING.loadingHistoryItems} />
                                    <ImportTransportSkeletonTable columnCount={7} rowCount={6} />
                                </div>
                            ) : (
                                <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                                            <tr>
                                                <th className="px-3 py-2">Entity</th>
                                                <th className="px-3 py-2">Promotion</th>
                                                <th className="px-3 py-2">Validation</th>
                                                <th className="px-3 py-2">Candidate ID</th>
                                                <th className="px-3 py-2">Core ID</th>
                                                <th className="px-3 py-2">Match</th>
                                                <th className="px-3 py-2">Error</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {items.map((item) => (
                                                <tr key={item.id}>
                                                    <td className="px-3 py-2">{item.entity_kind}</td>
                                                    <td className="px-3 py-2">
                                                        <ImportTransportHistoryStatusBadge status={item.promotion_status} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <ImportTransportHistoryStatusBadge status={item.item_validation_status} />
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs">
                                                        {item.raw_entity_id}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs">
                                                        {item.promoted_core_id ??
                                                            item.promoted_target_id ??
                                                            "—"}
                                                    </td>
                                                    <td className="px-3 py-2">{item.match_status}</td>
                                                    <td
                                                        className="px-3 py-2 max-w-xs truncate text-red-800"
                                                        title={item.error_message ?? undefined}
                                                    >
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
                                    <ImportTransportInlineSpinner label={IMPORT_TRANSPORT_LOADING.loadingHistoryItems} />
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

                        <p className="text-sm text-gray-600">
                            <Link
                                href={importTransportPromotionBatchHref(id)}
                                prefetch={false}
                                className="font-medium text-blue-700 hover:underline"
                            >
                                Open operational promotion batch page
                            </Link>
                        </p>
                    </>
                ) : null}
            </div>
        </main>
    );
}
