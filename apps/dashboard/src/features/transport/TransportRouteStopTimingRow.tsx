"use client";

import { useMemo } from "react";

import { LoopClosureBadge } from "./transportReviewUi";
import { getRouteStopRowTimingDisplayFromSchedule } from "./routeStopTimetableDisplay";
import type { VariantTimetableStopSchedule } from "./routeStopTimetableDisplay";
import type { TransportRouteStopItem } from "./types";

export type TransportRouteStopTimingRowProps = {
    readonly stop: TransportRouteStopItem;
    readonly schedule: VariantTimetableStopSchedule;
    readonly selected?: boolean;
    readonly movedUnsaved?: boolean;
    readonly statusText?: string | null;
    readonly distanceFromPrev?: string | null;
};

/**
 * Compact ordered-stop row with unified timing layout for all transport modes.
 */
export default function TransportRouteStopTimingRow({
    stop,
    schedule,
    selected = false,
    movedUnsaved = false,
    statusText = null,
    distanceFromPrev = null,
}: TransportRouteStopTimingRowProps) {
    const nameMm = stop.stop.name_mm?.trim() || "—";
    const nameEn = stop.stop.name_en?.trim() || "—";

    const timing = useMemo(
        () => getRouteStopRowTimingDisplayFromSchedule(stop, schedule),
        [schedule, stop],
    );

    const sequenceClass = movedUnsaved
        ? "text-amber-800"
        : selected
          ? "text-blue-700"
          : "text-gray-500";
    const clockClass = timing.hasClockData ? "font-medium text-gray-700" : "text-gray-400";
    const travelClass = timing.hasTravelData ? "text-gray-500" : "text-gray-400";

    const travelLineExtras: string[] = [];
    if (movedUnsaved && statusText) {
        travelLineExtras.push(statusText);
    } else if (statusText && statusText !== "Saved" && statusText !== "Reviewed") {
        travelLineExtras.push(statusText);
    }
    if (distanceFromPrev) {
        travelLineExtras.push(distanceFromPrev);
    }

    return (
        <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-medium leading-snug text-gray-900">
                    <span className={`tabular-nums ${sequenceClass}`}>#{stop.stop_sequence}</span>{" "}
                    {nameMm}
                    {stop.is_loop_closure ? (
                        <span className="ml-1.5 inline-flex align-middle">
                            <LoopClosureBadge />
                        </span>
                    ) : null}
                </p>
                <p
                    className={`shrink-0 text-right text-[11px] tabular-nums leading-snug ${clockClass}`}
                >
                    {timing.clockTime}
                </p>
            </div>
            <p className="truncate text-xs leading-snug text-gray-500">{nameEn}</p>
            <p className={`truncate text-[11px] leading-snug ${travelClass}`}>
                {timing.travelLabel} travel
                {travelLineExtras.length > 0 ? (
                    <>
                        <span className="text-gray-300"> · </span>
                        <span className={movedUnsaved ? "font-medium text-amber-700" : undefined}>
                            {travelLineExtras.join(" · ")}
                        </span>
                    </>
                ) : null}
            </p>
        </div>
    );
}
