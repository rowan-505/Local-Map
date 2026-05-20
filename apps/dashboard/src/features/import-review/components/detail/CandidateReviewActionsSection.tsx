"use client";

import type { ImportReviewDecision } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../../config/types";
import { IMPORT_REVIEW_SELECT_CLASS } from "../../utils/entityPageUtils";
import { IMPORT_REVIEW_LOADING } from "../../utils/loadingMessages";
import ImportReviewInlineSpinner from "../ImportReviewInlineSpinner";

export default function CandidateReviewActionsSection({
    config,
    drawerDecision,
    drawerNote,
    isSaving,
    canEdit,
    onDecisionChange,
    onNoteChange,
    onSave,
}: {
    config: ImportReviewEntityConfig;
    drawerDecision: ImportReviewDecision;
    drawerNote: string;
    isSaving: boolean;
    canEdit: boolean;
    onDecisionChange: (value: ImportReviewDecision) => void;
    onNoteChange: (value: string) => void;
    onSave: () => void;
}) {
    const showDecision = config.reviewEditableFields.includes("review_decision");
    const showNote = config.reviewEditableFields.includes("review_note");

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Review actions</h3>
            {!canEdit ? (
                <p className="text-[11px] font-medium text-amber-950">
                    Read-only — admin role required to change decisions.
                </p>
            ) : null}
            <p className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
                Threaded review comments are not wired yet; use review_note below.
            </p>
            {showDecision ? (
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Decision</span>
                    <select
                        value={drawerDecision}
                        disabled={!canEdit || isSaving}
                        onChange={(e) => onDecisionChange(e.target.value as ImportReviewDecision)}
                        className={IMPORT_REVIEW_SELECT_CLASS}
                    >
                        <option value="needs_more_review">needs_more_review</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                        <option value="ignored">ignored</option>
                        <option value="merged">merged</option>
                    </select>
                </label>
            ) : null}
            {showNote ? (
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">review_note</span>
                    <textarea
                        value={drawerNote}
                        disabled={!canEdit || isSaving}
                        onChange={(e) => onNoteChange(e.target.value)}
                        rows={4}
                        className={IMPORT_REVIEW_SELECT_CLASS}
                    />
                </label>
            ) : null}
            {isSaving ? (
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.applyingDecision} size="md" />
            ) : null}
            <button
                type="button"
                disabled={isSaving || !canEdit}
                onClick={onSave}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
                Save decision & note
            </button>
        </section>
    );
}
