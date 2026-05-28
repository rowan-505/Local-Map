import type { RoutingRouteProfileCode } from "../routing.config.js";
import { getValhallaMotorcycleCostingMode } from "../routing.config.js";
import { RoutingRouteRequestError } from "../routing.errors.js";

const PROFILE_TO_VALHALLA_COSTING: Record<
    Extract<RoutingRouteProfileCode, "walk" | "car" | "motorcycle">,
    string
> = {
    walk: "pedestrian",
    car: "auto",
    motorcycle: "motorcycle",
};

export type ValhallaCostingResolution = {
    costing: string;
    /** Warnings surfaced on the normalized API response (profile kept as requested). */
    profileWarnings: string[];
};

/**
 * Maps API profile → Valhalla costing.
 * Motorcycle uses `motorcycle` unless VALHALLA_MOTORCYCLE_COSTING=auto (see routing.config).
 */
export function resolveValhallaCosting(
    profile: RoutingRouteProfileCode,
    options?: { forceAutoForMotorcycle?: boolean }
): ValhallaCostingResolution {
    if (profile === "motorcycle") {
        const mode = options?.forceAutoForMotorcycle ? "auto" : getValhallaMotorcycleCostingMode();
        if (mode === "auto") {
            return {
                costing: "auto",
                profileWarnings: [
                    "Motorcycle profile routed with Valhalla auto costing (motorcycle costing disabled or unavailable).",
                ],
            };
        }
        return { costing: "motorcycle", profileWarnings: [] };
    }

    const costing = PROFILE_TO_VALHALLA_COSTING[profile as keyof typeof PROFILE_TO_VALHALLA_COSTING];
    if (!costing) {
        throw new RoutingRouteRequestError(
            `Profile "${profile}" cannot be mapped to a Valhalla costing mode.`,
            "ROUTING_PROFILE_NOT_MAPPED",
            { profile }
        );
    }

    return { costing, profileWarnings: [] };
}

/** @deprecated Prefer {@link resolveValhallaCosting} for warnings. */
export function mapProfileToValhallaCosting(profile: RoutingRouteProfileCode): string {
    return resolveValhallaCosting(profile).costing;
}

export function isMotorcycleCostingRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (
        message.includes("motorcycle") ||
        message.includes("costing") ||
        message.includes("unknown_costing") ||
        message.includes("invalid costing")
    );
}
