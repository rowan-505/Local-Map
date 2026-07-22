"use client";

import { useState } from "react";

import ImportReviewBulkDecisionResultPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBulkDecisionResultPanel";
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
    bulkPreview,
    onBulkNoteChange,
    onClearSelection,
    onKeepExistingSelected,
    onNeedsMoreReviewSelected,
    onIgnoreImportedSelected,
}: {
    selectedCount: number;
    analysis: BulkSelectionAnalysis;
    bulkNote: string;
    bulkBusy: boolean;
    bulkPhase: ImportReviewBulkPhase;
    bulkMessage: string | null;
    canEdit: boolean;
    hasValidScope: boolean;
    bulkPreview: ImportReviewBulkDecisionResponse | null;
    onBulkNoteChange: (value: string) => void;
    onClearSelection: () => void;
    onKeepExistingSelected: () => void;
    onNeedsMoreReviewSelected: () => void;
    onIgnoreImportedSelected: () => void;
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

    const decisionDisabled = bulkBusy || !canEdit || !hasValidScope || analysis.hasPromoted;

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
                    disabled={decisionDisabled}
                    onClick={onKeepExistingSelected}
                    className={`${btnBase} border border-gray-300 bg-white text-gray-900`}
                >
                    Keep existing
                </button>
                <button
                    type="button"
                    disabled={decisionDisabled}
                    onClick={onNeedsMoreReviewSelected}
                    className={`${btnBase} border border-amber-300 bg-amber-50 text-amber-950`}
                >
                    Needs more review
                </button>
                <button
                    type="button"
                    disabled={decisionDisabled}
                    onClick={onIgnoreImportedSelected}
                    className={`${btnBase} border border-gray-300 bg-gray-100 text-gray-900`}
                >
                    Ignore imported
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
                    {showAdvanced ? "Hide note" : "About bulk…"}
                </button>
            </div>

            {analysis.hasPromoted ? (
                <p className="border-t border-blue-100 px-4 pb-2 text-xs text-amber-900">
                    Selection includes applied rows. Clear them before bulk decisions.
                </p>
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
                <div className="border-t border-blue-100 px-4 py-3 text-xs text-gray-700">
                    Bulk actions set the same decision on every selected conflict. Use the detail
                    drawer for replace, merge, insert separately, mark duplicate, or soft delete.
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
