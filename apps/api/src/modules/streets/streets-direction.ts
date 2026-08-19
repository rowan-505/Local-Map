export const STREET_TRAVEL_DIRECTIONS = [
    "forward",
    "reverse",
    "reversible",
    "alternating",
    "unknown",
] as const;

export type StreetTravelDirection = (typeof STREET_TRAVEL_DIRECTIONS)[number] | null;

/**
 * Storage uses NULL for the ordinary bidirectional case. `both` is accepted at
 * the API boundary as a clearer client-facing spelling and normalized to NULL.
 */
export function normalizeStreetTravelDirection(
    value: StreetTravelDirection | "both" | undefined,
): StreetTravelDirection | undefined {
    return value === "both" ? null : value;
}

/** Legacy boolean input cannot express reverse/reversible/alternating. */
export function travelDirectionFromLegacyIsOneway(value: boolean): StreetTravelDirection {
    return value ? "forward" : null;
}

/**
 * Compatibility only. Reversible/alternating roads are not strictly one-way,
 * matching the existing Core import normalization.
 */
export function legacyIsOnewayFromTravelDirection(value: StreetTravelDirection): boolean {
    return value === "forward" || value === "reverse";
}

export function resolveStreetTravelDirectionWrite(input: {
    travel_direction?: StreetTravelDirection | "both";
    is_oneway?: boolean;
}): StreetTravelDirection | undefined {
    if (input.travel_direction !== undefined) {
        return normalizeStreetTravelDirection(input.travel_direction);
    }
    if (input.is_oneway !== undefined) {
        return travelDirectionFromLegacyIsOneway(input.is_oneway);
    }
    return undefined;
}
