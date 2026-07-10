import type { InsertStopContext } from "./InsertRouteStopDialog";
import type { TransportRouteStopItem } from "./types";

type InsertStopRef = {
    readonly id: string;
    readonly name: string;
    readonly stop_sequence: number;
};

function stopRef(item: TransportRouteStopItem): InsertStopRef {
    return { id: item.id, name: item.stop.name, stop_sequence: item.stop_sequence };
}

function pointOf(item: TransportRouteStopItem): { lng: number; lat: number } | null {
    const geometry = item.stop.geometry;
    if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
        return null;
    }
    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function midpoint(
    a: { lng: number; lat: number } | null,
    b: { lng: number; lat: number } | null,
): { lng: number; lat: number } | null {
    if (a && b) {
        return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
    }
    return a ?? b ?? null;
}

/** Insert before the first stop (or as the only stop when the list is empty). */
export function buildInsertAtStartContext(
    stops: readonly TransportRouteStopItem[],
): InsertStopContext {
    const first = stops[0] ?? null;
    return {
        uiPosition: stops.length === 0 ? "first" : "start",
        apiPosition: "start",
        anchorRouteStopId: null,
        previousStop: null,
        nextStop: first ? stopRef(first) : null,
        near: first ? pointOf(first) : null,
    };
}

/** Insert after the last stop. */
export function buildInsertAtEndContext(
    stops: readonly TransportRouteStopItem[],
): InsertStopContext {
    const last = stops[stops.length - 1] ?? null;
    return {
        uiPosition: "end",
        apiPosition: "end",
        anchorRouteStopId: null,
        previousStop: last ? stopRef(last) : null,
        nextStop: null,
        near: last ? pointOf(last) : null,
    };
}

/** Insert between `afterStop` and an optional following stop. */
export function buildInsertAfterContext(
    afterStop: TransportRouteStopItem,
    nextStop: TransportRouteStopItem | null,
): InsertStopContext {
    return {
        uiPosition: "between",
        apiPosition: "after",
        anchorRouteStopId: afterStop.id,
        previousStop: stopRef(afterStop),
        nextStop: nextStop ? stopRef(nextStop) : null,
        near: midpoint(pointOf(afterStop), nextStop ? pointOf(nextStop) : null),
    };
}
