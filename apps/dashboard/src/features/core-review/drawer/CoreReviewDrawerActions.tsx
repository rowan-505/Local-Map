"use client";

import type { CoreReviewDrawerMode } from "./types";

export type CoreReviewDrawerActionsProps = {
    mode: CoreReviewDrawerMode;
    canEdit: boolean;
    isSaving: boolean;
    formDisabled?: boolean;
    saveError?: string | null;
    saveStageLabel?: string | null;
    onEnterEdit: () => void;
    onCancel: () => void;
    onSave: () => void;
};

const btnSecondary =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const btnPrimary =
    "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";

export default function CoreReviewDrawerActions({
    mode,
    canEdit,
    isSaving,
    formDisabled = false,
    saveError,
    saveStageLabel,
    onEnterEdit,
    onCancel,
    onSave,
}: CoreReviewDrawerActionsProps) {
    if (mode === "view" && canEdit) {
        return (
            <button type="button" onClick={onEnterEdit} className={btnSecondary}>
                Edit
            </button>
        );
    }

    if (mode === "edit") {
        return (
            <div className="flex max-w-xs flex-col items-end gap-1.5">
                {isSaving && saveStageLabel ? (
                    <p className="text-xs text-slate-500">{saveStageLabel}</p>
                ) : null}
                {saveError ? (
                    <p className="whitespace-pre-wrap text-right text-xs text-red-700">{saveError}</p>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={onCancel} disabled={isSaving} className={btnSecondary}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={isSaving || formDisabled}
                        className={btnPrimary}
                    >
                        {isSaving ? "Saving…" : "Save changes"}
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
