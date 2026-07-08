import type { TransportRouteStopItem } from "./types";

export type GeneratePathFromStopsReadiness = {
    eligible: boolean;
    reasons: string[];
};

function stopHasGeometry(stop: TransportRouteStopItem): boolean {
    const g = stop.stop.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
        return false;
    }
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    return Number.isFinite(lng) && Number.isFinite(lat);
}

/** True when stop_sequence is 1..N with no gaps (list is already ordered). */
export function isStopSequenceContinuous(stops: readonly TransportRouteStopItem[]): boolean {
    if (stops.length < 2) {
        return false;
    }
    for (let i = 0; i < stops.length; i++) {
        if (stops[i]?.stop_sequence !== i + 1) {
            return false;
        }
    }
    return true;
}

export function evaluateGeneratePathFromStopsReadiness(
    stops: readonly TransportRouteStopItem[],
    hasUnsavedStopMoves: boolean,
): GeneratePathFromStopsReadiness {
    const reasons: string[] = [];

    if (stops.length < 2) {
        reasons.push("Select a variant with at least 2 stops.");
    }
    if (stops.length >= 2 && stops.some((s) => !stopHasGeometry(s))) {
        reasons.push("Every stop must have a saved location.");
    }
    if (stops.length >= 2 && !isStopSequenceContinuous(stops)) {
        reasons.push("Stop sequence must be continuous (1, 2, 3, …).");
    }
    if (hasUnsavedStopMoves) {
        reasons.push("Save or revert stop changes first.");
    }

    return { eligible: reasons.length === 0, reasons };
}
