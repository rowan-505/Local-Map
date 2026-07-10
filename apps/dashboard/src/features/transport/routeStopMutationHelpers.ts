import type {
    TransportOrderedStopLite,
    TransportRouteStopItem,
    TransportRouteStopMutationResult,
} from "./types";

/** Map mutation-response rows into the ordered-stop shape used by the review map. */
export function orderedStopLiteToItem(s: TransportOrderedStopLite): TransportRouteStopItem {
    const geometry =
        s.longitude !== null && s.latitude !== null
            ? { type: "Point" as const, coordinates: [s.longitude, s.latitude] }
            : null;
    return {
        id: s.route_stop_id,
        stop_sequence: s.stop_sequence,
        pickup_type: s.pickup_type,
        drop_off_type: s.drop_off_type,
        is_timing_point: s.is_timing_point,
        distance_from_start_m: null,
        source_time_text: s.source_time_text,
        source_time_type: s.source_time_type,
        travel_time_from_previous_seconds: s.travel_time_from_previous_seconds,
        waiting_time_seconds: s.waiting_time_seconds,
        arrival_offset_seconds: s.arrival_offset_seconds,
        departure_offset_seconds: s.departure_offset_seconds,
        geometry_source: s.geometry_source,
        is_loop_closure: s.is_loop_closure,
        stop: {
            public_id: s.stop_public_id,
            name: s.display_name,
            name_mm: s.name_mm,
            name_en: s.name_en,
            mode: s.mode,
            stop_type: s.stop_type,
            geometry,
            review_status: s.review_status,
        },
    };
}

export type ApplyRouteStopMutationOptions = {
    /** Select this route_stop after applying (e.g. newly created stop). */
    selectRouteStopId?: string | null;
};

export type RouteStopMutationCountsUpdate = {
    orderedStops: TransportRouteStopItem[];
    variantId: string | null;
    stopCountDelta: number;
    nextRouteStopCount: number;
};

/**
 * Pure helper: turn a mutation response into local ordered stops + count delta.
 * Returns null when the response is missing ordered_stops (caller should refetch).
 */
export function buildRouteStopMutationUpdate(
    result: TransportRouteStopMutationResult,
    currentVariantId: string | null,
    currentVariantStopCount: number | undefined,
): RouteStopMutationCountsUpdate | null {
    if (!Array.isArray(result.ordered_stops)) {
        return null;
    }
    const variantId = result.variant_public_id ?? currentVariantId;
    const nextRouteStopCount = result.route_stop_count;
    const stopCountDelta =
        currentVariantStopCount !== undefined
            ? nextRouteStopCount - currentVariantStopCount
            : 0;
    return {
        orderedStops: result.ordered_stops.map(orderedStopLiteToItem),
        variantId,
        stopCountDelta,
        nextRouteStopCount,
    };
}

/** Keep selection when the route_stop still exists; otherwise clear it. */
export function resolveSelectedRouteStopIdAfterMutation(
    previousSelectedId: string | null,
    orderedStops: readonly TransportRouteStopItem[],
    options?: ApplyRouteStopMutationOptions,
): string | null {
    if (options?.selectRouteStopId) {
        return options.selectRouteStopId;
    }
    if (!previousSelectedId) {
        return null;
    }
    return orderedStops.some((stop) => stop.id === previousSelectedId)
        ? previousSelectedId
        : null;
}

/** Validate ordered_stops from a mutation response (gap-free 1..N, unique ids). */
export function isValidOrderedStopsMutationResponse(
    orderedStops: readonly TransportOrderedStopLite[],
    routeStopCount: number,
): boolean {
    if (orderedStops.length !== routeStopCount) {
        return false;
    }
    const seenIds = new Set<string>();
    for (let i = 0; i < orderedStops.length; i++) {
        const stop = orderedStops[i];
        if (seenIds.has(stop.route_stop_id)) {
            return false;
        }
        seenIds.add(stop.route_stop_id);
        if (stop.stop_sequence !== i + 1) {
            return false;
        }
    }
    return true;
}

/** Clear draft moves for route stops that are no longer in the variant. */
export function pruneStopMoveDrafts(
    drafts: Readonly<Record<string, { lng: number; lat: number }>>,
    orderedStops: readonly TransportRouteStopItem[],
): Record<string, { lng: number; lat: number }> {
    const liveIds = new Set(orderedStops.map((stop) => stop.id));
    let changed = false;
    const next: Record<string, { lng: number; lat: number }> = {};
    for (const [id, coords] of Object.entries(drafts)) {
        if (liveIds.has(id)) {
            next[id] = coords;
        } else {
            changed = true;
        }
    }
    return changed ? next : { ...drafts };
}
