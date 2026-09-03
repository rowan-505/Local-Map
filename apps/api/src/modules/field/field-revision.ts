import { createHash } from "node:crypto";

export type FieldRevisionParts = {
    routeCount: number;
    variantCount: number;
    stopCount: number;
    routeStopCount: number;
    pathCount: number;
    routeStopSequenceSum: number;
    maxRouteStopId: number;
    maxUpdatedAtMs: number;
};

export function snapshotRevisionFromParts(parts: FieldRevisionParts): string {
    const canonical = [
        parts.routeCount,
        parts.variantCount,
        parts.stopCount,
        parts.routeStopCount,
        parts.pathCount,
        parts.routeStopSequenceSum,
        parts.maxRouteStopId,
        parts.maxUpdatedAtMs,
    ].join("|");
    const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    return `v1-${digest}`;
}
