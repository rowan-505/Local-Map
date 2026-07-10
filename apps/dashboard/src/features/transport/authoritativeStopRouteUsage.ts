import type {
    TransportStopRouteUsageDetailItem,
    TransportStopRouteUsageDetailResponse,
    TransportStopRouteUsageDirectionUsage,
} from "./types";

/** Canonical route-usage payload from GET /transport/stops/:publicId/route-usage-detail. */
export type AuthoritativeStopRouteUsage = {
    stopId: string;
    totalRoutes: number;
    totalVariants: number;
    directionUsage: TransportStopRouteUsageDirectionUsage;
    routes: TransportStopRouteUsageDetailItem[];
};

export function toAuthoritativeStopRouteUsage(
    response: TransportStopRouteUsageDetailResponse,
): AuthoritativeStopRouteUsage {
    return {
        stopId: response.stopId,
        totalRoutes: response.totalRoutes,
        totalVariants: response.totalVariants,
        directionUsage: response.directionUsage,
        routes: response.routes,
    };
}
