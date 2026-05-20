"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PromotionStatusBadge } from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewOperationLogPanel from "@/src/features/import-review/components/ImportReviewOperationLogPanel";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    canValidateImportReviewPublishBatch,
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    isAbortError,
    postImportReviewPromotionBatchValidate,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchEntityValidationCounts,
    type ImportReviewPublishBatchLogsResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishStageLogItem,
} from "@/src/lib/api";

const POLL_MS = 1500;

const STAGE_ORDER = [
    "load_batch",
    "load_items",
    "group_by_entity",
    "validate_candidate_state",
    "validate_geometry",
    "validate_required_fields",
    "validate_references",
    "validate_duplicates",
    "validate_entity_specific_rules",
    "write_validation_summary",
] as const;

function stageStatusColor(status: string): string {
    switch (status) {
        case "success":
            return "text-emerald-700 bg-emerald-50";
        case "warning":
            return "text-amber-800 bg-amber-50";
        case "failed":
            return "text-red-800 bg-red-50";
        case "running":
            return "text-blue-800 bg-blue-50";
        case "skipped":
            return "text-gray-600 bg-gray-100";
        default:
            return "text-gray-500 bg-gray-50";
    }
}

function sortLogs(items: ImportReviewPublishStageLogItem[]): ImportReviewPublishStageLogItem[] {
    const order = new Map(STAGE_ORDER.map((k, i) => [k, i]));
    return [...items].sort((a, b) => {
        const ia = order.get(a.stage_key as (typeof STAGE_ORDER)[number]) ?? 99;
        const ib = order.get(b.stage_key as (typeof STAGE_ORDER)[number]) ?? 99;
        if (ia !== ib) {
            return ia - ib;
        }
        return a.started_at.localeCompare(b.started_at);
    });
}

function formatStageLogDetails(details: unknown): string | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const d = details as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof d.entity_family === "string") {
        parts.push(d.entity_family);
    }
    const counts = d.counts;
    if (counts && typeof counts === "object" && !Array.isArray(counts)) {
        const c = counts as Record<string, unknown>;
        parts.push(
            `valid ${Number(c.valid ?? 0)}, warning ${Number(c.warning ?? 0)}, blocked ${Number(c.blocked ?? 0)}`
        );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

type Props = {
    batchId: string;
    batchStatus: string;
    onBatchUpdated: (detail: ImportReviewPublishBatchDetail) => void;
    formatError: (err: unknown) => string;
};

export default function ImportReviewPromotionValidationPanel({
    batchId,
    batchStatus,
    onBatchUpdated,
    formatError,
}: Props) {
    const [status, setStatus] = useState(batchStatus);
    const [progress, setProgress] = useState<ImportReviewPublishBatchProgressResponse | null>(null);
    const [logs, setLogs] = useState<ImportReviewPublishBatchLogsResponse | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const refreshBatchDetail = useCallback(async () => {
        const detail = await getImportReviewPromotionBatchById(batchId);
        setStatus(detail.status);
        onBatchUpdated(detail);
    }, [batchId, onBatchUpdated]);

    const pollOnce = useCallback(async () => {
        const [p, l] = await Promise.all([
            getImportReviewPromotionBatchProgress(batchId),
            getImportReviewPromotionBatchLogs(batchId),
        ]);
        setProgress(p);
        setLogs(l);
        setStatus(p.status);
        if (p.status !== "validating") {
            stopPolling();
            await refreshBatchDetail();
        }
    }, [batchId, refreshBatchDetail, stopPolling]);

    const startPolling = useCallback(() => {
        stopPolling();
        void pollOnce();
        pollRef.current = setInterval(() => {
            void pollOnce().catch((err) => {
                if (!isAbortError(err)) {
                    setError(formatError(err));
                    stopPolling();
                }
            });
        }, POLL_MS);
    }, [pollOnce, stopPolling, formatError]);

    const hydrateProgress = useCallback(async (signal?: AbortSignal) => {
        try {
            const [p, l] = await Promise.all([
                getImportReviewPromotionBatchProgress(batchId, signal ? { signal } : undefined),
                getImportReviewPromotionBatchLogs(batchId, signal ? { signal } : undefined),
            ]);
            setProgress(p);
            setLogs(l);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(formatError(err));
            }
        }
    }, [batchId, formatError]);

    useEffect(() => {
        setStatus(batchStatus);
    }, [batchStatus]);

    useEffect(() => {
        const controller = new AbortController();
        void hydrateProgress(controller.signal);
        return () => controller.abort();
    }, [hydrateProgress]);

    useEffect(() => {
        if (status === "validating") {
            startPolling();
        }
        return () => stopPolling();
    }, [status, startPolling, stopPolling]);

    async function handleValidate() {
        setError(null);
        setIsStarting(true);
        try {
            await postImportReviewPromotionBatchValidate(batchId);
            setStatus("validating");
            startPolling();
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsStarting(false);
        }
    }

    const canValidate = canValidateImportReviewPublishBatch(status);
    const isValidating = status === "validating" || isStarting;
    const percent = progress?.validation_percent ?? 0;
    const result = progress?.validation_result;
    const summaryMessage = progress?.validation_logs_summary ?? progress?.current_message;
    const entityRows = result?.by_entity ? Object.entries(result.by_entity).sort(([a], [b]) => a.localeCompare(b)) : [];

    return (
        <div className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => void handleValidate()}
                    disabled={!canValidate || isValidating}
                    className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                    {isValidating ? IMPORT_REVIEW_LOADING.validating : "Validate batch"}
                </button>
                <PromotionStatusBadge value={status} />
                {isValidating ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.validating} />
                ) : null}
            </div>

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}

            {(isValidating || progress) && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>
                            {progress?.current_stage_label ?? "Validation"}
                            {progress?.current_entity_family
                                ? ` · ${progress.current_entity_family}`
                                : ""}
                            {progress?.current_message ? ` — ${progress.current_message}` : ""}
                        </span>
                        <span className="tabular-nums font-medium">{percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full bg-indigo-600 transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                        />
                    </div>
                    {progress && progress.validation_total > 0 ? (
                        <p className="text-xs text-gray-500">
                            Items processed: {progress.validation_done.toLocaleString()} /{" "}
                            {progress.validation_total.toLocaleString()}
                        </p>
                    ) : null}
                </div>
            )}

            {result ? (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <CountCard label="Total items" value={result.total_items} />
                        <CountCard label="Valid" value={result.valid_count} tone="success" />
                        <CountCard label="Warnings" value={result.warning_count} tone="warning" />
                        <CountCard label="Blocked / errors" value={result.blocked_count} tone="error" />
                        <CountCard label="Skipped" value={result.skipped_count} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <CountCard label="Insert" value={result.by_publish_action.insert} />
                        <CountCard label="Update" value={result.by_publish_action.update} />
                        <CountCard label="Merge" value={result.by_publish_action.merge} />
                    </div>
                </>
            ) : null}

            {result?.requires_warning_confirmation && !isValidating ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Validation passed with {result.warning_count.toLocaleString()} warning
                    {result.warning_count === 1 ? "" : "s"}. Confirmation is required before promotion.
                </p>
            ) : null}

            {summaryMessage && !isValidating ? (
                <p
                    className={`rounded-md border px-3 py-2 text-sm ${
                        result?.outcome === "blocked"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-emerald-200 bg-emerald-50 text-emerald-900"
                    }`}
                >
                    {summaryMessage}
                </p>
            ) : null}

            {entityRows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-3 py-2 font-semibold">Entity family</th>
                                <th className="px-3 py-2 font-semibold text-right">Total</th>
                                <th className="px-3 py-2 font-semibold text-right">Valid</th>
                                <th className="px-3 py-2 font-semibold text-right">Warning</th>
                                <th className="px-3 py-2 font-semibold text-right">Blocked</th>
                                <th className="px-3 py-2 font-semibold text-right">Skipped</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {entityRows.map(([family, counts]) => (
                                <EntityBreakdownRow key={family} family={family} counts={counts} />
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            {logs && logs.items.length > 0 ? (
                <ImportReviewOperationLogPanel
                    title="Validation stages"
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                    entries={sortLogs(logs.items).map((item) => {
                        const detailLine = formatStageLogDetails(item.details);
                        return {
                            id: item.id,
                            label: item.stage_label,
                            message: [item.message, detailLine].filter(Boolean).join(" — ") || null,
                            status: item.stage_status,
                            at: item.started_at,
                        };
                    })}
                />
            ) : isValidating ? (
                <ImportReviewOperationLogPanel
                    title="Validation stages"
                    entries={[]}
                    isLoading
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                />
            ) : null}
        </div>
    );
}

function EntityBreakdownRow({
    family,
    counts,
}: {
    family: string;
    counts: ImportReviewPublishBatchEntityValidationCounts;
}) {
    return (
        <tr>
            <td className="px-3 py-2 font-medium text-gray-900">{family}</td>
            <td className="px-3 py-2 text-right tabular-nums">{counts.total.toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                {counts.valid.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                {counts.warning.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-red-700">
                {counts.blocked.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {counts.skipped.toLocaleString()}
            </td>
        </tr>
    );
}

function CountCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: "success" | "warning" | "error";
}) {
    const valueCls =
        tone === "success"
            ? "text-emerald-700"
            : tone === "warning"
              ? "text-amber-700"
              : tone === "error"
                ? "text-red-700"
                : "text-gray-900";
    return (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-lg font-semibold tabular-nums ${valueCls}`}>{value.toLocaleString()}</p>
        </div>
    );
}
