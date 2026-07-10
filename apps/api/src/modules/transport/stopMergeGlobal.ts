import type { TransportStopMergeReferenceCounts } from "./transport.types.js";

export type StopMergeGlobalReferenceChanges = {
    routeStops: number;
    variantOrigins: number;
    variantDestinations: number;
    terminals: number;
    faresOrigin: number;
    faresDestination: number;
    childStops: number;
    stopNames: number;
    sourceLinks: number;
};

export function emptyStopMergeReferenceChanges(): StopMergeGlobalReferenceChanges {
    return {
        routeStops: 0,
        variantOrigins: 0,
        variantDestinations: 0,
        terminals: 0,
        faresOrigin: 0,
        faresDestination: 0,
        childStops: 0,
        stopNames: 0,
        sourceLinks: 0,
    };
}

export function sumStopMergeReferenceCounts(
    counts: TransportStopMergeReferenceCounts,
): number {
    return (
        counts.routeStops +
        counts.variantOrigins +
        counts.variantDestinations +
        counts.terminals +
        counts.faresOrigin +
        counts.faresDestination +
        counts.childStops +
        counts.stopNames +
        counts.sourceLinks
    );
}
