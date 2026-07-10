"use client";

import { useState } from "react";

import {
    formatMergeStopDisplayName,
    MERGE_ROUTE_CODE_PREVIEW_LIMIT,
    sumStopMergeFareReferences,
    sumStopMergeReferenceUsage,
    type TransportStopMergeResultOverlayState,
} from "./stopMergeResultDisplay";

function CountRow({ label, value }: { readonly label: string; readonly value: number }) {
    return (
        <div className="flex justify-between gap-3 text-xs">
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-medium text-gray-900">{value}</dd>
        </div>
    );
}

function RouteCodeList({ routeCodes }: { readonly routeCodes: readonly string[] }) {
    const [expanded, setExpanded] = useState(false);
    if (routeCodes.length === 0) {
        return <p className="text-xs text-gray-500">None</p>;
    }

    const visible = expanded
        ? routeCodes
        : routeCodes.slice(0, MERGE_ROUTE_CODE_PREVIEW_LIMIT);
    const hiddenCount = routeCodes.length - MERGE_ROUTE_CODE_PREVIEW_LIMIT;

    return (
        <div>
            <p className="text-xs text-gray-800">{visible.join(", ")}</p>
            {!expanded && hiddenCount > 0 ? (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="mt-1 text-xs font-medium text-gray-700 underline hover:text-gray-900"
                >
                    More ({hiddenCount})
                </button>
            ) : null}
        </div>
    );
}

function SuccessOverlay({
    result,
    onDismiss,
}: {
    readonly result: Extract<TransportStopMergeResultOverlayState, { kind: "success" }>;
    readonly onDismiss: () => void;
}) {
    const { referencesChanged, counts } = result.result;
    const currentIsCanonical =
        result.currentStopPublicId === result.result.canonicalStop.publicId;
    const currentBefore = sumStopMergeReferenceUsage(
        currentIsCanonical ? counts.canonicalBefore : counts.duplicateBefore,
    );
    const duplicateBefore = sumStopMergeReferenceUsage(
        currentIsCanonical ? counts.duplicateBefore : counts.canonicalBefore,
    );
    const canonicalAfter = sumStopMergeReferenceUsage(counts.canonicalAfter);
    const duplicateAfter = sumStopMergeReferenceUsage(counts.duplicateAfter);

    return (
        <div className="w-full max-w-md rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-emerald-950">Stop merged successfully</p>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                >
                    Close
                </button>
            </div>

            <div className="mt-3 space-y-3 text-xs text-emerald-950">
                <div>
                    <p className="font-semibold uppercase tracking-wide text-emerald-800">Kept</p>
                    <p className="mt-1 font-mono text-[11px]">{result.result.canonicalStop.publicId}</p>
                    <p className="mt-0.5 font-medium">
                        {formatMergeStopDisplayName(result.result.canonicalStop)}
                    </p>
                </div>

                <div>
                    <p className="font-semibold uppercase tracking-wide text-emerald-800">
                        Deleted duplicate
                    </p>
                    <p className="mt-1 font-mono text-[11px]">{result.result.deletedStop.publicId}</p>
                    <p className="mt-0.5 font-medium">
                        {formatMergeStopDisplayName(result.result.deletedStop)}
                    </p>
                </div>

                <div>
                    <p className="font-semibold uppercase tracking-wide text-emerald-800">
                        References changed
                    </p>
                    <dl className="mt-1 space-y-0.5">
                        <CountRow label="Route memberships" value={referencesChanged.routeStops} />
                        <CountRow label="Variant origins" value={referencesChanged.variantOrigins} />
                        <CountRow
                            label="Variant destinations"
                            value={referencesChanged.variantDestinations}
                        />
                        <CountRow label="Terminals" value={referencesChanged.terminals} />
                        <CountRow label="Fares" value={sumStopMergeFareReferences(referencesChanged)} />
                        <CountRow label="Child stops" value={referencesChanged.childStops} />
                    </dl>
                </div>

                <div>
                    <p className="font-semibold uppercase tracking-wide text-emerald-800">
                        Affected routes
                    </p>
                    <div className="mt-1">
                        <RouteCodeList routeCodes={result.result.affectedRouteCodes} />
                    </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-emerald-200 bg-white/70 p-2">
                        <p className="font-semibold text-emerald-800">Before</p>
                        <dl className="mt-1 space-y-0.5">
                            <CountRow label="Current usage" value={currentBefore} />
                            <CountRow label="Duplicate usage" value={duplicateBefore} />
                        </dl>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-white/70 p-2">
                        <p className="font-semibold text-emerald-800">After</p>
                        <dl className="mt-1 space-y-0.5">
                            <CountRow label="Canonical usage" value={canonicalAfter} />
                            <CountRow label="Duplicate references" value={duplicateAfter} />
                        </dl>
                    </div>
                </div>
            </div>
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
    if (!state) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-end p-4 sm:items-start sm:justify-end">
            <div className="pointer-events-auto max-h-[85vh] overflow-y-auto">
                {state.kind === "success" ? (
                    <SuccessOverlay result={state} onDismiss={onDismiss} />
                ) : (
                    <ErrorOverlay message={state.message} onDismiss={onDismiss} />
                )}
            </div>
        </div>
    );
}
