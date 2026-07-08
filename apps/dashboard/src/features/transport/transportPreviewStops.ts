import type { TransportPreviewStop } from "./TransportPreviewMap";
import type { TransportRouteStopItem } from "./types";

/** Saved stop geometry → map preview points (no move drafts). */
export function routeStopItemsToPreviewStops(
    stops: readonly TransportRouteStopItem[],
): TransportPreviewStop[] {
    const out: TransportPreviewStop[] = [];
    for (const s of stops) {
        const g = s.stop.geometry;
        if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
            continue;
        }
        const lng = Number(g.coordinates[0]);
        const lat = Number(g.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            continue;
        }
        out.push({
            id: s.id,
            lng,
            lat,
            sequence: s.stop_sequence,
            name: s.stop.name,
        });
    }
    return out;
}
