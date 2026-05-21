"use client";

import { useEffect, useId, useRef } from "react";

export default function CoreReviewConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    confirmTone = "danger",
    isBusy,
    onConfirm,
    onCancel,
}: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    confirmTone?: "danger" | "restore";
    isBusy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const titleId = useId();
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        confirmRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onCancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onCancel]);

    if (!open) {
        return null;
    }

    const confirmClass =
        confirmTone === "restore"
            ? "bg-emerald-700 text-white hover:bg-emerald-800"
            : "bg-red-700 text-white hover:bg-red-800";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={onCancel}
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                    {title}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{description}</p>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={onCancel}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        disabled={isBusy}
                        onClick={onConfirm}
                        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${confirmClass}`}
                    >
                        {isBusy ? "Working…" : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
