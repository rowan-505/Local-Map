"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PromotionStatusBadge } from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import {
    canValidateImportReviewPublishBatch,
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    isAbortError,
    postImportReviewPromotionBatchValidate,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchLogsResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishStageLogItem,
} from "@/src/lib/api";

const POLL_MS = 1500;

const STAGE_ORDER = [
    "load_batch",
    "load_items",
    "candidate_integrity",
    "geometry_validation",
    "required_field_validation",
    "reference_validation",
    "duplicate_validation",
    "action_validation",
    "validation_summary",
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

    useEffect(() => {
        setStatus(batchStatus);
    }, [batchStatus]);

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

    return (
        <div className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => void handleValidate()}
                    disabled={!canValidate || isValidating}
                    className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                    {isValidating ? "Validating…" : "Validate batch"}
                </button>
                <PromotionStatusBadge value={status} />
            </div>

            {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
            ) : null}

            {(isValidating || progress) && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>
                            {progress?.current_stage_label ?? "Validation"}
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CountCard label="Total items" value={result.total_items} />
                    <CountCard label="Valid" value={result.valid_count} tone="success" />
                    <CountCard label="Warnings" value={result.warning_count} tone="warning" />
                    <CountCard label="Blocked / errors" value={result.blocked_count} tone="error" />
                    <CountCard label="Buildings insert" value={result.by_publish_action.insert} />
                    <CountCard label="Buildings update" value={result.by_publish_action.update} />
                </div>
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

            {logs && logs.items.length > 0 ? (
                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Validation stages
                    </h4>
                    <ol className="mt-2 space-y-2">
                        {sortLogs(logs.items).map((item) => (
                            <li
                                key={item.id}
                                className="flex flex-col gap-1 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div>
                                    <span className="font-medium text-gray-900">{item.stage_label}</span>
                                    {item.message ? (
                                        <p className="mt-0.5 text-xs text-gray-600">{item.message}</p>
                                    ) : null}
                                </div>
                                <span
                                    className={`inline-flex w-fit items-center rounded px-2 py-0.5 text-xs font-medium ${stageStatusColor(item.stage_status)}`}
                                >
                                    {item.stage_status}
                                    {item.progress_percent > 0 ? ` · ${item.progress_percent}%` : ""}
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            ) : null}
        </div>
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
