"use client";

import { useEffect, useId, useRef } from "react";

const TEXTAREA_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-60";

/**
 * Confirmation dialog for archiving (soft-deleting) an actual stop record, with an
 * optional free-text reason. Archiving sets deleted_at + is_active = false on the
 * backend; it never hard-deletes and never removes route history or source records.
 * Only reachable from Stop Detail when the stop is unused by routes.
 */
export default function ArchiveStopDialog({
    open,
    stopName,
    reason,
    isBusy,
    error,
    onReasonChange,
    onConfirm,
    onCancel,
}: {
    readonly open: boolean;
    readonly stopName: string;
    readonly reason: string;
    readonly isBusy?: boolean;
    readonly error?: string;
    readonly onReasonChange: (value: string) => void;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);

    // Default focus to Cancel (destructive action), but ONLY when the dialog
    // opens. This must not depend on isBusy/onCancel: the reason textarea is
    // controlled by parent state, so every keystroke re-renders this component
    // with a new inline onCancel — re-running focus here would steal focus back
    // to Cancel after a single character.
    useEffect(() => {
        if (!open) {
            return;
        }
        cancelRef.current?.focus();
    }, [open]);

    // Escape-to-close, kept separate so it can track the latest isBusy/onCancel
    // without re-triggering the focus effect above.
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !isBusy) {
                onCancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, isBusy, onCancel]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!isBusy) {
                    onCancel();
                }
            }}
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                    Archive {stopName ? `"${stopName}"` : "stop"}?
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                    This archives the stop record. It will no longer appear as an active stop. This
                    action does not remove route history or source records.
                </p>

                {error ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                <label className="mt-4 flex flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        Reason / note (optional)
                    </span>
                    <textarea
                        className={TEXTAREA_CLASS}
                        rows={3}
                        value={reason}
                        disabled={isBusy}
                        placeholder="Why is this stop being archived? (recorded in the audit log)"
                        onChange={(e) => onReasonChange(e.target.value)}
                    />
                </label>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        disabled={isBusy}
                        onClick={onCancel}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={onConfirm}
                        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
                    >
                        {isBusy ? "Archiving…" : "Archive stop"}
                    </button>
                </div>
            </div>
        </div>
    );
}
