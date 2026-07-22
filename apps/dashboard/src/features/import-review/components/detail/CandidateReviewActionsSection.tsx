"use client";

import type { ImportReviewDecision } from "@/src/lib/api";
import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewEntityConfig } from "../../config/types";
import {
    availableConflictReviewActions,
    comparisonStatusOf,
    hasMatchedCore,
} from "../../utils/conflictReviewActions";
import { IMPORT_REVIEW_SELECT_CLASS } from "../../utils/entityPageUtils";
import { IMPORT_REVIEW_LOADING } from "../../utils/loadingMessages";
import ImportReviewInlineSpinner from "../ImportReviewInlineSpinner";

export default function CandidateReviewActionsSection({
    config,
    row,
    drawerDecision,
    drawerNote,
    isSaving,
    canEdit,
    onDecisionChange,
    onNoteChange,
    onSave,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
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
    const actions = availableConflictReviewActions(row);
    const comparison = comparisonStatusOf(row);
    const matched = hasMatchedCore(row);
    const needsCoreTarget =
        drawerDecision === "mark_duplicate" && !matched;

    const allowed = new Set(actions.map((a) => a.decision));
    const decisionValue = allowed.has(drawerDecision)
        ? drawerDecision
        : (actions[0]?.decision ?? "needs_more_review");

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Review actions
            </h3>
            <p className="text-[11px] text-gray-600">
                Comparison: <span className="font-medium text-gray-800">{comparison || "—"}</span>
                {matched ? (
                    <>
                        {" "}
                        · Matched core{" "}
                        <span className="font-mono text-gray-800">{row.matched_core_id}</span>
                    </>
                ) : (
                    <> · No matched core</>
                )}
            </p>
            {!canEdit ? (
                <p className="text-[11px] font-medium text-amber-950">
                    Read-only — admin role required to change decisions.
                </p>
            ) : null}
            {showDecision ? (
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Decision</span>
                    <select
                        value={decisionValue}
                        disabled={!canEdit || isSaving}
                        onChange={(e) => onDecisionChange(e.target.value as ImportReviewDecision)}
                        className={IMPORT_REVIEW_SELECT_CLASS}
                    >
                        {actions.map((a) => (
                            <option key={a.decision} value={a.decision}>
                                {a.label}
                            </option>
                        ))}
                    </select>
                    <span className="text-[11px] text-gray-500">
                        {actions.find((a) => a.decision === decisionValue)?.description}
                    </span>
                </label>
            ) : null}
            {needsCoreTarget ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                    Mark duplicate needs a matched core target. Open a candidate that already has
                    matched_core_id, or set the core match first.
                </p>
            ) : null}
            {showNote ? (
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">Review note</span>
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
                disabled={isSaving || !canEdit || needsCoreTarget}
                onClick={onSave}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
                Save decision & note
            </button>
        </section>
    );
}
