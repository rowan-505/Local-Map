/** Public satellite raster tiles for dashboard Map / Sat / Hyb modes (no API keys in source). */

export type DashboardSatelliteRasterConfig = {
    readonly tilesUrl: string;
    readonly tileSize: number;
    readonly attribution: string;
};

const DEFAULT_ESRI_WORLD_IMAGERY_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const DEFAULT_ESRI_ATTRIBUTION =
    '<a href="https://www.esri.com/">© Esri</a> — Sources: Esri, Maxar, Earthstar Geographics';

/**
 * Resolves satellite raster tiles for dashboard preview maps.
 *
 * Override with `NEXT_PUBLIC_SATELLITE_TILE_URL` (or legacy `NEXT_PUBLIC_SATELLITE_RASTER_TILES_URL`).
 * When unset, defaults to Esri World Imagery (same as the public web map fallback).
 *
 * Set `NEXT_PUBLIC_SATELLITE_TILE_URL=off` to disable satellite/hybrid modes in the UI.
 */
export function getDashboardSatelliteRasterConfig(): DashboardSatelliteRasterConfig | null {
    const raw =
        process.env.NEXT_PUBLIC_SATELLITE_TILE_URL?.trim() ||
        process.env.NEXT_PUBLIC_SATELLITE_RASTER_TILES_URL?.trim() ||
        "";

    if (raw.toLowerCase() === "off" || raw.toLowerCase() === "false" || raw === "0") {
        return null;
    }

    const tilesUrl = raw || DEFAULT_ESRI_WORLD_IMAGERY_TILES;

    const tileSizeRaw = Number(process.env.NEXT_PUBLIC_SATELLITE_RASTER_TILE_SIZE);
    const tileSize =
        Number.isFinite(tileSizeRaw) && tileSizeRaw > 0 ? Math.floor(tileSizeRaw) : 256;

    const attributionRaw = process.env.NEXT_PUBLIC_SATELLITE_RASTER_ATTRIBUTION?.trim();
    const attribution = attributionRaw || DEFAULT_ESRI_ATTRIBUTION;

    return { tilesUrl, tileSize, attribution };
}

export function isDashboardSatelliteImageryAvailable(): boolean {
    return getDashboardSatelliteRasterConfig() !== null;
}
