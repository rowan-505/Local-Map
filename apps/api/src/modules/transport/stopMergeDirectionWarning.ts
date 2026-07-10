import type { TransportStopRouteUsageSummary } from "./transport.types.js";

/** Warn when usage patterns suggest opposite-side stops (not a merge blocker). */
export function hasStopMergeDirectionUsageMismatch(
    current: Pick<
        TransportStopRouteUsageSummary,
        "inboundCount" | "outboundCount" | "clockwiseCount" | "anticlockwiseCount"
    >,
    candidate: Pick<
        TransportStopRouteUsageSummary,
        "inboundCount" | "outboundCount" | "clockwiseCount" | "anticlockwiseCount"
    >,
): boolean {
    const currentInboundOnly =
        current.inboundCount > 0 && current.outboundCount === 0;
    const candidateOutboundOnly =
        candidate.outboundCount > 0 && candidate.inboundCount === 0;
    const currentOutboundOnly =
        current.outboundCount > 0 && current.inboundCount === 0;
    const candidateInboundOnly =
        candidate.inboundCount > 0 && candidate.outboundCount === 0;

    if (
        (currentInboundOnly && candidateOutboundOnly) ||
        (currentOutboundOnly && candidateInboundOnly)
    ) {
        return true;
    }

    const currentClockwiseOnly =
        current.clockwiseCount > 0 && current.anticlockwiseCount === 0;
    const candidateAnticlockwiseOnly =
        candidate.anticlockwiseCount > 0 && candidate.clockwiseCount === 0;
    const currentAnticlockwiseOnly =
        current.anticlockwiseCount > 0 && current.clockwiseCount === 0;
    const candidateClockwiseOnly =
        candidate.clockwiseCount > 0 && candidate.anticlockwiseCount === 0;

    return (
        (currentClockwiseOnly && candidateAnticlockwiseOnly) ||
        (currentAnticlockwiseOnly && candidateClockwiseOnly)
    );
}
