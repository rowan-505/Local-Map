import type { TransportStopRouteUsageDetailItem, TransportStopRouteUsageSummary } from "./types";
import { canonicalYbsVariantCode, ybsDirectionLabel } from "./variantDirection";

export const ROUTE_USAGE_LOAD_ERROR = "Could not load route usage.";

export function formatRouteUsageSummary(summary: TransportStopRouteUsageSummary): string {
    const routeLabel = summary.totalRoutes === 1 ? "route" : "routes";
    const variantLabel = summary.totalVariants === 1 ? "variant" : "variants";
    return `${summary.totalRoutes} ${routeLabel} · ${summary.totalVariants} ${variantLabel}`;
}

export function formatRouteUsageDirectionBreakdown(
    summary: TransportStopRouteUsageSummary,
): string | null {
    const parts: string[] = [];
    if (summary.inboundCount > 0) {
        parts.push(`${summary.inboundCount} direction ID 1`);
    }
    if (summary.outboundCount > 0) {
        parts.push(`${summary.outboundCount} direction ID 0`);
    }
    if (summary.clockwiseCount > 0) {
        parts.push(`${summary.clockwiseCount} clockwise`);
    }
    if (summary.anticlockwiseCount > 0) {
        parts.push(`${summary.anticlockwiseCount} anticlockwise`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

/** Compact machine-direction line for candidate detail cards. */
export function formatCompactDirectionUsageSummary(
    summary: TransportStopRouteUsageSummary,
): string {
    const parts = [
        `Direction ID 1 ${summary.inboundCount}`,
        `Direction ID 0 ${summary.outboundCount}`,
    ];
    if (summary.clockwiseCount > 0 || summary.anticlockwiseCount > 0) {
        parts.push(`Clockwise ${summary.clockwiseCount}`, `Anticlockwise ${summary.anticlockwiseCount}`);
    }
    return parts.join(" · ");
}

export function formatCompactRouteUsageList(
    items: readonly TransportStopRouteUsageDetailItem[],
    maxItems = 3,
): string | null {
    if (items.length === 0) {
        return null;
    }
    const parts = items.slice(0, maxItems).map((item) => {
        const canonicalYbs = item.routeCode.startsWith("YBS-");
        const direction = canonicalYbs
            ? ybsDirectionLabel(item.directionId)
            : item.directionName?.trim() ||
              (item.directionId === null ? null : `Direction ${item.directionId}`);
        const variantCode = canonicalYbs
            ? (canonicalYbsVariantCode(item.routeCode, item.directionId) ?? item.variantCode)
            : item.variantCode;
        return direction
            ? `${item.routeCode} · ${variantCode} (${direction})`
            : `${item.routeCode} · ${variantCode}`;
    });
    if (items.length > maxItems) {
        parts.push(`+${items.length - maxItems} more`);
    }
    return parts.join("; ");
}

export function shortStopPublicId(publicId: string): string {
    const trimmed = publicId.trim();
    if (trimmed.length <= 10) {
        return trimmed;
    }
    return `${trimmed.slice(0, 8)}…`;
}
