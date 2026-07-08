"use client";

import { useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportReviewStatusLabel } from "./constants";
import type { RouteReviewReadiness, TransportRoutePath, TransportRouteStopItem } from "./types";

const BTN =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

function isReviewedStatus(status: string | null | undefined): boolean {
    return status === "reviewed" || status === "verified";
}

export type TransportReviewMapReviewActionsProps = {
    readonly selectedStop: TransportRouteStopItem | null;
    readonly path: TransportRoutePath | null;
    readonly routeReviewStatus: string;
    readonly readiness: RouteReviewReadiness | null;
    readonly pathEditActive?: boolean;
    readonly busy?: boolean;
    /** Hide the stop button when the host renders it in a selected-stop area. */
    readonly showStopAction?: boolean;
    readonly onMarkStopReviewed?: () => Promise<void>;
    readonly onMarkPathReviewed?: () => Promise<void>;
    readonly onMarkRouteReviewed?: () => Promise<void>;
};

export default function TransportReviewMapReviewActions({
    selectedStop,
    path,
    routeReviewStatus,
    readiness,
    pathEditActive = false,
    busy = false,
    showStopAction = true,
    onMarkStopReviewed,
    onMarkPathReviewed,
    onMarkRouteReviewed,
}: TransportReviewMapReviewActionsProps) {
    const [actionBusy, setActionBusy] = useState<
        "stop" | "path" | "route" | null
    >(null);
    const [error, setError] = useState("");

    const stopReviewed = isReviewedStatus(selectedStop?.stop.review_status);
    const pathReviewed = isReviewedStatus(path?.review_status ?? null);
    const routeReviewed = isReviewedStatus(routeReviewStatus);

    const stopDisabledReason = !selectedStop
        ? "Select a stop first"
        : pathEditActive
          ? "Exit path edit mode first"
          : stopReviewed
            ? "Stop is already reviewed"
            : undefined;

    const pathDisabledReason = !path?.id
        ? "Selected variant has no route path"
        : pathEditActive
          ? "Exit path edit mode first"
          : pathReviewed
            ? "Path is already reviewed"
            : undefined;

    const routeDisabledReason = routeReviewed
        ? "Route is already reviewed"
        : readiness && !readiness.can_mark_reviewed
          ? readiness.mark_reviewed_blockers[0]
          : undefined;

    const run = async (kind: "stop" | "path" | "route", fn?: () => Promise<void>) => {
        if (!fn) {
            return;
        }
        setError("");
        setActionBusy(kind);
        try {
            await fn();
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }
            setError(err instanceof Error ? err.message : "Review action failed.");
        } finally {
            setActionBusy(null);
        }
    };

    const anyBusy = busy || actionBusy !== null;

    const blockerCount =
        readiness && !routeReviewed ? readiness.mark_reviewed_blockers.length : 0;

    return (
        <div className="border-b border-gray-100 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Review
                </h3>
                <span className="text-[11px] text-gray-400">
                    Route: {transportReviewStatusLabel(routeReviewStatus)}
                </span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                    {showStopAction ? (
                        <button
                            type="button"
                            className={BTN}
                            disabled={anyBusy || Boolean(stopDisabledReason)}
                            title={stopDisabledReason}
                            onClick={() => void run("stop", onMarkStopReviewed)}
                        >
                            {actionBusy === "stop" ? "Saving…" : "Mark stop reviewed"}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={BTN}
                        disabled={anyBusy || Boolean(pathDisabledReason)}
                        title={pathDisabledReason}
                        onClick={() => void run("path", onMarkPathReviewed)}
                    >
                        {actionBusy === "path" ? "Saving…" : "Path reviewed"}
                    </button>
                    <button
                        type="button"
                        className={BTN}
                        disabled={anyBusy || Boolean(routeDisabledReason)}
                        title={routeDisabledReason}
                        onClick={() => void run("route", onMarkRouteReviewed)}
                    >
                        {actionBusy === "route" ? "Saving…" : "Route reviewed"}
                    </button>
                </div>
            </div>
            {blockerCount > 0 ? (
                <p
                    className="mt-1 truncate text-[11px] text-amber-800"
                    title={readiness?.mark_reviewed_blockers.join("\n")}
                >
                    {blockerCount} blocker{blockerCount === 1 ? "" : "s"}:{" "}
                    {readiness?.mark_reviewed_blockers[0]}
                </p>
            ) : null}
            {error ? (
                <p className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
