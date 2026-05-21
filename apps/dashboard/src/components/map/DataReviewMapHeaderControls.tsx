"use client";

import type { DataReviewBasemapMode } from "./dataReviewBasemap";
import {
    MAP_PREVIEW_CARD_HEADER_CLASS,
    MAP_PREVIEW_CARD_HEADER_CORE_CLASS,
} from "./mapPreviewUi";

export type MapHeaderPalette = "import" | "core";

export type DataReviewMapHeaderControlsProps = {
    title: string;
    externalId?: string | null;
    subtitle?: string | null;
    hasRenderable: boolean;
    onFit: () => void;
    /** Defaults to "Fit". Core review uses geometry-specific labels (e.g. "Fit to polygon"). */
    fitButtonLabel?: string;
    basemapMode: DataReviewBasemapMode;
    onBasemapModeChange: (mode: DataReviewBasemapMode) => void;
    /** When false, hides the vertices checkbox (e.g. street editor has its own handles). */
    showVerticesToggle?: boolean;
    showVertices?: boolean;
    onShowVerticesChange?: (on: boolean) => void;
    palette?: MapHeaderPalette;
};

export default function DataReviewMapHeaderControls({
    title,
    externalId = null,
    subtitle,
    hasRenderable,
    onFit,
    fitButtonLabel = "Fit",
    basemapMode,
    onBasemapModeChange,
    showVerticesToggle = false,
    showVertices = false,
    onShowVerticesChange,
    palette = "import",
}: DataReviewMapHeaderControlsProps) {
    const idLine = externalId?.trim() ? externalId.trim() : null;
    const headerSubtitle = subtitle?.trim() ? subtitle : null;
    const isCore = palette === "core";

    const headerClass = isCore ? MAP_PREVIEW_CARD_HEADER_CORE_CLASS : MAP_PREVIEW_CARD_HEADER_CLASS;
    const titleClass = isCore ? "text-slate-900" : "text-gray-900";
    const metaClass = isCore ? "text-slate-500" : "text-gray-500";
    const fitEnabledClass = isCore
        ? "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
        : "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100";
    const fitDisabledClass = isCore
        ? "border-slate-200 bg-slate-50 text-slate-400"
        : "border-gray-200 bg-gray-50 text-gray-400";
    const tabWrapClass = isCore
        ? "border border-slate-200 bg-white"
        : "border border-gray-200 bg-white";
    const tabActiveClass = isCore ? "bg-slate-800 text-white" : "bg-gray-900 text-white";
    const tabIdleClass = isCore
        ? "text-slate-600 hover:bg-slate-50"
        : "text-gray-600 hover:bg-gray-50";
    const checkboxClass = isCore ? "border-slate-300" : "border-gray-300";
    const labelClass = isCore ? "text-slate-600" : "text-gray-600";

    return (
        <div
            className={`${headerClass} flex flex-nowrap items-center gap-2 py-2 pl-2 pr-1`}
        >
            <div className="min-w-0 flex-1">
                <h3 className={`truncate text-xs font-semibold ${titleClass}`}>{title}</h3>
                {idLine ? (
                    <p className={`truncate font-mono text-[10px] ${metaClass}`} title={idLine}>
                        {idLine}
                    </p>
                ) : null}
                {headerSubtitle && !idLine ? (
                    <p className={`truncate text-[10px] ${metaClass}`}>{headerSubtitle}</p>
                ) : null}
            </div>
            <button
                type="button"
                disabled={!hasRenderable}
                onClick={onFit}
                title="Fit map to geometry"
                className={`shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold ${
                    hasRenderable ? fitEnabledClass : `cursor-not-allowed ${fitDisabledClass}`
                }`}
            >
                {fitButtonLabel}
            </button>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
                {showVerticesToggle && onShowVerticesChange ? (
                    <label
                        className={`flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] ${labelClass}`}
                    >
                        <input
                            type="checkbox"
                            className={`h-3 w-3 rounded ${checkboxClass}`}
                            checked={showVertices}
                            onChange={(e) => onShowVerticesChange(e.target.checked)}
                        />
                        Show vertices
                    </label>
                ) : null}
                <div className={`flex items-center rounded p-0.5 ${tabWrapClass}`}>
                    {(
                        [
                            { id: "map" as const, label: "Map" },
                            { id: "satellite" as const, label: "Sat" },
                            { id: "hybrid" as const, label: "Hyb" },
                        ] as const
                    ).map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => onBasemapModeChange(tab.id)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                basemapMode === tab.id ? tabActiveClass : tabIdleClass
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
