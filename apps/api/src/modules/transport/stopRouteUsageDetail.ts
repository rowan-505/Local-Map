/**
 * Direction bucketing for stop route-usage summaries. Shared by the usage-detail
 * repo mapper and unit tests.
 */
export type StopRouteUsageDirectionInput = {
    readonly variantCode: string;
    readonly directionName: string | null;
    readonly directionId: number | null;
};

export function isAnticlockwiseRouteUsage(input: StopRouteUsageDirectionInput): boolean {
    const code = input.variantCode.toUpperCase();
    if (code.includes("ANTICLOCKWISE")) {
        return true;
    }
    const name = input.directionName?.trim().toLowerCase() ?? "";
    return name === "anticlockwise" || name.includes("anticlockwise");
}

export function isClockwiseRouteUsage(input: StopRouteUsageDirectionInput): boolean {
    if (isAnticlockwiseRouteUsage(input)) {
        return false;
    }
    const code = input.variantCode.toUpperCase();
    if (code.includes("CLOCKWISE")) {
        return true;
    }
    const name = input.directionName?.trim().toLowerCase() ?? "";
    return name === "clockwise";
}

export function isInboundRouteUsage(input: StopRouteUsageDirectionInput): boolean {
    if (input.directionId === 1) {
        return true;
    }
    return input.directionName?.trim().toLowerCase() === "inbound";
}

export function isOutboundRouteUsage(input: StopRouteUsageDirectionInput): boolean {
    if (input.directionId === 0) {
        return true;
    }
    return input.directionName?.trim().toLowerCase() === "outbound";
}

export type StopRouteUsageSummaryCounts = {
    totalRoutes: number;
    totalVariants: number;
    routeStopMemberships: number;
    inboundCount: number;
    outboundCount: number;
    clockwiseCount: number;
    anticlockwiseCount: number;
};

export type StopRouteUsageDirectionUsage = {
    inbound: number;
    outbound: number;
    clockwise: number;
    anticlockwise: number;
};

export function directionUsageFromSummary(
    summary: StopRouteUsageSummaryCounts,
): StopRouteUsageDirectionUsage {
    return {
        inbound: summary.inboundCount,
        outbound: summary.outboundCount,
        clockwise: summary.clockwiseCount,
        anticlockwise: summary.anticlockwiseCount,
    };
}

export type StopRouteUsageDetailItemShape = {
    routeStopId: string;
    routeId: string;
    routeCode: string;
    routeName: string;
    variantId: string;
    variantCode: string;
    directionName: string | null;
    directionId: number | null;
    stopSequence: number;
};

/** Canonical route-usage payload shared by Stop Detail, Review Map, and merge preview. */
export type AssembledStopRouteUsageDetail = {
    stopPublicId: string;
    stopId: string;
    items: StopRouteUsageDetailItemShape[];
    routes: StopRouteUsageDetailItemShape[];
    summary: StopRouteUsageSummaryCounts;
    totalRoutes: number;
    totalVariants: number;
    directionUsage: StopRouteUsageDirectionUsage;
};

export function assembleStopRouteUsageDetail(
    stopPublicId: string,
    items: readonly StopRouteUsageDetailItemShape[],
    summary: StopRouteUsageSummaryCounts,
): AssembledStopRouteUsageDetail {
    return {
        stopPublicId,
        stopId: stopPublicId,
        items: [...items],
        routes: [...items],
        summary,
        totalRoutes: summary.totalRoutes,
        totalVariants: summary.totalVariants,
        directionUsage: directionUsageFromSummary(summary),
    };
}

export function buildStopRouteUsageSummary(
    usages: readonly StopRouteUsageDirectionInput[],
    routeKeys: readonly string[],
    variantKeys: readonly string[],
): StopRouteUsageSummaryCounts {
    const routeSet = new Set(routeKeys);
    const variantSet = new Set(variantKeys);

    let inboundCount = 0;
    let outboundCount = 0;
    let clockwiseCount = 0;
    let anticlockwiseCount = 0;

    for (const usage of usages) {
        if (isInboundRouteUsage(usage)) {
            inboundCount += 1;
        }
        if (isOutboundRouteUsage(usage)) {
            outboundCount += 1;
        }
        if (isClockwiseRouteUsage(usage)) {
            clockwiseCount += 1;
        }
        if (isAnticlockwiseRouteUsage(usage)) {
            anticlockwiseCount += 1;
        }
    }

    return {
        totalRoutes: routeSet.size,
        totalVariants: variantSet.size,
        routeStopMemberships: usages.length,
        inboundCount,
        outboundCount,
        clockwiseCount,
        anticlockwiseCount,
    };
}
