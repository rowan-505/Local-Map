"use client";

import { useEffect, useId, useRef } from "react";

import {
    formatVariantDirectionSummary,
    type RouteDirectionSwapPair,
} from "./routeDirectionSwap";

/**
 * Confirms swapping direction_id metadata between the route's two active
 * variants. Stop order and geometry on each variant stay unchanged.
 */
export default function SwapRouteDirectionDialog({
    open,
    pair,
    routeCode,
    routeMode,
    isBusy,
    error,
    onConfirm,
    onCancel,
}: {
    readonly open: boolean;
    readonly pair: RouteDirectionSwapPair | null;
    readonly routeCode: string;
    readonly routeMode: string;
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
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !isBusy) {
                onCancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, isBusy, onCancel]);

    if (!open || !pair) {
        return null;
    }
    const canonicalYbs = routeMode === "bus" && routeCode.startsWith("YBS-");

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
                className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <h3 id={titleId} className="text-sm font-semibold text-gray-900">
                    Swap direction assignments
                </h3>
                <p className="mt-1 text-xs text-gray-600">
                    Route <span className="font-medium">{routeCode}</span>. Swaps the direction
                    assignment between the two route variants. Stops and route paths remain on
                    their existing physical variants.
                    {canonicalYbs ? " D0/D1 do not imply geographic direction." : ""}
                </p>

                <dl className="mt-3 space-y-2 text-xs">
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                        <dt className="font-medium text-gray-700">
                            {canonicalYbs ? "D0 (now)" : "Direction 0 (now)"}
                        </dt>
                        <dd className="mt-0.5 text-gray-900">
                            {formatVariantDirectionSummary(pair.direction0)}
                        </dd>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                        <dt className="font-medium text-gray-700">
                            {canonicalYbs ? "D1 (now)" : "Direction 1 (now)"}
                        </dt>
                        <dd className="mt-0.5 text-gray-900">
                            {formatVariantDirectionSummary(pair.direction1)}
                        </dd>
                    </div>
                </dl>

                {error ? (
                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                        {error}
                    </p>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={isBusy}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isBusy}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                    >
                        {isBusy ? "Swapping…" : "Swap assignments"}
                    </button>
                </div>
            </div>
        </div>
    );
}
