import type {
    InsertExistingRouteStopBody,
    TransportRouteStopItem,
    TransportRouteStopMutationResult,
} from "./types";

export type CandidateRouteStopInsertPosition = "before" | "after";

/** Build the existing insert-existing request around a route_stop occurrence anchor. */
export function buildCandidateRouteStopInsertBody(
    stopPublicId: string,
    anchorRouteStopId: string,
    position: CandidateRouteStopInsertPosition,
): InsertExistingRouteStopBody {
    return {
        stopPublicId,
        position,
        anchorRouteStopId,
    };
}

/**
 * Find the inserted route_stop occurrence exposed by the returned ordered list.
 * Physical stops may occur more than once, so identity is determined by the new
 * route_stop id and only then checked against the candidate public id.
 */
export function findInsertedCandidateRouteStopId(
    result: TransportRouteStopMutationResult,
    previousStops: readonly TransportRouteStopItem[],
    candidateStopPublicId: string,
): string | null {
    if (!Array.isArray(result.ordered_stops)) {
        return null;
    }
    const previousIds = new Set(previousStops.map((stop) => stop.id));
    return (
        result.ordered_stops.find(
            (stop) =>
                !previousIds.has(stop.route_stop_id) &&
                stop.stop_public_id === candidateStopPublicId,
        )?.route_stop_id ?? null
    );
}

export function candidateRouteStopInsertDisabled({
    canWrite,
    busy,
    selectedVariantId,
    selectedRouteStopId,
}: {
    readonly canWrite: boolean;
    readonly busy: boolean;
    readonly selectedVariantId: string | null;
    readonly selectedRouteStopId: string | null;
}): boolean {
    return !canWrite || busy || !selectedVariantId || !selectedRouteStopId;
}
