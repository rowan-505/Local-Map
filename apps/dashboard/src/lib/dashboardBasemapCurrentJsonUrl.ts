import { DEFAULT_BASEMAP_CURRENT_JSON_URL } from "@local-map/map-style/basemapSource";

/**
 * `current.json` URL for dashboard basemap resolution (client bundle inlines `NEXT_PUBLIC_*`).
 */
export function getDashboardBasemapCurrentJsonUrl(): string {
    const v = process.env.NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : DEFAULT_BASEMAP_CURRENT_JSON_URL;
}
