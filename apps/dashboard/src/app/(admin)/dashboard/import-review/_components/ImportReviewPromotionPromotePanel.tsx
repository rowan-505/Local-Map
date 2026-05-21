"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
    PromotionStatusBadge,
    publishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewOperationLogPanel from "@/src/features/import-review/components/ImportReviewOperationLogPanel";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
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
    type ImportReviewPromotionRoadDryRunResult,
    type ImportReviewPublishStageLogItem,
} from "@/src/lib/api";

const POLL_MS = 1500;

const STAGE_ORDER = [
    "promote_preflight",
    "load_promotable_items",
    "final_validation_before_write",
    "promote_buildings_to_core",
    "promote_places_to_core",
    "promote_landuse_to_core",
    "promote_water_lines_to_core",
    "promote_water_polygons_to_core",
    "promote_bus_stops_to_core",
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
    hasRoadItems?: boolean;
    roadDryRunResult?: ImportReviewPromotionRoadDryRunResult | null;
    onBatchUpdated: (detail: ImportReviewPublishBatchDetail) => void;
    formatError: (err: unknown) => string;
};

export default function ImportReviewPromotionPromotePanel({
    batchId,
    batchStatus,
    hasRoadItems = false,
    roadDryRunResult = null,
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
    const [warningNote, setWarningNote] = useState("");
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
                ...(validationForModal?.requires_warning_confirmation && warningNote.trim()
                    ? {
                          confirm_warnings: true,
                          warning_confirmation_note: warningNote.trim(),
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
    const promotionResult = progress?.promotion_result;
    const validationForModal = progress?.validation_result;
    const requiresWarningNote = validationForModal?.requires_warning_confirmation === true;
    const roadPromotionEnvEnabled =
        roadDryRunResult !== null && roadDryRunResult.disabled_because_env_flag_false === false;
    const roadPromoteBlocked =
        hasRoadItems && (!roadDryRunResult || roadDryRunResult.disabled_because_env_flag_false);
    const canPromote =
        status === "ready" &&
        validationForModal?.can_promote !== false &&
        !roadPromoteBlocked;
    const promoteDisabledReason = roadPromoteBlocked
        ? !roadDryRunResult
            ? "Run road dry-run first. Road batches require routing validation preview before promotion."
            : "Road promotion is disabled until ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true on the API."
        : null;
    const canConfirmPromote =
        confirmText === "PROMOTE" &&
        !isStarting &&
        (!requiresWarningNote || warningNote.trim().length > 0);
    const summaryMessage = isInvalidEmptyPromoted
        ? "This batch was marked promoted but no items were promoted. Treat as failed/invalid and create a new batch."
        : (progress?.promotion_logs_summary ?? progress?.current_message);
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
                    title={promoteDisabledReason ?? undefined}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    {isPromoting ? IMPORT_REVIEW_LOADING.promoting : "Promote to core"}
                </button>
                <button
                    type="button"
                    onClick={() => void handleVerify()}
                    disabled={isVerifying || status === "draft" || status === "validating"}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                    {isVerifying ? IMPORT_REVIEW_LOADING.verifying : "Verify promotion"}
                </button>
                <PromotionStatusBadge value={derivedStatus} />
                {derivedStatus !== status ? (
                    <span className="text-xs text-gray-500">stored: {status}</span>
                ) : null}
                {isPromoting ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.promoting} />
                ) : null}
                {isVerifying ? (
                    <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.verifying} />
                ) : null}
            </div>

            {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}

            {hasRoadItems ? (
                <p className="text-xs text-gray-600">
                    {roadPromotionEnvEnabled
                        ? "Road env flag is enabled on the API. Promote may proceed for non-road families; road core writes are not implemented in this phase."
                        : promoteDisabledReason}
                </p>
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
                    {promotionResult.promoted_entity_families.length > 0 ? (
                        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 sm:col-span-2">
                            <p className="text-xs text-gray-500">Promoted families</p>
                            <p className="text-sm font-medium text-gray-900">
                                {promotionResult.promoted_entity_families
                                    .map((f) => publishEntityFamilyLabel(f))
                                    .join(", ")}
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {summaryMessage && !isPromoting ? (
                <p
                    className={`rounded-md border px-3 py-2 text-sm ${
                        isInvalidEmptyPromoted
                            ? "border-red-200 bg-red-50 text-red-900"
                            : promotionResult?.status === "promoted" &&
                                !promotionResult.partial_success &&
                                promotionResult.success_count > 0
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                >
                    {summaryMessage}
                </p>
            ) : null}

            {showPromotionLogs ? (
                <ImportReviewOperationLogPanel
                    title="Promotion stages"
                    loadingMessage={IMPORT_REVIEW_LOADING.loadingLogs}
                    entries={sortLogs(logs!.items).map((item) => ({
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
                            This will write approved items to core for buildings, places, landuse, water lines,
                            water polygons, and bus stops.
                        </p>
                        {validationForModal ? (
                            <ul className="mt-3 space-y-1 text-sm text-gray-700">
                                <li>Total items: {validationForModal.total_items}</li>
                                <li>Insert: {validationForModal.by_publish_action.insert}</li>
                                <li>Update: {validationForModal.by_publish_action.update}</li>
                                {validationForModal.promotable_entity_families.length > 0 ? (
                                    <li>
                                        Promotable families:{" "}
                                        {validationForModal.promotable_entity_families.join(", ")}
                                    </li>
                                ) : null}
                                {validationForModal.warning_count > 0 ? (
                                    <li className="text-amber-800">
                                        Warnings: {validationForModal.warning_count}
                                    </li>
                                ) : null}
                            </ul>
                        ) : null}
                        {requiresWarningNote ? (
                            <>
                                <p className="mt-4 text-sm text-amber-900">
                                    This batch has validation warnings. Enter a confirmation note explaining why
                                    promotion should proceed. CATEGORY_UNMAPPED means class_code or category_code
                                    could not be mapped to ref.ref_poi_categories.code.
                                </p>
                                <textarea
                                    value={warningNote}
                                    onChange={(e) => setWarningNote(e.target.value)}
                                    rows={3}
                                    className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-sm"
                                    placeholder="Confirmation note (required)"
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
                                    setWarningNote("");
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
