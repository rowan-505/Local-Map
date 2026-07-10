"use client";

import { useEffect, useId, useRef } from "react";

import {
    formatVariantDirectionSummary,
    type RouteDirectionSwapPair,
} from "./routeDirectionSwap";

/**
 * Confirms swapping inbound/outbound direction metadata between the route's two
 * active variants. Stop order and geometry on each variant stay unchanged.
 */
export default function SwapRouteDirectionDialog({
    open,
    pair,
    routeCode,
    isBusy,
    error,
    onConfirm,
    onCancel,
}: {
    readonly open: boolean;
    readonly pair: RouteDirectionSwapPair | null;
    readonly routeCode: string;
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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
                className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <h3 id={titleId} className="text-sm font-semibold text-gray-900">
                    Change direction
                </h3>
                <p className="mt-1 text-xs text-gray-600">
                    Swap inbound/outbound labels for route{" "}
                    <span className="font-medium">{routeCode}</span>. Stop order and geometry on
                    each variant stay the same.
                </p>

                <dl className="mt-3 space-y-2 text-xs">
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                        <dt className="font-medium text-gray-700">Outbound (now)</dt>
                        <dd className="mt-0.5 text-gray-900">
                            {formatVariantDirectionSummary(pair.outbound)}
                        </dd>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
                        <dt className="font-medium text-gray-700">Inbound (now)</dt>
                        <dd className="mt-0.5 text-gray-900">
                            {formatVariantDirectionSummary(pair.inbound)}
                        </dd>
                    </div>
                </dl>

                <p className="mt-3 text-xs text-gray-600">
                    After swap, variant codes and direction metadata exchange (-A/-B, outbound ↔
                    inbound).
                </p>

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
                        {isBusy ? "Swapping…" : "Swap direction"}
                    </button>
                </div>
            </div>
        </div>
    );
}
