import { DEFAULT_BASEMAP_CURRENT_JSON_URL } from "@local-map/map-style/basemapSource";
import { DEFAULT_OVERVIEW_CURRENT_JSON_URL } from "@local-map/map-style/overviewSource";

/**
 * `current.json` URL for dashboard basemap resolution (client bundle inlines `NEXT_PUBLIC_*`).
 */
export function getDashboardBasemapCurrentJsonUrl(): string {
    const v = process.env.NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : DEFAULT_BASEMAP_CURRENT_JSON_URL;
}

/**
 * Overview (z0–z8 whole-country) `current.json` URL for dashboard preview maps.
 * Defaults to the shared local tile-server pointer when the env var is unset.
 */
export function getDashboardOverviewCurrentJsonUrl(): string {
    const v = process.env.NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : DEFAULT_OVERVIEW_CURRENT_JSON_URL;
}
