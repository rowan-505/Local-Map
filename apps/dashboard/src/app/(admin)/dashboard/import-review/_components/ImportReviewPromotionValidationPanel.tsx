"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    PromotionStatusBadge,
    publishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { importReviewPromotionTargetLabel } from "@/src/features/import-review/utils/importReviewPromotionBatchFamilies";
import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewOperationLogPanel from "@/src/features/import-review/components/ImportReviewOperationLogPanel";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    canCancelImportReviewPublishBatchValidation,
    canResetImportReviewPublishBatchValidation,
    formatValidationHeartbeatAt,
} from "@/src/features/import-review/promotion/validationControl";
import ImportReviewPromotionBatchLimitsConfirm from "@/src/features/import-review/promotion/ImportReviewPromotionBatchLimitsConfirm";
import {
    evaluatePublishBatchLimits,
    type PublishBatchLimitsConfirmationState,
} from "@/src/features/import-review/promotion/batchLimits";
import {
    filterSimpleValidationStageLogs,
    formatElapsedMs,
    formatValidateItemsStageDetailLine,
    parseValidateItemsStageLiveDetails,
    sortSimpleValidationStageLogs,
} from "@/src/features/import-review/promotion/validationStages";
import {
    canValidateImportReviewPublishBatch,
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    isAbortError,
    postImportReviewPromotionBatchCancelValidation,
    postImportReviewPromotionBatchResetValidation,
    postImportReviewPromotionBatchValidate,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchEntityValidationCounts,
    type ImportReviewPublishBatchLogsResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishStageLogItem,
} from "@/src/lib/api";

import {
    nextPublishBatchPollDelayMs,
    PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS,
    PUBLISH_BATCH_POOLER_WARNING,
    PUBLISH_BATCH_STALE_HEARTBEAT_EXTRA_POLLS,
    shouldPollPublishBatchProgress,
} from "@/src/features/import-review/promotion/publishBatchPolling";

const CANCEL_POLL_MS = 500;
const CANCEL_POLL_MAX_ATTEMPTS = 60;

function familyLabelFromSlug(family: string | null | undefined): string | null {
    if (!family?.trim() || isDeprecatedCoreBusImportReviewFamily(family)) {
        return null;
    }
    return publishEntityFamilyLabel(family);
}

function formatStageLogDetails(
    stageKey: string,
    details: unknown
): string | null {
    if (stageKey === "validate_candidate_state") {
        const live = parseValidateItemsStageLiveDetails(details);
        const familyLabel = familyLabelFromSlug(live?.currentFamily ?? null);
        const line = formatValidateItemsStageDetailLine(live);
        return [familyLabel, line].filter(Boolean).join(" · ") || null;
    }
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const d = details as Record<string, unknown>;
    const parts: string[] = [];
    const byEntity = d.by_entity;
    if (byEntity && typeof byEntity === "object" && !Array.isArray(byEntity)) {
        const families = Object.keys(byEntity as Record<string, unknown>).filter(
            (f) => !isDeprecatedCoreBusImportReviewFamily(f)
        );
        if (families.length > 0) {
            parts.push(`${families.length} famil${families.length === 1 ? "y" : "ies"}`);
        }
    }
    const validatable = d.validatable_items;
    if (typeof validatable === "number") {
        parts.push(`${validatable.toLocaleString()} validatable`);
    }
    const totalItems = d.total_items;
    if (typeof totalItems === "number") {
        parts.push(`${totalItems.toLocaleString()} items`);
    }
    const flagged = d.flagged_items;
    if (typeof flagged === "number") {
        parts.push(`${flagged.toLocaleString()} flagged`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

type Props = {
    batchId: string;
    batchStatus: string;
    selectedFamilies: string[];
    batchItemCount: number;
    workflowBlocked?: boolean;
    workflowBlockedMessage?: string;
    onBatchUpdated: (detail: ImportReviewPublishBatchDetail) => void;
    formatError: (err: unknown) => string;
};

export default function ImportReviewPromotionValidationPanel({
    batchId,
    batchStatus,
    selectedFamilies,
    batchItemCount,
    workflowBlocked = false,
    workflowBlockedMessage,
    onBatchUpdated,
    formatError,
}: Props) {
    const [status, setStatus] = useState(batchStatus);
    const [progress, setProgress] = useState<ImportReviewPublishBatchProgressResponse | null>(null);
    const [logs, setLogs] = useState<ImportReviewPublishBatchLogsResponse | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [limitsConfirmation, setLimitsConfirmation] = useState<PublishBatchLimitsConfirmationState>({
        confirmLargeBatch: false,
        allowHighRiskFamilies: false,
        mixedHighRiskConfirm: false,
    });
    const [error, setError] = useState<string | null>(null);
    const [pollWarning, setPollWarning] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollErrorCountRef = useRef(0);
    const staleHeartbeatPollsRef = useRef(0);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const refreshBatchDetail = useCallback(async () => {
        const detail = await getImportReviewPromotionBatchById(batchId);
        setStatus(detail.status);
        onBatchUpdated(detail);
    }, [batchId, onBatchUpdated]);

    const pollOnce = useCallback(async (): Promise<boolean> => {
        const p = await getImportReviewPromotionBatchProgress(batchId);
        setProgress(p);
        setStatus(p.status);
        pollErrorCountRef.current = 0;
        setPollWarning(null);

        if (p.validation_heartbeat_stale_warning) {
            staleHeartbeatPollsRef.current += 1;
            if (staleHeartbeatPollsRef.current >= PUBLISH_BATCH_STALE_HEARTBEAT_EXTRA_POLLS) {
                setPollWarning(
                    "Validation heartbeat looks stale. Use Reset validation or SQL bulk validate for large road batches."
                );
                stopPolling();
                return false;
            }
        } else {
            staleHeartbeatPollsRef.current = 0;
        }

        try {
            const l = await getImportReviewPromotionBatchLogs(batchId);
            setLogs(l);
        } catch (logErr) {
            if (!isAbortError(logErr)) {
                setPollWarning(formatError(logErr));
            }
        }

        const continuePolling = shouldPollPublishBatchProgress(p.status);
        if (!continuePolling) {
            stopPolling();
            await refreshBatchDetail();
        }
        return continuePolling;
    }, [batchId, refreshBatchDetail, stopPolling, formatError]);

    const scheduleNextPoll = useCallback(
        (heartbeatStale: boolean) => {
            const delay = nextPublishBatchPollDelayMs({
                consecutiveErrors: pollErrorCountRef.current,
                heartbeatStaleWarning: heartbeatStale,
            });
            pollRef.current = setTimeout(() => {
                void pollOnce()
                    .then((continuePolling) => {
                        if (continuePolling) {
                            scheduleNextPoll(heartbeatStale);
                        }
                    })
                    .catch((err) => {
                        if (isAbortError(err)) {
                            return;
                        }
                        pollErrorCountRef.current += 1;
                        setError(formatError(err));
                        if (pollErrorCountRef.current >= PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS) {
                            setPollWarning(PUBLISH_BATCH_POOLER_WARNING);
                            stopPolling();
                            return;
                        }
                        scheduleNextPoll(false);
                    });
            }, delay);
        },
        [formatError, pollOnce, stopPolling]
    );

    const startPolling = useCallback(() => {
        stopPolling();
        pollErrorCountRef.current = 0;
        staleHeartbeatPollsRef.current = 0;
        void pollOnce().then((continuePolling) => {
            if (continuePolling) {
                scheduleNextPoll(false);
            }
        });
    }, [pollOnce, scheduleNextPoll, stopPolling]);

    const hydrateProgress = useCallback(async (signal?: AbortSignal) => {
        try {
            const requestOpts = signal ? { signal } : undefined;
            const p = await getImportReviewPromotionBatchProgress(batchId, requestOpts);
            setProgress(p);
            setStatus(p.status);
            try {
                const l = await getImportReviewPromotionBatchLogs(batchId, requestOpts);
                setLogs(l);
            } catch (logErr) {
                if (!isAbortError(logErr)) {
                    setPollWarning(formatError(logErr));
                }
            }
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
            await postImportReviewPromotionBatchValidate(batchId, {
                confirm_large_batch: limitsConfirmation.confirmLargeBatch,
                allow_high_risk_families: limitsConfirmation.allowHighRiskFamilies,
                mixed_high_risk_confirm: limitsConfirmation.mixedHighRiskConfirm,
            });
            setStatus("validating");
            startPolling();
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsStarting(false);
        }
    }

    async function handleCancelValidation() {
        setError(null);
        setIsCancelling(true);
        try {
            const cancelResult = await postImportReviewPromotionBatchCancelValidation(batchId);
            setStatus(cancelResult.status);
            if (cancelResult.status !== "validating") {
                await pollOnce();
                return;
            }
            for (let attempt = 0; attempt < CANCEL_POLL_MAX_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS));
                const p = await getImportReviewPromotionBatchProgress(batchId);
                setProgress(p);
                setStatus(p.status);
                if (p.status !== "validating") {
                    stopPolling();
                    await refreshBatchDetail();
                    const l = await getImportReviewPromotionBatchLogs(batchId);
                    setLogs(l);
                    return;
                }
            }
            setError(
                "Cancel was requested but validation is still running. Wait a moment, then use Reset validation."
            );
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsCancelling(false);
        }
    }

    async function handleResetValidation() {
        setError(null);
        setIsResetting(true);
        try {
            const result = await postImportReviewPromotionBatchResetValidation(batchId);
            setStatus(result.status);
            setProgress(null);
            setLogs(null);
            await refreshBatchDetail();
            await hydrateProgress();
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsResetting(false);
        }
    }

    const limitsEvaluation = useMemo(
        () =>
            evaluatePublishBatchLimits({
                families: selectedFamilies,
                totalItems: batchItemCount,
                confirmation: limitsConfirmation,
            }),
        [selectedFamilies, batchItemCount, limitsConfirmation]
    );

    const canValidate =
        !workflowBlocked &&
        canValidateImportReviewPublishBatch(status) &&
        limitsEvaluation.canProceed;
    const canCancel = canCancelImportReviewPublishBatchValidation(status);
    const heartbeatStaleWarning = Boolean(progress?.validation_heartbeat_stale_warning);
    const canReset = canResetImportReviewPublishBatchValidation(status, {
        heartbeatStaleWarning,
        cancelRequested: Boolean(progress?.validation_cancel_requested_at),
    });
    const isValidating = status === "validating" || isStarting;
    const showResetValidation = canReset;
    const percent = progress?.validation_percent ?? 0;
    const result = isValidating ? null : progress?.validation_result;
    const summaryMessage =
        isValidating ? progress?.current_message : (progress?.validation_logs_summary ?? progress?.current_message);
    const heartbeatLabel = formatValidationHeartbeatAt(progress?.validation_heartbeat_at);
    const cancelPending = Boolean(progress?.validation_cancel_requested_at);

    const entityRows = useMemo(() => {
        if (!result?.by_entity) {
            return [];
        }
        const order = new Map(selectedFamilies.map((family, index) => [family, index]));
        return Object.entries(result.by_entity)
            .filter(([family]) => !isDeprecatedCoreBusImportReviewFamily(family))
            .sort(([a], [b]) => {
                const ia = order.get(a) ?? 999;
                const ib = order.get(b) ?? 999;
                if (ia !== ib) {
                    return ia - ib;
                }
                return a.localeCompare(b);
            });
    }, [result?.by_entity, selectedFamilies]);

    const currentFamilyLabel = familyLabelFromSlug(progress?.current_entity_family ?? null);

    const validateItemsLive = useMemo(() => {
        if (!logs?.items.length) {
            return null;
        }
        const running = logs.items.find(
            (item) =>
                item.stage_key === "validate_candidate_state" &&
                (item.stage_status === "running" || item.stage_status === "warning")
        );
        return running ? parseValidateItemsStageLiveDetails(running.details) : null;
    }, [logs?.items]);

    const displayProcessed =
        validateItemsLive?.processedCount ?? progress?.validation_done ?? progress?.item_processed_count ?? 0;
    const displayTotal =
        validateItemsLive?.totalItemCount ??
        progress?.validation_total ??
        progress?.total_item_count ??
        0;

    const stageLogEntries = useMemo(() => {
        if (!logs?.items.length) {
            return [];
        }
        return sortSimpleValidationStageLogs(filterSimpleValidationStageLogs(logs.items)).map((item) => {
            const live =
                item.stage_key === "validate_candidate_state"
                    ? parseValidateItemsStageLiveDetails(item.details)
                    : null;
            const familyFromLive = familyLabelFromSlug(live?.currentFamily ?? null);
            const detailLine = formatStageLogDetails(item.stage_key, item.details);
            return {
                id: item.id,
                label: familyFromLive ? `${item.stage_label} (${familyFromLive})` : item.stage_label,
                message: [item.message, detailLine].filter(Boolean).join(" — ") || null,
                status: item.stage_status,
                at: item.started_at,
            };
        });
    }, [logs?.items]);

    return (
        <div className="mt-6 space-y-4 border-t border-gray-100 pt-6">
            <div>
                <h3 className="text-base font-semibold text-gray-900">Validation</h3>
                <p className="mt-0.5 text-sm text-gray-600">
                    Checks typed candidate columns per item. Blocked items cannot promote; warnings need a
                    confirmation note on promote.
                </p>
            </div>
            {batchItemCount > 0 ? (
                <ImportReviewPromotionBatchLimitsConfirm
                    evaluation={limitsEvaluation}
                    confirmation={limitsConfirmation}
                    onConfirmationChange={setLimitsConfirmation}
                    actionLabel="Validate this publish batch"
                />
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => void handleValidate()}
                    disabled={!canValidate || isValidating}
                    title={
                        workflowBlocked
                            ? (workflowBlockedMessage ?? "Transport promotion moved to Import Transport.")
                            : undefined
                    }
                    className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                    {isValidating ? IMPORT_REVIEW_LOADING.validating : "Validate selected"}
                </button>
                {canCancel ? (
                    <button
                        type="button"
                        onClick={() => void handleCancelValidation()}
                        disabled={isCancelling || cancelPending}
                        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                        {isCancelling || cancelPending ? "Cancelling…" : "Cancel validation"}
                    </button>
                ) : null}
                {showResetValidation ? (
                    <button
                        type="button"
                        onClick={() => void handleResetValidation()}
                        disabled={isResetting}
                        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {isResetting ? "Resetting…" : "Reset validation"}
                    </button>
                ) : null}
                <PromotionStatusBadge value={status} />
                {isValidating ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.validating} />
                ) : null}
            </div>

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}
            {pollWarning ? (
                <ImportReviewStatusBanner message={pollWarning} tone="warning" compact />
            ) : null}
            {batchItemCount > 50 && selectedFamilies.includes("roads") ? (
                <ImportReviewStatusBanner message={PUBLISH_BATCH_POOLER_WARNING} tone="warning" compact />
            ) : null}
            {heartbeatStaleWarning && isValidating ? (
                <ImportReviewStatusBanner
                    message="Validation worker stopped. Cancel and reset before validating again."
                    tone="warning"
                    compact
                />
            ) : null}
            {heartbeatLabel && isValidating ? (
                <p className="text-xs text-gray-500">
                    Last heartbeat: {heartbeatLabel}
                    {cancelPending ? " · Cancel requested" : ""}
                </p>
            ) : null}
            {workflowBlocked && workflowBlockedMessage ? (
                <ImportReviewStatusBanner message={workflowBlockedMessage} tone="warning" compact />
            ) : null}

            {(isValidating || progress) && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>
                            {progress?.current_stage_label ?? "Validation"}
                            {currentFamilyLabel ? ` · ${currentFamilyLabel}` : ""}
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
                    {displayTotal > 0 || isValidating ? (
                        <p className="text-xs text-gray-500 tabular-nums">
                            {displayTotal > 0
                                ? `Items processed: ${displayProcessed.toLocaleString()} / ${displayTotal.toLocaleString()}`
                                : "Items processed: starting…"}
                            {validateItemsLive?.lastHeartbeatAt
                                ? ` · stage heartbeat ${new Date(validateItemsLive.lastHeartbeatAt).toLocaleTimeString()}`
                                : null}
                            {validateItemsLive?.elapsedMs != null
                                ? ` · elapsed ${formatElapsedMs(validateItemsLive.elapsedMs) ?? ""}`
                                : null}
                        </p>
                    ) : null}
                </div>
            )}

            {result ? (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <CountCard label="Total items" value={result.total_items} />
                        <CountCard label="Ready" value={result.valid_count} tone="success" />
                        <CountCard label="Warnings" value={result.warning_count} tone="warning" />
                        <CountCard label="Blocked" value={result.blocked_count} tone="error" />
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
                            : result?.outcome === "partial"
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
                                <th className="px-3 py-2 font-semibold">Family</th>
                                <th className="px-3 py-2 font-semibold">Target</th>
                                <th className="px-3 py-2 font-semibold text-right">Total</th>
                                <th className="px-3 py-2 font-semibold text-right">Ready</th>
                                <th className="px-3 py-2 font-semibold text-right">Warnings</th>
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

            {stageLogEntries.length > 0 ? (
                <ImportReviewOperationLogPanel
                    title="Validation stages"
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                    entries={stageLogEntries}
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
            <td className="px-3 py-2 font-medium text-gray-900">{publishEntityFamilyLabel(family)}</td>
            <td className="px-3 py-2 font-mono text-xs text-gray-600">
                {importReviewPromotionTargetLabel(family)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{counts.total.toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                {(counts.valid ?? 0).toLocaleString()}
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
