"use client";

import { useEffect } from "react";

import { type TransportStopMergeResultOverlayState } from "./stopMergeResultDisplay";

export const MERGE_SUCCESS_VISIBLE_MS = 3_000;

function SuccessOverlay() {
    return (
        <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-lg"
        >
            Stop merged successfully.
        </div>
    );
}

function ErrorOverlay({
    message,
    onDismiss,
}: {
    readonly message: string;
    readonly onDismiss: () => void;
}) {
    return (
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-red-950">Stop merge failed</p>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-900 hover:bg-red-100"
                >
                    Close
                </button>
            </div>
            <p className="mt-2 text-xs text-red-900">{message}</p>
        </div>
    );
}

/**
 * Small reusable overlay for global stop merge success and failure.
 */
export default function TransportStopMergeResultOverlay({
    state,
    onDismiss,
}: {
    readonly state: TransportStopMergeResultOverlayState;
    readonly onDismiss: () => void;
}) {
    useEffect(() => {
        if (state?.kind !== "success") {
            return;
        }
        const timer = window.setTimeout(onDismiss, MERGE_SUCCESS_VISIBLE_MS);
        return () => window.clearTimeout(timer);
    }, [state, onDismiss]);

    if (!state) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-end p-4 sm:items-start sm:justify-end">
            <div className="pointer-events-auto max-h-[85vh] overflow-y-auto">
                {state.kind === "success" ? (
                    <SuccessOverlay />
                ) : (
                    <ErrorOverlay message={state.message} onDismiss={onDismiss} />
                )}
            </div>
        </div>
    );
}
