"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Confirmation dialog for permanently deleting a stop record. The backend hard-deletes
 * the stop plus related stop_names and source_links when no references remain.
 */
export default function PermanentDeleteStopDialog({
    open,
    stopName,
    isBusy,
    error,
    onConfirm,
    onCancel,
}: {
    readonly open: boolean;
    readonly stopName: string;
    readonly isBusy?: boolean;
    readonly error?: string;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        cancelRef.current?.focus();
    }, [open]);

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
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
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
                    Delete {stopName ? `"${stopName}"` : "stop"} permanently?
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                    This permanently removes the stop and its localized names and source links.
                    This cannot be undone.
                </p>

                {error ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

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
                        {isBusy ? "Deleting…" : "Delete permanently"}
                    </button>
                </div>
            </div>
        </div>
    );
}
