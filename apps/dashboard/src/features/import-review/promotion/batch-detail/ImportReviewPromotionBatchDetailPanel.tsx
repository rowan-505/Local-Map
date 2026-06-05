"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    PublishEntityFamilyLabel,
    PromotionStatusBadge,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import ImportReviewPromotionFailedItemsPanel from "@/src/features/import-review/promotion/ImportReviewPromotionFailedItemsPanel";
import {
    evaluatePublishBatchLimits,
    type PublishBatchLimitsConfirmationState,
} from "@/src/features/import-review/promotion/batchLimits";
import { formatImportReviewPromotionError } from "@/src/features/import-review/promotion/formatPromotionError";
import { shouldPollPublishBatchDetail } from "@/src/features/import-review/promotion/publishBatchDetailPolling";
import {
    dryRunResultFromApiResponse,
    normalizePublishBatchLifecycleStatus,
    resolvePublishBatchSimpleCounts,
} from "@/src/features/import-review/promotion/publishBatchSimpleFlow";
import {
    nextPublishBatchPollDelayMs,
    PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS,
    PUBLISH_BATCH_POOLER_WARNING,
} from "@/src/features/import-review/promotion/publishBatchPolling";
import { sortPromotionStageLogs } from "@/src/features/import-review/promotion/promotionStageLogs";
import {
    batchValidationCompleteForPromotion,
} from "@/src/features/import-review/utils/promotionPromoteUiState";
import {
    getPublishBatchPromoteGate,
    isHighRiskPromoteBatch,
    isLargePromoteBatch,
    logPublishBatchPromoteGateDebug,
} from "@/src/features/import-review/promotion/publishBatchPromoteGate";
import {
    buildWorkflowResumableActions,
    getBatchWorkflowState,
    isPartialPromotionCompleted,
    publishBatchWorkflowExhaustedMessage,
    publishBatchWorkflowStatusLabel,
    type PublishBatchWorkflowCounts,
} from "@/src/features/import-review/promotion/publishBatchWorkflowUi";
import {
    isPublishBatchClosedForReuse,
} from "@/src/features/import-review/promotion/publishBatchLifecycle";
import { publishBatchClosedFailureMessage } from "@/src/features/import-review/promotion/publishBatchValidationFailure";
import { promotionPromoteUiState } from "@/src/features/import-review/utils/promotionPromoteUiState";
import {
    getImportReviewPromotionBatchById,
    getImportReviewPromotionBatchLogs,
    getImportReviewPromotionBatchProgress,
    getImportReviewPromotionBatchVerify,
    isAbortError,
    postImportReviewPromotionBatchCancelPromotion,
    postImportReviewPromotionBatchCancelValidation,
    postImportReviewPromotionBatchDryRun,
    postImportReviewPromotionBatchPromote,
    postImportReviewPromotionBatchResetPromotion,
    postImportReviewPromotionBatchResetValidation,
    postImportReviewPromotionBatchResume,
    postImportReviewPromotionBatchRetryFailedReady,
    postImportReviewPromotionBatchValidate,
    type ImportReviewPublishBatchDetail,
    type ImportReviewPublishBatchDryRunResponse,
    type ImportReviewPublishBatchProgressResponse,
    type ImportReviewPublishBatchVerifyResponse,
} from "@/src/lib/api";

import { ImportReviewPromotionBatchActionsBar, type PublishBatchDetailBusyKey } from "./ImportReviewPromotionBatchActionsBar";
import { ImportReviewPromotionBatchProgressSections } from "./ImportReviewPromotionBatchProgressSections";
import { ImportReviewPromotionBatchStatusCard } from "./ImportReviewPromotionBatchStatusCard";
import { ImportReviewPromotionBlockedItemsPanel } from "./ImportReviewPromotionBlockedItemsPanel";

type Props = {
    batchId: string;
    batchDetail: ImportReviewPublishBatchDetail;
    families: string[];
    onBatchUpdated: (detail: ImportReviewPublishBatchDetail) => void;
};

function CountTile({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</p>
        </div>
    );
}

export function ImportReviewPromotionBatchDetailPanel({
    batchId,
    batchDetail,
    families,
    onBatchUpdated,
}: Props) {
    const router = useRouter();
    const [status, setStatus] = useState(batchDetail.status);
    const [progress, setProgress] = useState<ImportReviewPublishBatchProgressResponse | null>(null);
    const [dryRun, setDryRun] = useState<ImportReviewPublishBatchDryRunResponse | null>(null);
    const [verifyResult, setVerifyResult] = useState<ImportReviewPublishBatchVerifyResponse | null>(null);
    const [logs, setLogs] = useState<Awaited<ReturnType<typeof getImportReviewPromotionBatchLogs>> | null>(
        null
    );
    const [busy, setBusy] = useState<PublishBatchDetailBusyKey>(null);
    const [limitsConfirmation, setLimitsConfirmation] =
        useState<PublishBatchLimitsConfirmationState>({
            confirmLargeBatch: false,
            allowHighRiskFamilies: false,
            mixedHighRiskConfirm: false,
        });
    const [error, setError] = useState<string | null>(null);
    const [pollWarning, setPollWarning] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollErrorsRef = useRef(0);

    const lifecycleStatus = normalizePublishBatchLifecycleStatus(status);
    const apiResumableActions = progress?.resumable_actions ?? [];

    const counts = useMemo(() => {
        const vr = progress?.validation_result;
        const itemCounts = progress?.publish_item_status_counts;
        return resolvePublishBatchSimpleCounts({
            totalItems: batchDetail.item_counts.total,
            validationReady: vr?.ready_count ?? vr?.valid_count,
            validationBlocked: vr?.blocked_count,
            publishPending: itemCounts?.pending,
            publishFailed: itemCounts?.failed,
            publishPromoted: itemCounts?.success,
            currentPromotable: progress?.current_promotable_count,
        });
    }, [batchDetail.item_counts.total, progress]);

    const workflowCounts: PublishBatchWorkflowCounts = useMemo(
        () => ({
            actualPromotable: counts.actualPromotable,
            publishPending: counts.publishPending,
            publishPromoted: counts.publishPromoted,
            publishFailed: counts.publishFailed,
        }),
        [counts]
    );

    const hasRoadItems = families.includes("roads");
    const roadsItemCount = batchDetail.item_counts_by_entity_family?.roads?.total ?? 0;
    const dryRunSummary = progress?.dry_run_result ?? dryRunResultFromApiResponse(dryRun) ?? null;

    const validation = progress?.validation_result ?? null;
    const validationComplete = batchValidationCompleteForPromotion({
        validatedAt: progress?.validated_at,
        validationPercent: progress?.validation_percent,
        validation,
    });

    const workflowState = useMemo(
        () =>
            getBatchWorkflowState({
                batch: { status },
                summary: dryRunSummary ? { dry_run_result: dryRunSummary } : undefined,
                families,
                counts: workflowCounts,
                validation,
                validationComplete,
                inFlight: lifecycleStatus === "validating" || lifecycleStatus === "promoting",
            }),
        [
            status,
            dryRunSummary,
            families,
            workflowCounts,
            validation,
            validationComplete,
            lifecycleStatus,
        ]
    );

    const resumableActions = useMemo(() => {
        const actions = buildWorkflowResumableActions(apiResumableActions, workflowState);
        if (
            !actions.includes("promote") &&
            workflowState.dryRunPassed &&
            counts.actualPromotable > 0 &&
            !isPublishBatchClosedForReuse(lifecycleStatus)
        ) {
            return [...actions, "promote"];
        }
        return actions;
    }, [apiResumableActions, workflowState, counts.actualPromotable, lifecycleStatus]);

    const promoteUi = useMemo(
        () =>
            promotionPromoteUiState({
                batchStatus: status,
                workflowBlocked: isPublishBatchClosedForReuse(lifecycleStatus),
                validatedAt: progress?.validated_at,
                validationPercent: progress?.validation_percent,
                validation,
                currentPromotableCount: progress?.current_promotable_count,
                validationPromotableCount: progress?.validation_promotable_count,
                publishItemStatus: progress?.publish_item_status_counts,
                failedReadyRetryCount: progress?.failed_ready_retry_count,
                promotionStatus: progress?.promotion_status,
                roadPromotionGates: progress?.road_promotion_gates,
                dryRunResult: dryRunSummary,
                hasRoadItems,
                roadsItemCount,
                entityFamilies: families,
            }),
        [status, lifecycleStatus, workflowCounts, progress, dryRunSummary, hasRoadItems, roadsItemCount, families, validation]
    );

    const partialPromotionCompleted = isPartialPromotionCompleted(workflowCounts);
    const batchClosed = isPublishBatchClosedForReuse(lifecycleStatus);
    const closedMessage = batchClosed
        ? publishBatchClosedFailureMessage({
              batchStatus: lifecycleStatus,
              validationSystemFailure: promoteUi.validationSystemFailure,
          })
        : null;
    const workflowStatusLabel = publishBatchWorkflowStatusLabel({
        lifecycleStatus,
        counts: workflowCounts,
    });
    const canCreateRetryBatch =
        promoteUi.canCreateRetryBatch && Boolean(batchDetail.source_review_batch_id);

    const polling = shouldPollPublishBatchDetail(progress, lifecycleStatus);

    const refreshDetail = useCallback(async () => {
        const detail = await getImportReviewPromotionBatchById(batchId);
        setStatus(detail.status);
        onBatchUpdated(detail);
        return detail;
    }, [batchId, onBatchUpdated]);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollOnce = useCallback(async (): Promise<boolean> => {
        const p = await getImportReviewPromotionBatchProgress(batchId);
        setProgress(p);
        setStatus(p.status);
        pollErrorsRef.current = 0;
        setPollWarning(null);
        const cont = shouldPollPublishBatchDetail(p, normalizePublishBatchLifecycleStatus(p.status));
        if (!cont) {
            stopPolling();
            await refreshDetail();
            return false;
        }
        return true;
    }, [batchId, refreshDetail, stopPolling]);

    const schedulePoll = useCallback(() => {
        const delay = nextPublishBatchPollDelayMs({
            consecutiveErrors: pollErrorsRef.current,
            heartbeatStaleWarning:
                progress?.validation_heartbeat_stale_warning ||
                progress?.promotion_heartbeat_stale_warning,
        });
        pollRef.current = setTimeout(() => {
            void pollOnce()
                .then((cont) => {
                    if (cont) {
                        schedulePoll();
                    }
                })
                .catch((err) => {
                    if (isAbortError(err)) {
                        return;
                    }
                    pollErrorsRef.current += 1;
                    setPollWarning(formatImportReviewPromotionError(err));
                    if (pollErrorsRef.current >= PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS) {
                        setPollWarning(PUBLISH_BATCH_POOLER_WARNING);
                        stopPolling();
                        return;
                    }
                    schedulePoll();
                });
        }, delay);
    }, [pollOnce, stopPolling, progress]);

    const startPolling = useCallback(() => {
        stopPolling();
        pollErrorsRef.current = 0;
        void pollOnce().then((cont) => {
            if (cont) {
                schedulePoll();
            }
        });
    }, [pollOnce, schedulePoll, stopPolling]);

    useEffect(() => {
        setStatus(batchDetail.status);
    }, [batchDetail.status]);

    useEffect(() => {
        const controller = new AbortController();
        void getImportReviewPromotionBatchProgress(batchId, { signal: controller.signal })
            .then(setProgress)
            .catch((err) => {
                if (!isAbortError(err)) {
                    setError(formatImportReviewPromotionError(err));
                }
            });
        return () => controller.abort();
    }, [batchId]);

    useEffect(() => {
        if (polling) {
            startPolling();
            return () => stopPolling();
        }
        stopPolling();
        return undefined;
    }, [polling, startPolling, stopPolling]);

    const batchTotalItems = batchDetail.item_counts.total;
    const limitsEvaluation = useMemo(
        () =>
            evaluatePublishBatchLimits({
                families,
                totalItems: batchTotalItems,
                confirmation: limitsConfirmation,
            }),
        [families, batchTotalItems, limitsConfirmation]
    );

    const showHighRiskConfirm =
        limitsEvaluation.needsHighRiskConfirm || isHighRiskPromoteBatch(families);
    const showLargeBatchConfirm =
        limitsEvaluation.needsLargeBatchConfirm ||
        isLargePromoteBatch(counts.actualPromotable, batchTotalItems);

    const promoteGateInput = useMemo(
        () => ({
            batchId,
            status,
            validationPercent: progress?.validation_percent ?? 0,
            dryRunResult: dryRunSummary,
            promotableNow: counts.actualPromotable,
            totalItems: batchTotalItems,
            families,
            busy: busy != null,
            highRiskConfirmed: limitsConfirmation.allowHighRiskFamilies,
            largeBatchConfirmed: limitsConfirmation.confirmLargeBatch,
        }),
        [
            batchId,
            status,
            progress?.validation_percent,
            dryRunSummary,
            counts.actualPromotable,
            batchTotalItems,
            families,
            busy,
            limitsConfirmation.allowHighRiskFamilies,
            limitsConfirmation.confirmLargeBatch,
        ]
    );

    const promoteGate = useMemo(
        () => getPublishBatchPromoteGate(promoteGateInput),
        [promoteGateInput]
    );

    useEffect(() => {
        logPublishBatchPromoteGateDebug(promoteGateInput, promoteGate);
    }, [promoteGateInput, promoteGate]);

    const validateEnabled =
        busy === null && limitsEvaluation.canProceed && workflowState.canValidate;

    const dryRunEnabled =
        busy === null &&
        (workflowState.canDryRun ||
            workflowState.dryRunIsRerun ||
            resumableActions.includes("resume_dry_run"));

    const workflowBlockedReason = closedMessage
        ? closedMessage
        : partialPromotionCompleted
          ? publishBatchWorkflowExhaustedMessage(workflowCounts)
          : promoteUi.exhaustedBatchMessage;

    const partialSummary =
        lifecycleStatus === "partial" || promoteUi.blockedCount > 0
            ? `${promoteUi.readyCount.toLocaleString()} ready, ${promoteUi.blockedCount.toLocaleString()} blocked`
            : null;

    const sampleErrors = dryRun?.sample_errors ?? [];

    async function runAction(key: PublishBatchDetailBusyKey, fn: () => Promise<unknown>) {
        setBusy(key);
        setError(null);
        try {
            await fn();
            const p = await getImportReviewPromotionBatchProgress(batchId);
            setProgress(p);
            setStatus(p.status);
            if (shouldPollPublishBatchDetail(p, normalizePublishBatchLifecycleStatus(p.status))) {
                startPolling();
            } else {
                await refreshDetail();
            }
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setBusy(null);
        }
    }

    async function handleValidate() {
        await runAction("validate", () =>
            postImportReviewPromotionBatchValidate(batchId, {
                confirm_large_batch: limitsConfirmation.confirmLargeBatch,
                allow_high_risk_families: limitsConfirmation.allowHighRiskFamilies,
                mixed_high_risk_confirm: limitsConfirmation.mixedHighRiskConfirm,
            })
        );
    }

    async function handleDryRun() {
        setBusy("dry-run");
        setError(null);
        try {
            const result = await postImportReviewPromotionBatchDryRun(batchId, {});
            setDryRun(result);
            const optimisticDryRun = dryRunResultFromApiResponse(result);
            if (optimisticDryRun) {
                setProgress((prev) => (prev ? { ...prev, dry_run_result: optimisticDryRun } : prev));
            }
            if (result.status === "failed") {
                setError(
                    result.summary?.message ??
                        result.sample_errors[0]?.message ??
                        "Dry-run failed."
                );
            }
            const p = await getImportReviewPromotionBatchProgress(batchId);
            setProgress(p);
            setStatus(p.status);
            await refreshDetail();
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setBusy(null);
        }
    }

    async function handlePromote() {
        await runAction("promote", () =>
            postImportReviewPromotionBatchPromote(batchId, {
                confirmation_text: "PROMOTE",
                chunk_size: 100,
                allow_high_risk_families: limitsConfirmation.allowHighRiskFamilies,
                confirm_large_batch: limitsConfirmation.confirmLargeBatch,
            })
        );
    }

    async function handleResume() {
        await runAction("resume", () => postImportReviewPromotionBatchResume(batchId));
    }

    async function handleCreateRetryBatch() {
        if (!canCreateRetryBatch || !batchDetail.source_review_batch_id) {
            return;
        }
        setBusy("retry");
        setError(null);
        try {
            const result = await postImportReviewPromotionBatchRetryFailedReady(batchId, {});
            const newBatchId = String(result.id ?? result.publish_batch_id ?? result.batch_id);
            router.push(
                `/dashboard/import-review/promotion/${encodeURIComponent(newBatchId)}?review_batch_id=${encodeURIComponent(batchDetail.source_review_batch_id)}`
            );
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setBusy(null);
        }
    }

    async function handleVerify() {
        setBusy("verify");
        setError(null);
        try {
            const result = await getImportReviewPromotionBatchVerify(batchId);
            setVerifyResult(result);
            const p = await getImportReviewPromotionBatchProgress(batchId);
            setProgress(p);
        } catch (err) {
            setError(formatImportReviewPromotionError(err));
        } finally {
            setBusy(null);
        }
    }

    async function loadLogs() {
        try {
            const l = await getImportReviewPromotionBatchLogs(batchId);
            setLogs(l);
        } catch (err) {
            if (!isAbortError(err)) {
                setPollWarning(formatImportReviewPromotionError(err));
            }
        }
    }

    return (
        <div className="space-y-4">
            <ImportReviewPromotionBatchStatusCard
                batchDetail={batchDetail}
                progress={progress}
                workflowStatusLabel={workflowStatusLabel}
                polling={polling}
            />

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-gray-500">
                    {families.map((f) => (
                        <span key={f} className="mr-2 inline-block">
                            <PublishEntityFamilyLabel family={f} />
                        </span>
                    ))}
                    {" · "}
                    {batchDetail.item_counts.total.toLocaleString()} items
                    {batchDetail.source_review_batch_id
                        ? ` · review batch ${batchDetail.source_review_batch_id}`
                        : ""}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <CountTile label="Validation ready" value={counts.validationReady} />
                    <CountTile label="Validation blocked" value={counts.validationBlocked} />
                    <CountTile label="Publish pending" value={counts.publishPending} />
                    <CountTile label="Promoted" value={counts.publishPromoted} />
                    <CountTile label="Failed" value={counts.publishFailed} />
                    <CountTile label="Promotable now" value={counts.actualPromotable} />
                </div>
            </section>

            {partialSummary ? (
                <ImportReviewStatusBanner
                    message={partialSummary}
                    tone="info"
                    compact
                />
            ) : null}

            {promoteUi.blockedWarningMessage ? (
                <ImportReviewStatusBanner message={promoteUi.blockedWarningMessage} tone="warning" compact />
            ) : null}

            {promoteUi.roadBulkUx?.sqlBulkWarning ? (
                <ImportReviewStatusBanner
                    message={promoteUi.roadBulkUx.sqlBulkWarning}
                    tone="warning"
                    compact
                />
            ) : null}

            {workflowBlockedReason ? (
                <ImportReviewStatusBanner
                    message={workflowBlockedReason}
                    tone={partialPromotionCompleted || batchClosed ? "warning" : "info"}
                    compact
                />
            ) : null}

            {workflowState.message && !workflowBlockedReason ? (
                <ImportReviewStatusBanner
                    message={workflowState.message}
                    tone={workflowState.dryRunPassed ? "success" : "info"}
                    compact
                />
            ) : null}

            {promoteUi.publishItemSuccessCount > 0 ? (
                <p className="text-sm text-gray-700">
                    <PromotionStatusBadge value="promoted" />{" "}
                    {promoteUi.publishItemSuccessCount.toLocaleString()} item
                    {promoteUi.publishItemSuccessCount === 1 ? "" : "s"} promoted to core.
                </p>
            ) : null}

            <ImportReviewPromotionBatchProgressSections progress={progress} verifyResult={verifyResult} />

            <ImportReviewPromotionBlockedItemsPanel
                batchId={batchId}
                blockedCount={promoteUi.blockedCount}
            />

            {promoteUi.publishItemFailedCount > 0 ? (
                <ImportReviewPromotionFailedItemsPanel
                    batchId={batchId}
                    failedCount={promoteUi.publishItemFailedCount}
                    sampleFailures={progress?.promotion_result?.sample_failures}
                    failurePhase={
                        promoteUi.validationSystemFailure ? "validation" : "promotion"
                    }
                />
            ) : null}

            {sampleErrors.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    {sampleErrors.slice(0, 10).map((e, index) => (
                        <li key={`${e.candidate_id ?? "item"}-${e.code}-${index}`} className="mt-1 first:mt-0">
                            <span className="font-mono text-xs">{e.code}</span>
                            {e.external_id ? (
                                <span className="font-mono text-xs text-gray-600"> ({e.external_id})</span>
                            ) : null}
                            : {e.message}
                        </li>
                    ))}
                </ul>
            ) : null}

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}
            {pollWarning ? <ImportReviewStatusBanner message={pollWarning} tone="warning" compact /> : null}

            {showHighRiskConfirm || showLargeBatchConfirm || limitsEvaluation.needsMixedHighRiskConfirm ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    {showHighRiskConfirm ? (
                        <label className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                className="mt-0.5 rounded border-gray-300"
                                checked={limitsConfirmation.allowHighRiskFamilies}
                                onChange={(e) =>
                                    setLimitsConfirmation((prev) => ({
                                        ...prev,
                                        allowHighRiskFamilies: e.target.checked,
                                    }))
                                }
                            />
                            <span>I confirm this high-risk batch.</span>
                        </label>
                    ) : null}
                    {showLargeBatchConfirm ? (
                        <label className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                className="mt-0.5 rounded border-gray-300"
                                checked={limitsConfirmation.confirmLargeBatch}
                                onChange={(e) =>
                                    setLimitsConfirmation((prev) => ({
                                        ...prev,
                                        confirmLargeBatch: e.target.checked,
                                    }))
                                }
                            />
                            <span>I confirm this large batch.</span>
                        </label>
                    ) : null}
                    {limitsEvaluation.needsMixedHighRiskConfirm ? (
                        <label className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                className="mt-0.5 rounded border-gray-300"
                                checked={limitsConfirmation.mixedHighRiskConfirm}
                                onChange={(e) =>
                                    setLimitsConfirmation((prev) => ({
                                        ...prev,
                                        mixedHighRiskConfirm: e.target.checked,
                                    }))
                                }
                            />
                            <span>I confirm mixing roads with other entity families.</span>
                        </label>
                    ) : null}
                </div>
            ) : null}

            <ImportReviewPromotionBatchActionsBar
                resumableActions={resumableActions}
                workflowState={workflowState}
                promoteGate={promoteGate}
                busy={busy}
                promoteUi={promoteUi}
                validateEnabled={validateEnabled}
                dryRunEnabled={dryRunEnabled}
                onValidate={() => void handleValidate()}
                onResumeValidation={() => void handleResume()}
                onCancelValidation={() =>
                    void runAction("cancel-validation", () =>
                        postImportReviewPromotionBatchCancelValidation(batchId)
                    )
                }
                onResetValidation={() =>
                    void runAction("reset-validation", () =>
                        postImportReviewPromotionBatchResetValidation(batchId)
                    )
                }
                onDryRun={() => void handleDryRun()}
                onResumeDryRun={() => void handleResume()}
                onPromote={() => void handlePromote()}
                onResumePromotion={() => void handleResume()}
                onCancelPromotion={() =>
                    void runAction("cancel-promotion", () =>
                        postImportReviewPromotionBatchCancelPromotion(batchId)
                    )
                }
                onResetPromotion={() =>
                    void runAction("reset-promotion", () =>
                        postImportReviewPromotionBatchResetPromotion(batchId)
                    )
                }
                onVerify={() => void handleVerify()}
                onRetryBatch={canCreateRetryBatch ? () => void handleCreateRetryBatch() : undefined}
            />

            {promoteUi.retryBatchMessage ? (
                <p className="text-xs text-gray-500">{promoteUi.retryBatchMessage}</p>
            ) : null}

            <details
                className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                onToggle={(e) => {
                    if ((e.target as HTMLDetailsElement).open && !logs) {
                        void loadLogs();
                    }
                }}
            >
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                    Technical logs (debug)
                </summary>
                {logs?.items?.length ? (
                    <ul className="mt-3 space-y-2 text-xs text-gray-600">
                        {sortPromotionStageLogs(logs.items)
                            .slice(-20)
                            .map((item) => (
                                <li key={item.id}>
                                    <span className="font-medium">{item.stage_label}</span> ·{" "}
                                    {item.stage_status} · {item.progress_percent}%
                                    {item.message ? ` — ${item.message}` : ""}
                                </li>
                            ))}
                    </ul>
                ) : (
                    <p className="mt-2 text-xs text-gray-500">Open to load stage logs.</p>
                )}
            </details>
        </div>
    );
}
