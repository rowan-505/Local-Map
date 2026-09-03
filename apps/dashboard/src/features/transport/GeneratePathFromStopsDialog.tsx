"use client";

import { useEffect, useId, useRef } from "react";

import { generatePathFromStopsCopy } from "./reviewMapPathGeneration";

/**
 * Confirmation before generating or regenerating a road-following path from ordered stops.
 */
export default function GeneratePathFromStopsDialog({
    open,
    hasSavedPath = false,
    isBusy,
    error,
    warnings,
    onConfirm,
    onCancel,
}: {
    readonly open: boolean;
    readonly hasSavedPath?: boolean;
    readonly isBusy?: boolean;
    readonly error?: string;
    readonly warnings?: readonly string[];
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const copy = generatePathFromStopsCopy(hasSavedPath);

    useEffect(() => {
        if (!open) {
            return;
        }
        cancelRef.current?.focus();
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
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!isBusy) {
                    onCancel();
                }
            }}
        >
            <div
                className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className="text-base font-semibold text-gray-900">
                    {copy.dialogTitle}
                </h2>
                <p className="mt-3 text-sm text-gray-600">{copy.dialogBody}</p>

                {error ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {warnings && warnings.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <p className="font-medium">Warnings</p>
                        <ul className="mt-1 list-disc pl-4 text-xs">
                            {warnings.map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={isBusy}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isBusy}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                        {isBusy ? copy.busyLabel : copy.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
