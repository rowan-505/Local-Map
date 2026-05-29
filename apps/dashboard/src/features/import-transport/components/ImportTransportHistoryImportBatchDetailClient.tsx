"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ImportTransportSkeletonCards from "@/src/features/import-transport/components/ImportTransportSkeletonCards";
import {
    ImportTransportCollapsibleJson,
    formatImportTransportHistoryDate,
    ImportTransportHistoryStatusBadge,
} from "@/src/features/import-transport/components/importTransportHistoryUi";
import {
    getImportTransportHistoryImportBatchById,
    isAbortError,
} from "@/src/features/import-transport/api/importTransportApiClient";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import type { ImportTransportHistoryImportBatchDetail } from "@/src/features/import-transport/config/types";
import { getImportTransportEntityConfigByApiFamily } from "@/src/features/import-transport/config/importTransportEntityConfigs";
import {
    importTransportHistoryHref,
    importTransportHistoryPromotionBatchHref,
} from "@/src/features/import-transport/navigation/importTransportRoutes";
import { importTransportPath } from "@/src/lib/dashboardPaths";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";

export default function ImportTransportHistoryImportBatchDetailClient() {
    const params = useParams();
    const id = typeof params.id === "string" ? params.id : "";
    const [data, setData] = useState<ImportTransportHistoryImportBatchDetail | null>(null);
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
            setData(await getImportTransportHistoryImportBatchById(id, signal ? { signal } : undefined));
        } catch (err) {
            if (!isAbortError(err)) {
                setError(err instanceof Error ? err.message : "Failed to load import batch.");
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
                                    <p className="mt-1 font-mono text-sm text-gray-600">Import batch #{data.id}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ImportTransportHistoryStatusBadge status={data.import_status} />
                                    <ImportTransportHistoryStatusBadge status={data.validation_status} />
                                </div>
                            </div>
                            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <dt className="text-gray-500">Dataset</dt>
                                    <dd className="font-medium text-gray-900">
                                        {data.source_dataset.name}
                                        <span className="ml-1 font-normal text-gray-500">
                                            ({data.source_dataset.code})
                                        </span>
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Snapshot</dt>
                                    <dd>{data.source_snapshot_version ?? "—"}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Imported</dt>
                                    <dd>{formatImportTransportHistoryDate(data.imported_at)}</dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Validated</dt>
                                    <dd>{formatImportTransportHistoryDate(data.validated_at)}</dd>
                                </div>
                            </dl>
                        </header>

                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                            {[
                                ["Total candidates", data.total_candidates],
                                ["Issue blocked", data.validation.issue_blocked_count],
                                ["Issue warning", data.validation.issue_warning_count],
                                ["Candidate blocked", data.validation.candidate_blocked_count],
                                ["Candidate warning", data.validation.candidate_warning_count],
                                ["Promotion batches", data.promotion_batches.promotion_batch_count],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="text-xs text-gray-500">{label}</div>
                                    <div className="text-lg font-semibold tabular-nums">
                                        {Number(value).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </section>

                        <section>
                            <h2 className="text-lg font-semibold text-gray-900">Entity breakdown</h2>
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
                                                <dt className="text-gray-500">Pending review</dt>
                                                <dd className="tabular-nums">
                                                    {family.pending_review.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Approved</dt>
                                                <dd className="tabular-nums">{family.approved.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Promoted</dt>
                                                <dd className="tabular-nums">{family.promoted.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Validation blocked</dt>
                                                <dd className="tabular-nums text-red-800">
                                                    {family.validation_blocked.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Validation warning</dt>
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
                            <h2 className="text-lg font-semibold text-gray-900">Promotion batch attempts</h2>
                            {data.promotion_batch_summaries.length === 0 ? (
                                <p className="mt-2 text-sm text-gray-600">No promotion batches linked yet.</p>
                            ) : (
                                <ul className="mt-3 space-y-2">
                                    {data.promotion_batch_summaries.map((pb) => (
                                        <li
                                            key={pb.id}
                                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                                        >
                                            <div>
                                                <Link
                                                    href={importTransportHistoryPromotionBatchHref(pb.id)}
                                                    prefetch={false}
                                                    className="font-medium text-blue-700 hover:underline"
                                                >
                                                    {pb.batch_name}
                                                </Link>
                                                <span className="ml-2 font-mono text-xs text-gray-500">#{pb.id}</span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <ImportTransportHistoryStatusBadge status={pb.promotion_status} />
                                                <span className="text-xs text-gray-500">
                                                    promoted {pb.promoted_count} · failed {pb.failed_count} · skipped{" "}
                                                    {pb.skipped_count}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {formatImportTransportHistoryDate(pb.promoted_at)}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-200 bg-white p-4">
                                <h2 className="text-sm font-semibold text-gray-900">Source file</h2>
                                <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">File name</dt>
                                        <dd>{data.source_file_name ?? "—"}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Checksum</dt>
                                        <dd className="max-w-xs truncate font-mono text-xs">
                                            {data.source_file_checksum ?? "—"}
                                        </dd>
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
                                        <dt className="text-gray-500">Latest promotion validated</dt>
                                        <dd>{formatImportTransportHistoryDate(data.promotion_batches.latest_validated_at)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-gray-500">Latest promoted</dt>
                                        <dd>{formatImportTransportHistoryDate(data.promotion_batches.latest_promoted_at)}</dd>
                                    </div>
                                </dl>
                            </div>
                        </section>

                        {data.error_message ? (
                            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                {data.error_message}
                            </p>
                        ) : null}

                        <ImportTransportCollapsibleJson label="Record counts" value={data.record_counts} />
                        <ImportTransportCollapsibleJson label="Summary" value={data.summary} />

                        <p className="text-sm text-gray-600">
                            <Link
                                href={importTransportPath(`?import_batch_id=${data.id}`)}
                                prefetch={false}
                                className="font-medium text-blue-700 hover:underline"
                            >
                                Open import transport overview for this batch
                            </Link>
                        </p>
                    </>
                ) : null}
            </div>
        </main>
    );
}
