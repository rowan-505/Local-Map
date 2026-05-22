/** Master gate for routing graph build (API + script). */
export function isRoutingGraphBuildEnabled(): boolean {
    return process.env.ENABLE_ROUTING_GRAPH_BUILD === "true";
}

/** Default cap when caller omits max_roads. */
export const ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS = 25;

/** Hard cap without ENABLE_ROUTING_GRAPH_BULK_BUILD=true. */
export const ROUTING_GRAPH_BUILD_CONTROLLED_MAX_ROADS = 100;

export function isRoutingGraphBulkBuildEnabled(): boolean {
    return process.env.ENABLE_ROUTING_GRAPH_BULK_BUILD === "true";
}

/** Fallback speeds (kph) when profile / street data lacks speed — stored in build metadata. */
export const ROUTING_GRAPH_FALLBACK_SPEEDS_KPH = {
    walk: 5,
    drive: 50,
    bus: 30,
} as const;

export const ROUTING_GRAPH_PROFILE_CODES = ["walk", "drive", "bus"] as const;
export type RoutingGraphProfileCode = (typeof ROUTING_GRAPH_PROFILE_CODES)[number];

export function isRoutingGraphProfileCode(value: string): value is RoutingGraphProfileCode {
    return (ROUTING_GRAPH_PROFILE_CODES as readonly string[]).includes(value);
}

/** Road class codes excluded from routing graph selection. */
export const ROUTING_GRAPH_NON_ROUTABLE_CLASS_CODES = new Set([
    "steps",
    "corridor",
    "proposed",
    "construction",
    "abandoned",
]);
