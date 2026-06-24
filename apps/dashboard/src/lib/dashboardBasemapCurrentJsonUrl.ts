import { DEFAULT_BASEMAP_CURRENT_JSON_URL } from "@local-map/map-style/basemapSource";
import { DEFAULT_OVERVIEW_CURRENT_JSON_URL } from "@local-map/map-style/overviewSource";

import { isLocalDevHost } from "@/src/lib/isLocalDevHost";

/**
 * `current.json` URL for dashboard basemap resolution (client bundle inlines `NEXT_PUBLIC_*`).
 *
 * Returns `undefined` when no env URL is set and we are NOT on a local dev host — the shared
 * `localhost:8080` default is local-development-only and must never be fetched from a deployed
 * dashboard. In that case callers should require a public env var (see `config/map.ts`).
 */
export function getDashboardBasemapCurrentJsonUrl(): string | undefined {
    const v = process.env.NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL;
    if (typeof v === "string" && v.trim() !== "") {
        return v.trim();
    }
    return isLocalDevHost() ? DEFAULT_BASEMAP_CURRENT_JSON_URL : undefined;
}

/**
 * Overview (z0–z8 whole-country) `current.json` URL for dashboard preview maps.
 *
 * Returns `undefined` when no env URL is set and we are NOT on a local dev host (same
 * localhost-only safety as {@link getDashboardBasemapCurrentJsonUrl}).
 */
export function getDashboardOverviewCurrentJsonUrl(): string | undefined {
    const v = process.env.NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL;
    if (typeof v === "string" && v.trim() !== "") {
        return v.trim();
    }
    return isLocalDevHost() ? DEFAULT_OVERVIEW_CURRENT_JSON_URL : undefined;
}
