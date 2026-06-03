"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { invalidateImportReviewAfterPromotion } from "@/src/features/import-review/hooks/invalidateImportReviewAfterPromotion";
import ImportReviewPromotionEligibilityDetailsDrawer from "@/src/features/import-review/components/ImportReviewPromotionEligibilityDetailsDrawer";
import { promotionPromoteUiState } from "@/src/features/import-review/utils/promotionPromoteUiState";
import {
    formatPublishBatchPromotionStatus,
    formatPublishBatchValidationOutcome,
} from "@/src/features/import-review/utils/publishBatchPromotionStatus";
import { resolveBatchSelectedFamilies } from "@/src/features/import-review/utils/importReviewPromotionBatchFamilies";

import {
    PromotionStatusBadge,
    publishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewOperationLogPanel from "@/src/features/import-review/components/ImportReviewOperationLogPanel";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    ImportReviewPromotionDryRunNotice,
    ImportReviewPromotionFailedItemsPanel,
} from "@/src/features/import-review/promotion";
import {
    filterPromotionStageLogs,
    hasUnsettledPromotionStageLogs,
    sortPromotionStageLogs,
} from "@/src/features/import-review/promotion/promotionStageLogs";
import {
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    getImportReviewPromotionBatchVerify,
    isAbortError,
    postImportReviewPromotionBatchPromote,
    postImportReviewPromotionBatchRetryFailedReady,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchLogsResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishBatchVerifyResponse,
} from "@/src/lib/api";

const POLL_MS = 1500;
const POST_PROMOTION_STAGE_SETTLE_POLLS = 8;

type Props = {
    batchId: string;
    batchStatus: string;
    sourceReviewBatchId?: string | null;
    entityFamilies?: string[];
    hasRoadItems?: boolean;
    hasRoutingBarrierItems?: boolean;
    workflowBlocked?: boolean;
    workflowBlockedMessage?: string;
    onBatchUpdated: (detail: ImportReviewPublishBatchDetail) => void;
    formatError: (err: unknown) => string;
};

export default function ImportReviewPromotionPromotePanel({
    batchId,
    batchStatus,
    sourceReviewBatchId = null,
    entityFamilies = [],
    hasRoadItems = false,
    hasRoutingBarrierItems = false,
    workflowBlocked = false,
    workflowBlockedMessage,
    onBatchUpdated,
    formatError,
}: Props) {
    const router = useRouter();
    const [status, setStatus] = useState(batchStatus);
    const [isCreatingRetryBatch, setIsCreatingRetryBatch] = useState(false);
    const [progress, setProgress] = useState<ImportReviewPublishBatchProgressResponse | null>(null);
    const [logs, setLogs] = useState<ImportReviewPublishBatchLogsResponse | null>(null);
    const [verify, setVerify] = useState<ImportReviewPublishBatchVerifyResponse | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [warningNote, setWarningNote] = useState("");
    const [blockedDrawerOpen, setBlockedDrawerOpen] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const postPromotionSettlePollsRef = useRef(0);
    const queryClient = useQueryClient();

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const refreshBatchDetail = useCallback(async (): Promise<ImportReviewPublishBatchDetail> => {
        const detail = await getImportReviewPromotionBatchById(batchId);
        setStatus(detail.status);
        onBatchUpdated(detail);
        return detail;
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
            if (
                hasUnsettledPromotionStageLogs(l.items) &&
                postPromotionSettlePollsRef.current < POST_PROMOTION_STAGE_SETTLE_POLLS
            ) {
                postPromotionSettlePollsRef.current += 1;
                return;
            }
            postPromotionSettlePollsRef.current = 0;
            stopPolling();
            const detail = await refreshBatchDetail();
            if (
                p.status === "promoted" ||
                p.status === "partially_promoted" ||
                (p.promotion_result?.promoted_count ?? p.promotion_result?.success_count ?? 0) > 0
            ) {
                await invalidateImportReviewAfterPromotion(queryClient, {
                    publishBatchId: batchId,
                    reviewBatchId: sourceReviewBatchId ?? undefined,
                    promotedFamilies: resolveBatchSelectedFamilies(detail),
                });
            }
        }
    }, [batchId, queryClient, refreshBatchDetail, sourceReviewBatchId, stopPolling]);

    const startPolling = useCallback(() => {
        stopPolling();
        postPromotionSettlePollsRef.current = 0;
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
        void Promise.all([
            getImportReviewPromotionBatchProgress(batchId, { signal: controller.signal }),
            getImportReviewPromotionBatchLogs(batchId, { signal: controller.signal }),
        ])
            .then(([p, l]) => {
                setProgress(p);
                setLogs(l);
                setStatus(p.status);
            })
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
            return () => stopPolling();
        }
        if (
            status === "promoted" ||
            status === "partially_promoted" ||
            status === "failed"
        ) {
            void pollOnce();
        }
        return () => stopPolling();
    }, [status, startPolling, stopPolling, pollOnce]);

    const validation = progress?.validation_result ?? null;
    const promotionResult = progress?.promotion_result;
    const promotionOutcomeLabel = formatPublishBatchPromotionStatus(
        progress?.promotion_status ??
            (promotionResult?.promoted_count ?? promotionResult?.success_count ?? 0) > 0
            ? promotionResult?.status === "partially_promoted"
                ? "partially_promoted"
                : promotionResult?.status === "promoted"
                  ? "promoted"
                  : null
            : promotionResult && (promotionResult.failed_count ?? 0) > 0
              ? "promotion_failed"
              : null
    );
    const validationOutcomeLabel = formatPublishBatchValidationOutcome(validation?.outcome);
    const ui = useMemo(
        () =>
            promotionPromoteUiState({
                batchStatus: status,
                workflowBlocked,
                validatedAt: progress?.validated_at,
                validationPercent: progress?.validation_percent,
                validation,
                currentPromotableCount: progress?.current_promotable_count,
                validationPromotableCount: progress?.validation_promotable_count,
                publishItemStatus: progress?.publish_item_status_counts,
                failedReadyRetryCount: progress?.failed_ready_retry_count,
                promotionStatus: progress?.promotion_status,
            }),
        [
            status,
            workflowBlocked,
            progress?.validated_at,
            progress?.validation_percent,
            validation,
            progress?.current_promotable_count,
            progress?.validation_promotable_count,
            progress?.publish_item_status_counts,
            progress?.failed_ready_retry_count,
            progress?.promotion_status,
        ]
    );

    useEffect(() => {
        if (progress?.status) {
            setStatus(progress.status);
        }
    }, [progress?.status]);

    async function handleCreateRetryBatch() {
        if (!ui.canCreateRetryBatch || !sourceReviewBatchId) {
            return;
        }
        setError(null);
        setIsCreatingRetryBatch(true);
        try {
            const result = await postImportReviewPromotionBatchRetryFailedReady(batchId, {
                confirm_large_batch: (progress?.failed_ready_retry_count ?? 0) > 200,
            });
            const newBatchId = String(result.id ?? result.publish_batch_id ?? result.batch_id);
            router.push(
                `/dashboard/import-review/promotion/${encodeURIComponent(newBatchId)}?review_batch_id=${encodeURIComponent(sourceReviewBatchId)}`
            );
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsCreatingRetryBatch(false);
        }
    }

    const requiresWarningNote = validation?.requires_warning_confirmation === true;
    const warningNoteReady = warningNote.trim().length > 0;

    async function handlePromote() {
        setError(null);
        setIsStarting(true);
        try {
            const note = warningNote.trim();
            const includeWarnings =
                ui.warningCount > 0 && note.length > 0 ? { confirm_warnings: true as const } : {};
            await postImportReviewPromotionBatchPromote(batchId, {
                confirmation_text: "PROMOTE",
                chunk_size: 100,
                ...includeWarnings,
                ...(note
                    ? {
                          promotion_note: note,
                          warning_confirmation_note: note,
                          review_note: note,
                      }
                    : {}),
            });
            setConfirmOpen(false);
            setConfirmText("");
            setWarningNote("");
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

    const isPromoting = status === "promoting" || isStarting;
    const derivedStatus = progress?.derived_status ?? status;
    const isInvalidEmptyPromoted = derivedStatus === "invalid_empty_promoted";
    const percent = progress?.validation_percent ?? 0;
    const canConfirmPromote =
        confirmText === "PROMOTE" &&
        !isStarting &&
        (!requiresWarningNote || warningNoteReady);
    const promoteDisabledReason = workflowBlocked
        ? (workflowBlockedMessage ?? "Transport promotion moved to Import Transport.")
        : ui.promoteDisabledReason;
    const canPromote = !workflowBlocked && ui.canPromote;
    const summaryMessage = isInvalidEmptyPromoted
        ? "This batch was marked promoted but no items were promoted. Treat as failed/invalid and create a new batch."
        : (progress?.promotion_logs_summary ?? progress?.current_message);
    const showPromotionLogs =
        logs &&
        logs.items.length > 0 &&
        (progress?.workflow === "promotion" ||
            isPromoting ||
            status === "promoted" ||
            status === "partially_promoted" ||
            status === "failed");
    const canVerify =
        !isVerifying &&
        status !== "draft" &&
        status !== "validating" &&
        (promotionResult?.promoted_count ?? promotionResult?.success_count ?? 0) > 0;

    const blockedDrawerFamily = ui.blockedDetailsFamily ?? entityFamilies[0] ?? null;

    return (
        <div className="space-y-4">
            <ImportReviewPromotionDryRunNotice
                hasRoads={hasRoadItems}
                hasRoutingBarriers={hasRoutingBarrierItems}
            />

            <div className="flex flex-wrap gap-4 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm">
                <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Lifecycle
                    </span>
                    <div className="mt-1">
                        <PromotionStatusBadge value={status} />
                    </div>
                </div>
                {validation ? (
                    <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Validation
                        </span>
                        <p className="font-medium text-gray-900">{validationOutcomeLabel}</p>
                    </div>
                ) : percent >= 100 ? (
                    <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Validation
                        </span>
                        <p className="font-medium text-gray-500">Summary unavailable</p>
                    </div>
                ) : null}
                {progress?.promotion_status || promotionResult ? (
                    <div>
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Promotion result
                        </span>
                        <p className="font-medium text-gray-900">{promotionOutcomeLabel}</p>
                    </div>
                ) : null}
            </div>

            {validation ? (
                <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Validation snapshot
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <CountCard label="Total" value={validation.total_count ?? validation.total_items} />
                        <CountCard label="Ready" value={ui.readyCount} tone="success" />
                        <CountCard label="Warnings" value={ui.warningCount} tone="warning" />
                        <CountCard label="Blocked" value={ui.blockedCount} tone="error" />
                        <CountCard
                            label="Promotable at validation"
                            value={ui.validationPromotableCount}
                        />
                    </div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Publish items now
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <CountCard
                            label="Ready to promote now"
                            value={ui.currentPromotableCount}
                            tone={ui.currentPromotableCount > 0 ? "success" : "error"}
                        />
                        <CountCard label="Pending" value={progress?.publish_item_status_counts?.pending ?? 0} />
                        <CountCard
                            label="Failed"
                            value={ui.publishItemFailedCount}
                            tone={ui.publishItemFailedCount > 0 ? "error" : undefined}
                        />
                        <CountCard label="Promoted" value={ui.publishItemSuccessCount} tone="success" />
                    </div>
                </div>
            ) : null}

            {ui.exhaustedBatchMessage && !isPromoting ? (
                <ImportReviewStatusBanner message={ui.exhaustedBatchMessage} tone="warning" compact />
            ) : null}

            {ui.retryBatchMessage && ui.promotionAttemptExhausted && !isPromoting ? (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-amber-900">{ui.retryBatchMessage}</p>
                    {ui.canCreateRetryBatch && sourceReviewBatchId ? (
                        <button
                            type="button"
                            onClick={() => void handleCreateRetryBatch()}
                            disabled={isCreatingRetryBatch}
                            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-50 disabled:opacity-50"
                        >
                            {isCreatingRetryBatch
                                ? "Creating retry batch…"
                                : (ui.retryBatchButtonLabel ?? "Create retry batch")}
                        </button>
                    ) : null}
                </div>
            ) : null}

            {ui.blockedWarningMessage && !isPromoting ? (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span>{ui.blockedWarningMessage}</span>
                    {sourceReviewBatchId && blockedDrawerFamily ? (
                        <button
                            type="button"
                            onClick={() => setBlockedDrawerOpen(true)}
                            className="font-medium text-amber-950 underline hover:no-underline"
                        >
                            View blocked item details
                        </button>
                    ) : null}
                </div>
            ) : null}

            {ui.showWarningNoteField && !isPromoting ? (
                <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/80 p-3">
                    <p className="text-sm text-amber-900">
                        {ui.warningCount.toLocaleString()} warning item
                        {ui.warningCount === 1 ? "" : "s"} require a confirmation note before promotion.
                    </p>
                    <textarea
                        value={warningNote}
                        onChange={(e) => setWarningNote(e.target.value)}
                        rows={2}
                        className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
                        placeholder="Promotion note (required to include warnings)"
                    />
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canPromote || isPromoting}
                    title={promoteDisabledReason ?? undefined}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    {isPromoting ? IMPORT_REVIEW_LOADING.promoting : ui.promoteButtonLabel}
                </button>
                <button
                    type="button"
                    onClick={() => void handleVerify()}
                    disabled={!canVerify}
                    title={
                        canVerify
                            ? "Checks core rows for promoted publish items only"
                            : "Promote at least one item before verifying"
                    }
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                    {isVerifying ? IMPORT_REVIEW_LOADING.verifying : "Verify promotion"}
                </button>
                {derivedStatus !== status && validation ? (
                    <span className="text-xs text-gray-500">
                        derived: <PromotionStatusBadge value={derivedStatus} />
                    </span>
                ) : null}
                {isPromoting ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.promoting} />
                ) : null}
                {isVerifying ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.verifying} />
                ) : null}
            </div>

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}
            {promoteDisabledReason && !canPromote && !isPromoting ? (
                <ImportReviewStatusBanner message={promoteDisabledReason} tone="warning" compact />
            ) : null}

            {(isPromoting || (progress?.workflow === "promotion" && percent > 0)) && (
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>
                            {progress?.current_stage_label ?? "Promotion"}
                            {progress?.current_entity_family
                                ? ` · ${progress.current_entity_family}`
                                : ""}
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
                <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-900">Promotion run summary</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <CountCard
                            label="Promoted"
                            value={promotionResult.promoted_count ?? promotionResult.success_count}
                            tone="success"
                        />
                        <CountCard
                            label="Left blocked (skipped)"
                            value={promotionResult.skipped_blocked_count ?? 0}
                            tone="warning"
                        />
                        <CountCard
                            label="Warnings skipped"
                            value={promotionResult.skipped_warning_count ?? 0}
                        />
                        <CountCard label="Failed" value={promotionResult.failed_count} tone="error" />
                        <CountCard label="Inserted" value={promotionResult.inserted_count} />
                        <CountCard label="Updated" value={promotionResult.updated_count} />
                        <CountCard label="Core verified" value={promotionResult.core_verified_count} />
                        <CountCard
                            label="Candidates marked"
                            value={promotionResult.import_review_marked_promoted_count}
                        />
                    </div>
                    {promotionResult.promoted_entity_families.length > 0 ? (
                        <p className="text-xs text-gray-600">
                            Families:{" "}
                            {promotionResult.promoted_entity_families
                                .map((f) => publishEntityFamilyLabel(f))
                                .join(", ")}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {summaryMessage && !isPromoting ? (
                <p
                    className={`rounded-md border px-3 py-2 text-sm ${
                        isInvalidEmptyPromoted
                            ? "border-red-200 bg-red-50 text-red-900"
                            : promotionResult?.status === "promoted" ||
                                promotionResult?.status === "partially_promoted"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                >
                    {summaryMessage}
                </p>
            ) : null}

            {promotionResult && !isPromoting && (promotionResult.failed_count ?? 0) > 0 ? (
                <ImportReviewPromotionFailedItemsPanel
                    batchId={batchId}
                    failedCount={promotionResult.failed_count}
                    sampleFailures={promotionResult.sample_failures}
                />
            ) : null}

            {showPromotionLogs ? (
                <ImportReviewOperationLogPanel
                    title="Promotion stages"
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                    entries={sortPromotionStageLogs(filterPromotionStageLogs(logs!.items)).map((item) => ({
                        id: item.id,
                        label: item.stage_label,
                        message: item.message,
                        status: item.stage_status,
                        at: item.started_at,
                    }))}
                />
            ) : isPromoting ? (
                <ImportReviewOperationLogPanel
                    title="Promotion stages"
                    entries={[]}
                    isLoading
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                />
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
                    <p className="mt-1 text-xs text-gray-600">
                        Checks {verify.publish_items.success.toLocaleString()} promoted publish item
                        {verify.publish_items.success === 1 ? "" : "s"} only. Pending blocked items (
                        {verify.publish_items.pending.toLocaleString()}) are excluded.
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        <li>
                            Promoted items — success: {verify.publish_items.success}, failed:{" "}
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
                        <h3 className="text-lg font-semibold text-gray-900">{ui.promoteButtonLabel}</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            Only publish items with validation status ready (or warning with confirmation)
                            are promoted. Blocked items stay in import-review.
                        </p>
                        {validation ? (
                            <ul className="mt-3 space-y-1 text-sm text-gray-700">
                                <li>Ready at validation: {ui.readyCount.toLocaleString()}</li>
                                <li>Ready to promote now: {ui.currentPromotableCount.toLocaleString()}</li>
                                <li>Warnings: {ui.warningCount.toLocaleString()}</li>
                                <li>Blocked (skipped): {ui.blockedCount.toLocaleString()}</li>
                                {ui.publishItemFailedCount > 0 ? (
                                    <li>Already failed: {ui.publishItemFailedCount.toLocaleString()}</li>
                                ) : null}
                                {validation.promotable_entity_families.length > 0 ? (
                                    <li>
                                        Families:{" "}
                                        {validation.promotable_entity_families.join(", ")}
                                    </li>
                                ) : null}
                            </ul>
                        ) : null}
                        {requiresWarningNote ? (
                            <>
                                <p className="mt-4 text-sm text-amber-900">
                                    Enter a confirmation note to include warning items in this run.
                                </p>
                                <textarea
                                    value={warningNote}
                                    onChange={(e) => setWarningNote(e.target.value)}
                                    rows={3}
                                    className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
                                    placeholder="Promotion note (required for warnings)"
                                />
                            </>
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
                                disabled={!canConfirmPromote}
                                onClick={() => void handlePromote()}
                                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                Confirm promote
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {sourceReviewBatchId && blockedDrawerFamily ? (
                <ImportReviewPromotionEligibilityDetailsDrawer
                    open={blockedDrawerOpen}
                    onClose={() => setBlockedDrawerOpen(false)}
                    reviewBatchId={sourceReviewBatchId}
                    family={blockedDrawerFamily}
                    familyLabel={publishEntityFamilyLabel(blockedDrawerFamily)}
                    bucket="blocked"
                    includeWarnings={false}
                    formatError={formatError}
                />
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
