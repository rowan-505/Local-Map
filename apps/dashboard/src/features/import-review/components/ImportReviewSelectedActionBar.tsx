"use client";

import { useState } from "react";

import ImportReviewBulkDecisionResultPanel from "@/src/app/(admin)/import-review/_components/ImportReviewBulkDecisionResultPanel";
import type { ImportReviewBulkDecisionResponse } from "@/src/lib/api";

import type { BulkSelectionAnalysis } from "../utils/bulkSelectionAnalysis";
import type { ImportReviewBulkPhase } from "../hooks/useImportReviewBulkActions";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewProgressMini from "./ImportReviewProgressMini";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";

const btnBase =
    "rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";

export default function ImportReviewSelectedActionBar({
    selectedCount,
    analysis,
    bulkNote,
    bulkBusy,
    bulkPhase,
    bulkMessage,
    canEdit,
    hasValidScope,
    approveBlockedReason,
    bulkPreview,
    dangerForce,
    overrideManualProtected,
    overrideDuplicate,
    showFilterBulkActions,
    onBulkNoteChange,
    onDangerForceChange,
    onOverrideManualProtectedChange,
    onOverrideDuplicateChange,
    onClearSelection,
    onPreviewApprove,
    onApproveSelected,
    onRejectSelected,
    onNeedsMoreReviewSelected,
    onIgnoreSelected,
    onDryRunSafeBulkApprove,
    onRealSafeBulkApprove,
}: {
    selectedCount: number;
    analysis: BulkSelectionAnalysis;
    bulkNote: string;
    bulkBusy: boolean;
    bulkPhase: ImportReviewBulkPhase;
    bulkMessage: string | null;
    canEdit: boolean;
    hasValidScope: boolean;
    approveBlockedReason: string | null;
    bulkPreview: ImportReviewBulkDecisionResponse | null;
    dangerForce: boolean;
    overrideManualProtected: boolean;
    overrideDuplicate: boolean;
    showFilterBulkActions?: boolean;
    onBulkNoteChange: (value: string) => void;
    onDangerForceChange: (value: boolean) => void;
    onOverrideManualProtectedChange: (value: boolean) => void;
    onOverrideDuplicateChange: (value: boolean) => void;
    onClearSelection: () => void;
    onPreviewApprove: () => void;
    onApproveSelected: () => void;
    onRejectSelected: () => void;
    onNeedsMoreReviewSelected: () => void;
    onIgnoreSelected: () => void;
    onDryRunSafeBulkApprove?: () => void;
    onRealSafeBulkApprove?: () => void;
}) {
    const [showAdvanced, setShowAdvanced] = useState(false);

    if (selectedCount <= 0) {
        return null;
    }

    const busyLabel =
        bulkPhase === "previewing"
            ? IMPORT_REVIEW_LOADING.previewingBulkAction
            : bulkPhase === "applying"
              ? IMPORT_REVIEW_LOADING.applyingBulkAction
              : null;

    const bulkProcessed = bulkPreview ? bulkPreview.updated_count + bulkPreview.skipped_count : 0;
    const bulkUpdated = bulkPreview?.updated_count ?? 0;

    const approveDisabled =
        bulkBusy || !canEdit || !hasValidScope || Boolean(approveBlockedReason);

    const otherDecisionDisabled =
        bulkBusy || !canEdit || !hasValidScope || analysis.hasPromoted;

    return (
        <div
            className="sticky top-0 z-20 rounded-xl border border-blue-200 bg-blue-50/90 shadow-md backdrop-blur-sm"
            role="region"
            aria-label="Bulk actions for selected rows"
        >
            <div className="flex flex-wrap items-end gap-3 p-4">
                <div className="min-w-[120px]">
                    <p className="text-sm font-semibold text-gray-900">
                        {selectedCount.toLocaleString()} selected
                    </p>
                    {bulkBusy && busyLabel ? (
                        <ImportReviewInlineSpinner label={busyLabel} className="text-blue-900" />
                    ) : null}
                </div>

                <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Bulk note (optional)</span>
                    <input
                        value={bulkNote}
                        onChange={(e) => onBulkNoteChange(e.target.value)}
                        disabled={!canEdit || bulkBusy}
                        placeholder="Note stored with bulk decision"
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                </label>

                <button
                    type="button"
                    disabled={bulkBusy || !canEdit || !hasValidScope || selectedCount === 0}
                    onClick={onPreviewApprove}
                    className={`${btnBase} border border-gray-300 bg-white text-gray-800`}
                >
                    Preview approve
                </button>
                <button
                    type="button"
                    disabled={approveDisabled}
                    title={approveBlockedReason ?? undefined}
                    onClick={onApproveSelected}
                    className={`${btnBase} bg-emerald-700 text-white hover:bg-emerald-800`}
                >
                    Approve selected
                </button>
                <button
                    type="button"
                    disabled={otherDecisionDisabled}
                    onClick={onRejectSelected}
                    className={`${btnBase} border border-red-200 bg-red-50 text-red-950`}
                >
                    Reject selected
                </button>
                <button
                    type="button"
                    disabled={otherDecisionDisabled}
                    onClick={onNeedsMoreReviewSelected}
                    className={`${btnBase} border border-amber-300 bg-amber-50 text-amber-950`}
                >
                    Needs more review
                </button>
                <button
                    type="button"
                    disabled={otherDecisionDisabled}
                    onClick={onIgnoreSelected}
                    className={`${btnBase} border border-gray-300 bg-gray-100 text-gray-900`}
                >
                    Ignore selected
                </button>
                <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={onClearSelection}
                    className={`${btnBase} border border-gray-300 bg-white text-gray-700`}
                >
                    Clear selection
                </button>
                <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className={`${btnBase} border border-gray-300 bg-white text-xs text-gray-700`}
                >
                    {showAdvanced ? "Hide advanced" : "Advanced / danger…"}
                </button>
            </div>

            {approveBlockedReason && !bulkBusy ? (
                <p className="border-t border-blue-100 px-4 pb-2 text-xs text-amber-900">{approveBlockedReason}</p>
            ) : null}

            {analysis.hasValidationErrors && analysis.validationMessages.length > 0 ? (
                <div className="border-t border-red-100 bg-red-50/80 px-4 py-2 text-xs text-red-950">
                    <span className="font-semibold">Validation errors in selection:</span>
                    <ul className="mt-1 list-disc pl-4">
                        {analysis.validationMessages.slice(0, 5).map((m) => (
                            <li key={m}>{m}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {showAdvanced ? (
                <div className="space-y-3 border-t border-red-100 bg-red-50/40 px-4 py-3">
                    <p className="text-xs font-semibold text-red-950">Danger actions</p>
                    <div className="flex flex-col gap-2 text-sm text-red-950">
                        <label className="flex cursor-pointer items-start gap-2">
                            <input
                                type="checkbox"
                                checked={dangerForce}
                                disabled={!canEdit || bulkBusy}
                                onChange={(e) => onDangerForceChange(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="font-semibold">Force approve</span>
                                <span className="block text-xs font-normal">
                                    Sends force=true on bulk approve (bypasses safe eligibility).
                                </span>
                            </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2">
                            <input
                                type="checkbox"
                                checked={overrideManualProtected}
                                disabled={!canEdit || bulkBusy || !analysis.hasManualProtected}
                                onChange={(e) => onOverrideManualProtectedChange(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="font-semibold">Override manual_protected</span>
                                <span className="block text-xs font-normal">
                                    For manual_protected / protect_manual rows. Requires bulk note + confirm.
                                </span>
                            </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2">
                            <input
                                type="checkbox"
                                checked={overrideDuplicate}
                                disabled={!canEdit || bulkBusy || !analysis.hasDuplicateCandidate}
                                onChange={(e) => onOverrideDuplicateChange(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="font-semibold">Override duplicate_candidate</span>
                                <span className="block text-xs font-normal">
                                    Allows bulk approve on duplicate_candidate rows. Requires bulk note + confirm.
                                </span>
                            </span>
                        </label>
                    </div>
                    {showFilterBulkActions ? (
                        <div className="flex flex-wrap gap-2 border-t border-red-100 pt-2">
                            <button
                                type="button"
                                disabled={bulkBusy || !hasValidScope || !canEdit}
                                onClick={onDryRunSafeBulkApprove}
                                className={`${btnBase} border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs`}
                            >
                                Preview safe filter approve
                            </button>
                            <button
                                type="button"
                                disabled={bulkBusy || !hasValidScope || !canEdit}
                                onClick={onRealSafeBulkApprove}
                                className={`${btnBase} border border-amber-300 bg-amber-50 text-amber-950 text-xs`}
                            >
                                Apply safe filter approve
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {bulkMessage ? (
                <div className="border-t border-blue-100 px-4 py-2">
                    <ImportReviewStatusBanner
                        message={bulkMessage}
                        tone={importReviewMessageTone(bulkMessage)}
                        compact
                    />
                </div>
            ) : null}

            {bulkPreview && bulkProcessed > 0 ? (
                <div className="border-t border-blue-100 px-4 py-2">
                    <ImportReviewProgressMini
                        processed={bulkUpdated}
                        total={bulkProcessed}
                        label="Bulk preview"
                    />
                </div>
            ) : null}

            {bulkPreview ? (
                <div className="border-t border-blue-100 p-4">
                    <ImportReviewBulkDecisionResultPanel result={bulkPreview} />
                </div>
            ) : null}
        </div>
    );
}
