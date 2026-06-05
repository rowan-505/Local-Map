export type MapMode = 'normal' | 'satellite' | 'hybrid';

export type SatelliteRasterConfig = {
  readonly tilesUrl: string;
  readonly tileSize: number;
  readonly attribution?: string;
};

/** Esri World Imagery — same public endpoint used by dashboard preview maps. */
const DEFAULT_ESRI_WORLD_IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const DEFAULT_ESRI_ATTRIBUTION =
  '<a href="https://www.esri.com/">© Esri</a> — Sources: Esri, Maxar, Earthstar Geographics';

/**
 * Satellite raster tiles for map / hybrid modes.
 *
 * Defaults to Esri World Imagery (dashboard parity). Override via env when needed, e.g.:
 * `VITE_SATELLITE_RASTER_TILES_URL="https://example.com/tiles/{z}/{x}/{y}.jpg"`
 *
 * Do not put private API keys in source or env exposed to the client.
 */
export function getSatelliteRasterConfig(): SatelliteRasterConfig | null {
  const env = import.meta.env ?? {};
  const configuredUrl = env.VITE_SATELLITE_RASTER_TILES_URL;
  const tilesUrl =
    typeof configuredUrl === 'string' && configuredUrl.trim() !== ''
      ? configuredUrl.trim()
      : DEFAULT_ESRI_WORLD_IMAGERY_TILES;

  const configuredTileSize = Number(env.VITE_SATELLITE_RASTER_TILE_SIZE);
  const tileSize =
    Number.isFinite(configuredTileSize) && configuredTileSize > 0 ? configuredTileSize : 256;

  const configuredAttribution = env.VITE_SATELLITE_RASTER_ATTRIBUTION;
  const attribution =
    typeof configuredAttribution === 'string' && configuredAttribution.trim() !== ''
      ? configuredAttribution.trim()
      : DEFAULT_ESRI_ATTRIBUTION;

  return { tilesUrl, tileSize, attribution };
}

export function isMapModeAvailable(mode: MapMode): boolean {
  if (mode === 'normal') return true;
  return getSatelliteRasterConfig() !== null;
}
