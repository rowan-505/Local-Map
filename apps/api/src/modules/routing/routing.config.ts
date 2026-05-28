import {
    getRoutingEnv,
    isRoutingEnabled as isPublicRoutingEnabled,
} from "../../config/env.js";

/** Public directions API (Valhalla adapter). See config/env.ts. */
export function isRoutingEnabled(): boolean {
    return isPublicRoutingEnabled();
}

export function getValhallaBaseUrl(): string {
    return getRoutingEnv().valhallaBaseUrl;
}

export function getRoutingDefaultEngine(): ReturnType<typeof getRoutingEnv>["defaultEngine"] {
    return getRoutingEnv().defaultEngine;
}

export function getRoutingRequestTimeoutMs(): number {
    return getRoutingEnv().requestTimeoutMs;
}

export function getRoutingPublicProfiles(): readonly string[] {
    return getRoutingEnv().publicProfiles;
}

/**
 * Valhalla costing for API `motorcycle` profile.
 * Set VALHALLA_MOTORCYCLE_COSTING=auto to force auto costing (tiles without motorcycle).
 * Default: motorcycle (adapter retries with auto on costing errors).
 */
export function getValhallaMotorcycleCostingMode(): "motorcycle" | "auto" {
    return process.env.VALHALLA_MOTORCYCLE_COSTING === "auto" ? "auto" : "motorcycle";
}

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

// -----------------------------------------------------------------------------
// Universal route API (POST /api/routing/route) — aligns with migration 060 seeds
// -----------------------------------------------------------------------------

/** Request profile codes accepted by the route API schema. */
export const ROUTING_ROUTE_PROFILE_CODES = ["walk", "car", "motorcycle", "multimodal"] as const;
export type RoutingRouteProfileCode = (typeof ROUTING_ROUTE_PROFILE_CODES)[number];

/** Profiles enabled for routing once an engine adapter is wired. */
export const ROUTING_ROUTE_PROFILES_ENABLED = ["walk", "car", "motorcycle"] as const;

/** Profiles accepted by schema but rejected until OTP/multimodal is ready. */
export const ROUTING_ROUTE_PROFILES_DISABLED = ["multimodal"] as const;

export const ROUTING_PHYSICAL_MODE_CODES = [
    "walk",
    "car",
    "motorcycle",
    "bus",
    "rail",
    "ferry",
    "air",
] as const;
export type RoutingPhysicalModeCode = (typeof ROUTING_PHYSICAL_MODE_CODES)[number];

export const ROUTING_PHYSICAL_MODES_ENABLED = ["walk", "car", "motorcycle"] as const;
export const ROUTING_PHYSICAL_MODES_DISABLED = ["bus", "rail", "ferry", "air"] as const;

export const ROUTING_SERVICE_CLASS_CODES = [
    "local",
    "express",
    "intercity",
    "premium",
    "airport_shuttle",
] as const;
export type RoutingServiceClassCode = (typeof ROUTING_SERVICE_CLASS_CODES)[number];

export const ROUTING_ENGINE_CODES = ["valhalla", "otp", "external", "mock"] as const;
export type RoutingEngineCode = (typeof ROUTING_ENGINE_CODES)[number];

export const ROUTING_ROUTE_PREFERENCE_CODES = ["fastest", "shortest", "balanced"] as const;
export type RoutingRoutePreferenceCode = (typeof ROUTING_ROUTE_PREFERENCE_CODES)[number];

export const ROUTING_ROUTE_STATUS_CODES = ["ok", "no_route", "error"] as const;
export type RoutingRouteStatusCode = (typeof ROUTING_ROUTE_STATUS_CODES)[number];

export const ROUTING_LEG_MODE_CODES = ["road", "walk", "transit", "transfer", "wait", "air"] as const;
export type RoutingLegModeCode = (typeof ROUTING_LEG_MODE_CODES)[number];

const ROUTING_ROUTE_PROFILE_CODE_SET = new Set<string>(ROUTING_ROUTE_PROFILE_CODES);
const ROUTING_ROUTE_PROFILES_DISABLED_SET = new Set<string>(ROUTING_ROUTE_PROFILES_DISABLED);
const ROUTING_PHYSICAL_MODE_CODE_SET = new Set<string>(ROUTING_PHYSICAL_MODE_CODES);
const ROUTING_PHYSICAL_MODES_DISABLED_SET = new Set<string>(ROUTING_PHYSICAL_MODES_DISABLED);
const ROUTING_SERVICE_CLASS_CODE_SET = new Set<string>(ROUTING_SERVICE_CLASS_CODES);

export function isRoutingRouteProfileCode(value: string): value is RoutingRouteProfileCode {
    return ROUTING_ROUTE_PROFILE_CODE_SET.has(value);
}

export function isRoutingRouteProfileEnabled(profile: RoutingRouteProfileCode): boolean {
    return !ROUTING_ROUTE_PROFILES_DISABLED_SET.has(profile);
}

export function isRoutingPhysicalModeCode(value: string): value is RoutingPhysicalModeCode {
    return ROUTING_PHYSICAL_MODE_CODE_SET.has(value);
}

export function isRoutingPhysicalModeEnabled(mode: RoutingPhysicalModeCode): boolean {
    return !ROUTING_PHYSICAL_MODES_DISABLED_SET.has(mode);
}

export function isRoutingServiceClassCode(value: string): value is RoutingServiceClassCode {
    return ROUTING_SERVICE_CLASS_CODE_SET.has(value);
}
