"use client";

import type { DataReviewBasemapMode } from "./dataReviewBasemap";
import { MAP_PREVIEW_CARD_HEADER_CLASS } from "./mapPreviewUi";

export type DataReviewMapHeaderControlsProps = {
    title: string;
    externalId?: string | null;
    subtitle?: string | null;
    hasRenderable: boolean;
    onFit: () => void;
    basemapMode: DataReviewBasemapMode;
    onBasemapModeChange: (mode: DataReviewBasemapMode) => void;
    /** When false, hides the vertices checkbox (e.g. street editor has its own handles). */
    showVerticesToggle?: boolean;
    showVertices?: boolean;
    onShowVerticesChange?: (on: boolean) => void;
};

export default function DataReviewMapHeaderControls({
    title,
    externalId = null,
    subtitle,
    hasRenderable,
    onFit,
    basemapMode,
    onBasemapModeChange,
    showVerticesToggle = false,
    showVertices = false,
    onShowVerticesChange,
}: DataReviewMapHeaderControlsProps) {
    const idLine = externalId?.trim() ? externalId.trim() : null;
    const headerSubtitle = subtitle?.trim() ? subtitle : null;

    return (
        <div
            className={`${MAP_PREVIEW_CARD_HEADER_CLASS} flex flex-nowrap items-center gap-2 border-b border-gray-100 py-2 pl-2 pr-1`}
        >
            <div className="min-w-0 flex-1">
                <h3 className="truncate text-xs font-semibold text-gray-900">{title}</h3>
                {idLine ? (
                    <p className="truncate font-mono text-[10px] text-gray-500" title={idLine}>
                        {idLine}
                    </p>
                ) : null}
                {headerSubtitle && !idLine ? (
                    <p className="truncate text-[10px] text-gray-500">{headerSubtitle}</p>
                ) : null}
            </div>
            <button
                type="button"
                disabled={!hasRenderable}
                onClick={onFit}
                title="Fit map to geometry"
                className={`shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold ${
                    hasRenderable
                        ? "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100"
                        : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                }`}
            >
                Fit
            </button>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
                {showVerticesToggle && onShowVerticesChange ? (
                    <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] text-gray-600">
                        <input
                            type="checkbox"
                            className="h-3 w-3 rounded border-gray-300"
                            checked={showVertices}
                            onChange={(e) => onShowVerticesChange(e.target.checked)}
                        />
                        Show vertices
                    </label>
                ) : null}
                <div className="flex items-center rounded border border-gray-200 bg-white p-0.5">
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
                                basemapMode === tab.id
                                    ? "bg-gray-900 text-white"
                                    : "text-gray-600 hover:bg-gray-50"
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
