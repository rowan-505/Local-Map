"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportTransportPromotionBatchById,
    getImportTransportPromotionBatchLogs,
    getImportTransportPromotionBatchProgress,
    isAbortError,
    postImportTransportPromotionBatchPromote,
    postImportTransportPromotionBatchValidate,
} from "@/src/features/import-transport/api/importTransportApiClient";
import { formatImportTransportApiError } from "@/src/features/import-transport/api/importTransportApiErrors";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import ImportTransportStatusBadge from "@/src/features/import-transport/components/ImportTransportStatusBadge";
import type {
    ImportTransportPromotionBatchDetail,
    ImportTransportPromotionBatchProgress,
    ImportTransportPromotionBatchPromoteResult,
    ImportTransportPromotionStageLog,
} from "@/src/features/import-transport/config/types";
import { importTransportPath } from "@/src/lib/dashboardPaths";

function EntitySummaryTable({
    rows,
}: {
    rows: ImportTransportPromotionBatchProgress["by_entity"];
}) {
    if (rows.length === 0) {
        return <p className="text-sm text-gray-500">No entity summary yet. Run validation first.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                        <th className="px-3 py-2">Entity family</th>
                        <th className="px-3 py-2">Valid</th>
                        <th className="px-3 py-2">Warning</th>
                        <th className="px-3 py-2">Blocked</th>
                        <th className="px-3 py-2">Skipped</th>
                        <th className="px-3 py-2">Pending</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.entity_family} className="border-b border-gray-100">
                            <td className="px-3 py-2 font-medium">{row.entity_family}</td>
                            <td className="px-3 py-2 tabular-nums">{row.valid}</td>
                            <td className="px-3 py-2 tabular-nums">{row.warning}</td>
                            <td className="px-3 py-2 tabular-nums">{row.blocked}</td>
                            <td className="px-3 py-2 tabular-nums">{row.skipped}</td>
                            <td className="px-3 py-2 tabular-nums">{row.pending}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function StageProgressList({ stages }: { stages: ImportTransportPromotionStageLog[] }) {
    if (stages.length === 0) {
        return <p className="text-sm text-gray-500">No stage logs yet.</p>;
    }

    return (
        <ul className="space-y-3">
            {stages.map((stage) => (
                <li key={stage.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="font-medium text-gray-900">{stage.stage_label}</p>
                            <p className="font-mono text-xs text-gray-500">{stage.stage_key}</p>
                        </div>
                        <ImportTransportStatusBadge value={stage.stage_status} />
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full rounded-full bg-emerald-600 transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, stage.progress_percent))}%` }}
                        />
                    </div>
                    {stage.message ? <p className="mt-2 text-sm text-gray-600">{stage.message}</p> : null}
                </li>
            ))}
        </ul>
    );
}

export default function ImportTransportPromotionBatchPage({ batchId }: { batchId: string }) {
    const [batch, setBatch] = useState<ImportTransportPromotionBatchDetail | null>(null);
    const [progress, setProgress] = useState<ImportTransportPromotionBatchProgress | null>(null);
    const [logs, setLogs] = useState<ImportTransportPromotionStageLog[]>([]);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [validating, setValidating] = useState(false);
    const [promoting, setPromoting] = useState(false);
    const [confirmWarnings, setConfirmWarnings] = useState(false);
    const [reviewNote, setReviewNote] = useState("");
    const [promoteResult, setPromoteResult] = useState<ImportTransportPromotionBatchPromoteResult | null>(
        null
    );

    const loadAll = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const [detail, progressResult, logsResult] = await Promise.all([
                    getImportTransportPromotionBatchById(batchId, { signal }),
                    getImportTransportPromotionBatchProgress(batchId, { signal }),
                    getImportTransportPromotionBatchLogs(batchId, { signal }),
                ]);
                setBatch(detail);
                setProgress(progressResult);
                setLogs(logsResult.items);
            } catch (err) {
                if (!isAbortError(err)) {
                    setBatch(null);
                    setProgress(null);
                    setLogs([]);
                    setError(formatImportTransportApiError(err, "Failed to load promotion batch."));
                }
            } finally {
                setLoading(false);
            }
        },
        [batchId]
    );

    useEffect(() => {
        const controller = new AbortController();
        void loadAll(controller.signal);
        return () => controller.abort();
    }, [loadAll]);

    async function handleValidate() {
        setValidating(true);
        setError("");
        setActionMessage("");
        try {
            const result = await postImportTransportPromotionBatchValidate(batchId);
            setProgress(result);
            setLogs(result.stages);
            setActionMessage(result.message);
            const detail = await getImportTransportPromotionBatchById(batchId);
            setBatch(detail);
        } catch (err) {
            setError(formatImportTransportApiError(err, "Validation failed."));
        } finally {
            setValidating(false);
        }
    }

    async function handlePromote() {
        setPromoting(true);
        setError("");
        setActionMessage("");
        try {
            const result = await postImportTransportPromotionBatchPromote(batchId, {
                confirm_warnings: confirmWarnings,
                review_note: reviewNote.trim() || null,
            });
            setPromoteResult(result);
            setActionMessage(result.message);
            await loadAll();
        } catch (err) {
            setError(formatImportTransportApiError(err, "Promotion failed."));
        } finally {
            setPromoting(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen bg-gray-50 p-6">
                <ImportTransportLoadingBannerWithSpinner message="Loading promotion batch…" />
            </main>
        );
    }

    if (!batch) {
        return (
            <main className="min-h-screen bg-gray-50 p-6">
                <ImportTransportErrorState message={error || "Promotion batch not found."} />
            </main>
        );
    }

    const summary = batch.summary ?? {};
    const itemCounts = batch.item_counts ?? {};
    const progressPercent = progress?.validation_percent ?? batch.validation_percent ?? 0;
    const warningCount =
        progress?.by_entity.reduce((sum, row) => sum + row.warning, 0) ??
        batch.items.filter((item) => item.item_validation_status === "warning").length;
    const promotionSummary =
        promoteResult ??
        (typeof batch.summary?.promotion_result === "object" && batch.summary.promotion_result != null
            ? ({
                  promoted: Number((batch.summary.promotion_result as Record<string, unknown>).promoted ?? 0),
                  failed: Number((batch.summary.promotion_result as Record<string, unknown>).failed ?? 0),
                  skipped: Number((batch.summary.promotion_result as Record<string, unknown>).skipped ?? 0),
              } as Pick<ImportTransportPromotionBatchPromoteResult, "promoted" | "failed" | "skipped">)
            : null);

    return (
        <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="mx-auto max-w-5xl space-y-6">
                <header className="border-b border-gray-200 pb-6">
                    <Link
                        href={importTransportPath("promotion")}
                        className="text-sm text-gray-600 underline-offset-2 hover:underline"
                    >
                        ← Promotion batches
                    </Link>
                    <h1 className="mt-2 text-2xl font-bold text-gray-900">{batch.batch_name}</h1>
                    <p className="mt-1 font-mono text-sm text-gray-500">Batch #{batch.id}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <ImportTransportStatusBadge value={batch.promotion_status} />
                        <ImportTransportStatusBadge value={batch.validation_status} />
                        {batch.can_promote ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                                Can promote
                            </span>
                        ) : (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                                Not promotable
                            </span>
                        )}
                    </div>
                </header>

                <ImportTransportErrorState message={error} />
                {actionMessage ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        {actionMessage}
                    </div>
                ) : null}

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Validation</h2>
                                <p className="text-sm text-gray-600">
                                    Run staged validation before promotion. Warnings require confirmation during
                                    promote.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleValidate()}
                                disabled={validating}
                                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {validating ? "Validating…" : "Validate batch"}
                            </button>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs text-gray-600">
                                <span>
                                    {progress?.validation_done ?? batch.validation_done ?? 0} /{" "}
                                    {progress?.validation_total ?? batch.validation_total ?? 0} items
                                </span>
                                <span>{Math.round(progressPercent)}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                                <div
                                    className="h-full rounded-full bg-blue-600 transition-all"
                                    style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Promotion</h2>
                                <p className="text-sm text-gray-600">
                                    Promote validated items into core_transport. Each item runs in its own
                                    transaction.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handlePromote()}
                                disabled={promoting || !batch.can_promote}
                                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {promoting ? "Promoting…" : "Promote batch"}
                            </button>
                        </div>

                        {warningCount > 0 ? (
                            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                                <p className="text-sm text-amber-900">
                                    This batch has {warningCount} warning item(s). Confirm warnings and add a
                                    review note before promotion.
                                </p>
                                <label className="flex items-center gap-2 text-sm text-amber-950">
                                    <input
                                        type="checkbox"
                                        checked={confirmWarnings}
                                        onChange={(event) => setConfirmWarnings(event.target.checked)}
                                    />
                                    I confirm promoting items with validation warnings.
                                </label>
                                <div>
                                    <label
                                        htmlFor="promotion-review-note"
                                        className="mb-1 block text-xs font-semibold uppercase text-amber-900"
                                    >
                                        Review note
                                    </label>
                                    <textarea
                                        id="promotion-review-note"
                                        value={reviewNote}
                                        onChange={(event) => setReviewNote(event.target.value)}
                                        rows={3}
                                        className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                                        placeholder="Explain why warnings are acceptable for this promotion."
                                    />
                                </div>
                            </div>
                        ) : null}

                        {promotionSummary ? (
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <p className="text-xs uppercase text-gray-500">Promoted</p>
                                    <p className="text-2xl font-semibold tabular-nums text-emerald-700">
                                        {promotionSummary.promoted}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <p className="text-xs uppercase text-gray-500">Failed</p>
                                    <p className="text-2xl font-semibold tabular-nums text-red-700">
                                        {promotionSummary.failed}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <p className="text-xs uppercase text-gray-500">Skipped</p>
                                    <p className="text-2xl font-semibold tabular-nums text-gray-700">
                                        {promotionSummary.skipped}
                                    </p>
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="p-5">
                        <h2 className="text-lg font-semibold text-gray-900">Stage progress</h2>
                        <div className="mt-4">
                            <StageProgressList stages={progress?.stages ?? logs} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="p-5">
                        <h2 className="text-lg font-semibold text-gray-900">Per-entity summary</h2>
                        <div className="mt-4">
                            <EntitySummaryTable rows={progress?.by_entity ?? []} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Import batch</p>
                            <p className="font-mono text-sm">{batch.import_batch_id}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Mode</p>
                            <p className="text-sm">{String(summary.mode ?? "—")}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Entity family</p>
                            <p className="text-sm">{String(summary.entity_family ?? "all")}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Include warnings</p>
                            <p className="text-sm">{summary.include_warnings ? "Yes" : "No"}</p>
                        </div>
                        <div className="sm:col-span-2">
                            <p className="text-xs font-semibold uppercase text-gray-500">Item counts</p>
                            <pre className="mt-1 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                                {JSON.stringify(itemCounts, null, 2)}
                            </pre>
                        </div>
                    </CardContent>
                </Card>

                <Card className="overflow-hidden border-gray-200 shadow-sm">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2">Entity kind</th>
                                        <th className="px-3 py-2">Raw entity id</th>
                                        <th className="px-3 py-2">Validation</th>
                                        <th className="px-3 py-2">Promotion</th>
                                        <th className="px-3 py-2">Core id</th>
                                        <th className="px-3 py-2">Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batch.items.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                                                No promotion items.
                                            </td>
                                        </tr>
                                    ) : (
                                        batch.items.map((item) => (
                                            <tr key={item.id} className="border-b border-gray-100">
                                                <td className="px-3 py-2 font-mono text-xs">{item.entity_kind}</td>
                                                <td className="px-3 py-2 font-mono text-xs">{item.raw_entity_id}</td>
                                                <td className="px-3 py-2">
                                                    <ImportTransportStatusBadge
                                                        value={item.item_validation_status ?? "pending"}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <ImportTransportStatusBadge value={item.promotion_status} />
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs">
                                                    {item.promoted_target_id ?? "—"}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-600">
                                                    {item.error_message ?? "—"}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}
