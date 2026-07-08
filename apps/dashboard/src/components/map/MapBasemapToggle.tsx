"use client";

import type { DataReviewBasemapMode } from "./dataReviewBasemap";

const TABS = [
    { id: "map" as const, label: "Map" },
    { id: "satellite" as const, label: "Sat" },
    { id: "hybrid" as const, label: "Hyb" },
] as const;

export type MapBasemapToggleProps = {
    readonly value: DataReviewBasemapMode;
    readonly onChange: (mode: DataReviewBasemapMode) => void;
    readonly disabled?: boolean;
    readonly satelliteAvailable?: boolean;
    readonly className?: string;
    /** Visual palette — import review uses gray; core review uses slate. */
    readonly palette?: "import" | "core";
};

export default function MapBasemapToggle({
    value,
    onChange,
    disabled = false,
    satelliteAvailable = true,
    className = "",
    palette = "import",
}: MapBasemapToggleProps) {
    const isCore = palette === "core";
    const tabWrapClass = isCore
        ? "border border-slate-200 bg-white"
        : "border border-gray-200 bg-white";
    const tabActiveClass = isCore ? "bg-slate-800 text-white" : "bg-gray-900 text-white";
    const tabIdleClass = isCore
        ? "text-slate-600 hover:bg-slate-50"
        : "text-gray-600 hover:bg-gray-50";
    const tabDisabledClass = isCore
        ? "cursor-not-allowed text-slate-300"
        : "cursor-not-allowed text-gray-300";

    return (
        <div
            className={`flex items-center rounded p-0.5 ${tabWrapClass} ${className}`.trim()}
            role="group"
            aria-label="Basemap mode"
        >
            {TABS.map((tab) => {
                const imageryTab = tab.id !== "map";
                const tabDisabled =
                    disabled || (imageryTab && !satelliteAvailable);
                const title =
                    imageryTab && !satelliteAvailable
                        ? "Satellite tiles not configured"
                        : undefined;

                return (
                    <button
                        key={tab.id}
                        type="button"
                        disabled={tabDisabled}
                        title={title}
                        onClick={() => onChange(tab.id)}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            tabDisabled
                                ? tabDisabledClass
                                : value === tab.id
                                  ? tabActiveClass
                                  : tabIdleClass
                        }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
