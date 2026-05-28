import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineName,
} from "../routing.types.js";

/** Pluggable routing backend (Valhalla today, OTP later). */
export interface RoutingEngineAdapter {
    readonly name: RoutingEngineName;
    getHealth(): Promise<RoutingEngineHealth>;
    route(request: NormalizedRouteRequest): Promise<NormalizedRouteResponse>;
}
