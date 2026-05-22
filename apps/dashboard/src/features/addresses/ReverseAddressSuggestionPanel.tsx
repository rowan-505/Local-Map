"use client";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import type { ReverseAddressDebugResponse } from "./reverseAddress.types";
import {
    confidencePercentLabel,
    isLowConfidenceReverse,
    reversePanelToneClass,
    reverseResultTypeLabel,
} from "./reverseAddressUi";

function dash(value: string | null | undefined): string {
    return value?.trim() ? value : "—";
}

function MatchedIdsList({ matched }: { matched: ReverseAddressDebugResponse["matched"] }) {
    const entries: Array<[string, string | null]> = [
        ["Address", matched.address_id],
        ["Building", matched.building_id],
        ["Place", matched.place_id],
        ["Street", matched.street_id],
        ["Admin area", matched.admin_area_id],
    ];
    const any = entries.some(([, v]) => v);
    if (!any) {
        return <p className="text-xs text-gray-500">No core entity ids matched at this point.</p>;
    }
    return (
        <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {entries.map(([label, id]) =>
                id ? (
                    <div key={label}>
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="font-mono text-gray-800">{id}</dd>
                    </div>
                ) : null
            )}
        </dl>
    );
}

export default function ReverseAddressSuggestionPanel({
    data,
    loading,
    error,
    canApply,
    onApplySuggested,
    showDebug = true,
}: {
    data: ReverseAddressDebugResponse | null;
    loading: boolean;
    error: string;
    canApply: boolean;
    onApplySuggested: () => void;
    showDebug?: boolean;
}) {
    if (loading) {
        return (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
                <ImportReviewInlineSpinner label="Resolving possible address…" />
            </section>
        );
    }

    if (error) {
        return (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <p className="font-medium">Reverse address lookup failed</p>
                <p className="mt-1 text-xs">{error}</p>
            </section>
        );
    }

    if (!data) {
        return (
            <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-xs text-gray-600">
                Click the map to load a possible address from core data.
            </section>
        );
    }

    const lowConfidence = isLowConfidenceReverse(data.confidence_score);
    const panelClass = reversePanelToneClass(data.confidence_score, data.result_type);

    return (
        <section className={`space-y-3 rounded-xl border p-4 ${panelClass}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                        Possible address
                    </h3>
                    <p className="mt-0.5 text-sm font-medium text-gray-900">
                        {reverseResultTypeLabel(data.result_type)}
                        {lowConfidence ? (
                            <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                                Low confidence
                            </span>
                        ) : null}
                    </p>
                    <p className="text-xs text-gray-600">
                        Confidence {confidencePercentLabel(data.confidence_score)}
                    </p>
                </div>
                {canApply ? (
                    <button
                        type="button"
                        onClick={onApplySuggested}
                        className="rounded-lg border border-gray-800 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-gray-50"
                    >
                        Use suggested components
                    </button>
                ) : null}
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                    <span className="text-xs font-medium text-gray-600">English</span>
                    <p className="text-gray-900">{dash(data.full_address_en)}</p>
                </div>
                <div>
                    <span className="text-xs font-medium text-gray-600">Myanmar</span>
                    <p className="text-gray-900">{dash(data.full_address_my)}</p>
                </div>
            </div>
            {data.display_address ? (
                <p className="text-xs text-gray-700">
                    <span className="font-medium">Display:</span> {data.display_address}
                </p>
            ) : null}

            {data.warnings.length > 0 ? (
                <ul className="list-disc space-y-1 pl-4 text-xs text-amber-950">
                    {data.warnings.map((w, i) => (
                        <li key={`${i}-${w.slice(0, 24)}`}>{w}</li>
                    ))}
                </ul>
            ) : null}

            <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">Suggested components</h4>
                <div className="overflow-x-auto rounded border border-white/60 bg-white/70">
                    <table className="w-full min-w-[480px] text-left text-xs">
                        <thead className="border-b text-gray-500">
                            <tr>
                                <th className="px-2 py-1">Type</th>
                                <th className="px-2 py-1">Value</th>
                                <th className="px-2 py-1">Lang</th>
                                <th className="px-2 py-1">Source</th>
                                <th className="px-2 py-1">Match</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.components.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-2 py-3 text-gray-500">
                                        No components returned.
                                    </td>
                                </tr>
                            ) : (
                                data.components.map((c, i) => (
                                    <tr key={`${c.component_type}-${c.language_code}-${i}`} className="border-t">
                                        <td className="px-2 py-1 font-mono">{c.component_type}</td>
                                        <td className="px-2 py-1">{c.value}</td>
                                        <td className="px-2 py-1">{c.language_code}</td>
                                        <td className="px-2 py-1 text-gray-600">{c.source}</td>
                                        <td className="px-2 py-1 text-gray-600">
                                            {c.match_type ?? "—"}
                                            {c.address_usage === "locality_hint" ? " · hint" : ""}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">Matched entities</h4>
                <MatchedIdsList matched={data.matched} />
            </div>

            {showDebug && data.debug ? (
                <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer font-medium text-gray-700">Debug</summary>
                    <p className="mt-1 font-mono">
                        {data.debug.decision_reason} @ {data.debug.lat.toFixed(6)}, {data.debug.lng.toFixed(6)}
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/80 p-2 text-[10px]">
                        {JSON.stringify(data.debug.layers, null, 2)}
                    </pre>
                </details>
            ) : null}

            <p className="text-[10px] text-gray-500">
                Full address lines are generated from components after save — do not type full_address manually.
            </p>
        </section>
    );
}
