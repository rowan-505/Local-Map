import type { CoreEntityKey } from "@/src/lib/core-review/entityConfigs";

/** Dashboard URL segment → core-review entity key. */
const SEGMENT_TO_ENTITY_KEY: Record<string, CoreEntityKey> = {
    buildings: "buildings",
    places: "places",
    settlements: "settlements",
    roads: "streets",
    "land-areas": "land-areas",
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
