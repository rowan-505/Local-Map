import type { TransportRouteStopItem } from "./types";

export type ReviewMapDetailSource = "route_stop" | "nearby_candidate";

export type ReviewMapLngLat = { readonly lng: number; readonly lat: number };

/** Saved DB geometry from `transport.stops.geom` for a route-stop row. */
export function routeStopSavedGeom(
    routeStop: TransportRouteStopItem | null | undefined,
): ReviewMapLngLat | null {
    if (!routeStop) {
        return null;
    }
    const geometry = routeStop.stop.geometry;
    if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
        return null;
    }
    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return { lng, lat };
}

export function reviewMapPreviewGeomForRouteStop(
    previewByRouteStopId: Readonly<Record<string, ReviewMapLngLat>>,
    routeStopId: string | null | undefined,
): ReviewMapLngLat | null {
    if (!routeStopId) {
        return null;
    }
    return previewByRouteStopId[routeStopId] ?? null;
}

export function deriveReviewMapActiveDetail(input: {
    readonly selectedRouteStopPublicId: string | null;
    readonly selectedNearbyCandidateId: string | null;
}): {
    readonly activeDetailStopId: string | null;
    readonly activeDetailSource: ReviewMapDetailSource | null;
} {
    if (input.selectedNearbyCandidateId) {
        return {
            activeDetailStopId: input.selectedNearbyCandidateId,
            activeDetailSource: "nearby_candidate",
        };
    }
    if (input.selectedRouteStopPublicId) {
        return {
            activeDetailStopId: input.selectedRouteStopPublicId,
            activeDetailSource: "route_stop",
        };
    }
    return { activeDetailStopId: null, activeDetailSource: null };
}
