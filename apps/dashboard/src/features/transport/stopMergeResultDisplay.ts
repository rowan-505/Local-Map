import type {
    TransportStopMergeGlobalReferenceChanges,
    TransportStopMergeGlobalResult,
    TransportStopMergePreviewStop,
    TransportStopMergeReferenceCounts,
} from "./types";

export const MERGE_NOT_APPLIED_NOTE =
    "The merge was not applied. No stops or references were changed.";

export const MERGE_ROUTE_CODE_PREVIEW_LIMIT = 5;

export function formatMergeStopDisplayName(
    stop: Pick<TransportStopMergePreviewStop, "name" | "nameMy" | "nameEn">,
): string {
    return stop.nameMy?.trim() || stop.nameEn?.trim() || stop.name?.trim() || "Unnamed stop";
}

export function sumStopMergeReferenceUsage(
    counts: TransportStopMergeReferenceCounts,
): number {
    return (
        counts.routeStops +
        counts.variantOrigins +
        counts.variantDestinations +
        counts.terminals +
        counts.faresOrigin +
        counts.faresDestination +
        counts.childStops
    );
}

export function sumStopMergeFareReferences(
    changes: Pick<TransportStopMergeGlobalReferenceChanges, "faresOrigin" | "faresDestination">,
): number {
    return changes.faresOrigin + changes.faresDestination;
}

export type TransportStopMergeResultOverlayState =
    | {
          readonly kind: "success";
          readonly result: TransportStopMergeGlobalResult;
          readonly currentStopPublicId: string;
      }
    | {
          readonly kind: "error";
          readonly message: string;
      }
    | null;
