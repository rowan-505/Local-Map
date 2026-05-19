"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PromotionStatusBadge } from "@/src/app/(admin)/import-review/_components/importReviewPromotionUi";
import {
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    getImportReviewPromotionBatchVerify,
    isAbortError,
    postImportReviewPromotionBatchPromote,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchLogsResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishBatchVerifyResponse,
    type ImportReviewPublishStageLogItem,
} from "@/src/lib/api";

const POLL_MS = 1500;

const STAGE_ORDER = [
    "promote_preflight",
    "load_promotable_items",
    "final_validation_before_write",
    "promote_buildings_to_core",
    "write_publish_item_results",
    "verify_core_rows",
    "mark_import_review_promoted",
    "update_batch_summary",
    "promotion_final_response",
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

export default function ImportReviewPromotionPromotePanel({
    batchId,
    batchStatus,
    onBatchUpdated,
    formatError,
}: Props) {
    const [status, setStatus] = useState(batchStatus);
    const [progress, setProgress] = useState<ImportReviewPublishBatchProgressResponse | null>(null);
    const [logs, setLogs] = useState<ImportReviewPublishBatchLogsResponse | null>(null);
    const [verify, setVerify] = useState<ImportReviewPublishBatchVerifyResponse | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");
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
        if (p.status !== "promoting") {
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
        const controller = new AbortController();
        void getImportReviewPromotionBatchProgress(batchId, { signal: controller.signal })
            .then(setProgress)
            .catch((err) => {
                if (!isAbortError(err)) {
                    setError(formatError(err));
                }
            });
        return () => controller.abort();
    }, [batchId, formatError]);

    useEffect(() => {
        if (status === "promoting") {
            startPolling();
        }
        return () => stopPolling();
    }, [status, startPolling, stopPolling]);

    async function handlePromote() {
        setError(null);
        setIsStarting(true);
        try {
            await postImportReviewPromotionBatchPromote(batchId, {
                confirmation_text: "PROMOTE",
                chunk_size: 100,
            });
            setConfirmOpen(false);
            setConfirmText("");
            setStatus("promoting");
            startPolling();
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsStarting(false);
        }
    }

    async function handleVerify() {
        setError(null);
        setIsVerifying(true);
        try {
            const result = await getImportReviewPromotionBatchVerify(batchId);
            setVerify(result);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsVerifying(false);
        }
    }

    const canPromote = status === "ready";
    const isPromoting = status === "promoting" || isStarting;
    const percent = progress?.validation_percent ?? 0;
    const promotionResult = progress?.promotion_result;
    const validationForModal = progress?.validation_result;
    const summaryMessage = progress?.promotion_logs_summary ?? progress?.current_message;
    const showPromotionLogs =
        logs &&
        logs.items.length > 0 &&
        (progress?.workflow === "promotion" || isPromoting || status === "promoted" || status === "failed");

    return (
        <div className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canPromote || isPromoting}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    {isPromoting ? "Promoting…" : "Promote to core"}
                </button>
                <button
                    type="button"
                    onClick={() => void handleVerify()}
                    disabled={isVerifying || status === "draft" || status === "validating"}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                    {isVerifying ? "Verifying…" : "Verify promotion"}
                </button>
                <PromotionStatusBadge value={status} />
            </div>

            {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
            ) : null}

            {(isPromoting || (progress?.workflow === "promotion" && percent > 0)) && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>
                            {progress?.current_stage_label ?? "Promotion"}
                            {progress?.current_message ? ` — ${progress.current_message}` : ""}
                        </span>
                        <span className="tabular-nums font-medium">{percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full bg-emerald-600 transition-all duration-300"
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

            {promotionResult && !isPromoting ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CountCard label="Inserted" value={promotionResult.inserted_count} />
                    <CountCard label="Updated" value={promotionResult.updated_count} />
                    <CountCard label="Success" value={promotionResult.success_count} tone="success" />
                    <CountCard label="Failed" value={promotionResult.failed_count} tone="error" />
                    <CountCard label="Core verified" value={promotionResult.core_verified_count} />
                    <CountCard
                        label="Import review marked"
                        value={promotionResult.import_review_marked_promoted_count}
                    />
                </div>
            ) : null}

            {summaryMessage && !isPromoting ? (
                <p
                    className={`rounded-md border px-3 py-2 text-sm ${
                        promotionResult?.status === "promoted" && !promotionResult.partial_success
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                >
                    {summaryMessage}
                </p>
            ) : null}

            {showPromotionLogs ? (
                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Promotion stages
                    </h4>
                    <ol className="mt-2 space-y-2">
                        {sortLogs(logs!.items).map((item) => (
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

            {verify ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 text-sm">
                    <p className="font-medium text-gray-900">
                        Verification:{" "}
                        <span
                            className={
                                verify.verification_status === "passed"
                                    ? "text-emerald-700"
                                    : verify.verification_status === "warning"
                                      ? "text-amber-700"
                                      : "text-red-700"
                            }
                        >
                            {verify.verification_status}
                        </span>
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        <li>
                            Publish items — success: {verify.publish_items.success}, failed:{" "}
                            {verify.publish_items.failed}
                        </li>
                        <li>Core rows missing: {verify.core_rows_missing}</li>
                        <li>Lineage warnings: {verify.lineage_warnings}</li>
                    </ul>
                </div>
            ) : null}

            {confirmOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-900">Promote to core</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            This will write to production core.core_map_buildings. This action is not
                            automatically reversible.
                        </p>
                        {validationForModal ? (
                            <ul className="mt-3 space-y-1 text-sm text-gray-700">
                                <li>Total items: {validationForModal.total_items}</li>
                                <li>Insert: {validationForModal.by_publish_action.insert}</li>
                                <li>Update: {validationForModal.by_publish_action.update}</li>
                            </ul>
                        ) : null}
                        <p className="mt-4 text-sm text-gray-600">
                            Type <span className="font-mono font-semibold">PROMOTE</span> to confirm.
                        </p>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setConfirmOpen(false);
                                    setConfirmText("");
                                }}
                                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={confirmText !== "PROMOTE" || isStarting}
                                onClick={() => void handlePromote()}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                Confirm promote
                            </button>
                        </div>
                    </div>
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
