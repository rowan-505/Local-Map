import {
    getImportReviewEntityConfigByApiFamily,
    getImportReviewEntityConfigBySlug,
} from "../config/importReviewEntityConfigs";

/** Dashboard route slug (hyphen) → API entity family (underscore). */
const ROUTE_SLUG_TO_API_FAMILY: Readonly<Record<string, string>> = {
    "bus-stops": "bus_stops",
    "admin-areas": "admin_areas",
    "water-lines": "water_lines",
    "water-polygons": "water_polygons",
    "routing-barriers": "routing_barriers",
    buildings: "buildings",
    places: "places",
    roads: "roads",
    landuse: "landuse",
    addresses: "addresses",
};

/**
 * Resolve a dashboard route slug or API family string to the backend enum value.
 * Browser routes may use hyphens; `/api/import-review/*` paths must use underscores.
 */
export function resolveImportReviewApiFamily(routeSlugOrFamily: string): string {
    const trimmed = routeSlugOrFamily.trim();
    if (trimmed === "") {
        return trimmed;
    }

    const fromSlug = getImportReviewEntityConfigBySlug(trimmed);
    if (fromSlug) {
        return fromSlug.apiFamily;
    }

    const fromApi = getImportReviewEntityConfigByApiFamily(trimmed);
    if (fromApi) {
        return fromApi.apiFamily;
    }

    const mapped = ROUTE_SLUG_TO_API_FAMILY[trimmed.toLowerCase()];
    if (mapped) {
        return mapped;
    }

    if (trimmed.includes("-")) {
        return trimmed.replace(/-/g, "_");
    }

    return trimmed;
}
