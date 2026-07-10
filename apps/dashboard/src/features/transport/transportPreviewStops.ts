import type { TransportPreviewStop } from "./TransportPreviewMap";
import type { TransportRouteStopItem, TransportStopDetail } from "./types";

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
            name: s.is_loop_closure ? `${s.stop.name} (Loop closure)` : s.stop.name,
        });
    }
    return out;
}

/** Overlay unsaved map-click position onto one route-stop preview point. */
export function applyRouteStopPreviewCoords(
    stops: readonly TransportPreviewStop[],
    routeStopId: string | null,
    preview: { readonly lng: number; readonly lat: number } | null | undefined,
): TransportPreviewStop[] {
    if (!routeStopId || !preview) {
        return [...stops];
    }
    return stops.map((stop) =>
        stop.id === routeStopId
            ? { ...stop, lng: preview.lng, lat: preview.lat, moved: true }
            : stop,
    );
}

/** Apply a saved stop location PATCH to the ordered route-stop row locally. */
export function applyStopLocationDetailToRouteStops(
    stops: readonly TransportRouteStopItem[],
    routeStopId: string,
    stopDetail: TransportStopDetail,
): TransportRouteStopItem[] {
    return stops.map((row) =>
        row.id === routeStopId
            ? {
                  ...row,
                  stop: {
                      ...row.stop,
                      name: stopDetail.name,
                      name_mm: stopDetail.name_mm,
                      name_en: stopDetail.name_en,
                      geometry: stopDetail.geometry,
                      review_status: stopDetail.review_status,
                  },
              }
            : row,
    );
}
