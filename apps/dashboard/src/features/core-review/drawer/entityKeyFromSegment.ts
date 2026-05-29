import type { CoreEntityKey } from "@/src/lib/core-review/entityConfigs";

/** Dashboard URL segment → core-review entity key. Bus `bus-*` segments map to core_transport-backed APIs. */
const SEGMENT_TO_ENTITY_KEY: Record<string, CoreEntityKey> = {
    buildings: "buildings",
    places: "places",
    roads: "streets",
    "bus-stops": "bus-stops",
    "bus-routes": "bus-routes",
    "bus-route-variants": "bus-route-variants",
    landuse: "landuse",
    "water-lines": "water-lines",
    "water-polygons": "water-polygons",
    addresses: "addresses",
    "admin-areas": "admin-areas",
};

export function entityKeyFromSegment(segment: string): CoreEntityKey {
    const key = SEGMENT_TO_ENTITY_KEY[segment];
    if (!key) {
        throw new Error(`Unknown core review segment: ${segment}`);
    }
    return key;
}
