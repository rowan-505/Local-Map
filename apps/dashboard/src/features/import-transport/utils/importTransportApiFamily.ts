import type { ImportTransportApiFamily } from "../config/types";

const SLUG_TO_API: Record<string, ImportTransportApiFamily> = {
    routes: "routes",
    stops: "stops",
    variants: "variants",
    "route-stops": "route_stops",
};

const API_TO_SLUG: Record<ImportTransportApiFamily, string> = {
    routes: "routes",
    stops: "stops",
    variants: "variants",
    route_stops: "route-stops",
};

export function resolveImportTransportApiFamily(input: string): ImportTransportApiFamily {
    const normalized = input.trim().toLowerCase().replace(/-/g, "_");
    if (normalized in API_TO_SLUG) {
        return normalized as ImportTransportApiFamily;
    }
    const fromSlug = SLUG_TO_API[input.trim().toLowerCase()];
    if (fromSlug) {
        return fromSlug;
    }
    return normalized as ImportTransportApiFamily;
}

export function importTransportSlugFromApiFamily(apiFamily: string): string | null {
    const key = resolveImportTransportApiFamily(apiFamily);
    return API_TO_SLUG[key] ?? null;
}
