export type MapMode = 'normal' | 'satellite' | 'hybrid';

export type SatelliteRasterConfig = {
  readonly tilesUrl: string;
  readonly tileSize: number;
  readonly attribution?: string;
};

/**
 * Future satellite configuration point.
 *
 * Add a public/properly licensed raster tile template via env when available, for example:
 * VITE_SATELLITE_RASTER_TILES_URL="https://example.com/tiles/{z}/{x}/{y}.jpg"
 *
 * Do not hardcode paid provider URLs or private API keys in source. When this is configured,
 * `satellite` can render imagery below existing labels/POI overlays and `hybrid` can keep
 * selected label layers visible above it.
 */
export function getSatelliteRasterConfig(): SatelliteRasterConfig | null {
  const tilesUrl = import.meta.env.VITE_SATELLITE_RASTER_TILES_URL;
  if (typeof tilesUrl !== 'string' || tilesUrl.trim() === '') return null;

  const configuredTileSize = Number(import.meta.env.VITE_SATELLITE_RASTER_TILE_SIZE);
  const tileSize = Number.isFinite(configuredTileSize) && configuredTileSize > 0
    ? configuredTileSize
    : 256;
  const attribution = import.meta.env.VITE_SATELLITE_RASTER_ATTRIBUTION;

  return {
    tilesUrl: tilesUrl.trim(),
    tileSize,
    attribution:
      typeof attribution === 'string' && attribution.trim() !== ''
        ? attribution.trim()
        : undefined,
  };
}

export function isMapModeAvailable(mode: MapMode): boolean {
  if (mode === 'normal') return true;
  return getSatelliteRasterConfig() !== null;
}
