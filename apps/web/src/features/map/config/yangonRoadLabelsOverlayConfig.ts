import { getBasemapPmtilesUrlOverride } from './basemapStyle';
import { isOverviewBasemapEnabled } from './overviewBasemapStyle';

const YANGON_REGION_PATH = /\/regions\/yangon\//i;
const YANGON_PMTILES_FILE = /yangon-v\d+\.pmtiles/i;

export function isYangonRegionalBasemapUrl(url: string): boolean {
  return YANGON_REGION_PATH.test(url) || YANGON_PMTILES_FILE.test(url);
}

function envFlagEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function envFlagDisabled(value: string | undefined): boolean {
  return value === '0' || value === 'false';
}

/** True when the active regional basemap archive is Yangon (not Bago, Shan, etc.). */
export function isActiveYangonRegionalBasemap(): boolean {
  const pmtilesOverride = getBasemapPmtilesUrlOverride();
  if (pmtilesOverride) {
    return isYangonRegionalBasemapUrl(pmtilesOverride);
  }

  const currentJson = import.meta.env.VITE_BASEMAP_CURRENT_JSON_URL;
  if (typeof currentJson === 'string' && currentJson.trim() !== '') {
    return currentJson.includes('yangon');
  }

  return import.meta.env.DEV;
}

/**
 * Yangon-only GeoJSON road label overlay (no PMTiles rebuild).
 * Off for overview mode, non-Yangon archives, and when explicitly disabled.
 */
export function shouldUseYangonRoadLabelsOverlay(): boolean {
  if (isOverviewBasemapEnabled()) return false;

  if (envFlagDisabled(import.meta.env.VITE_YANGON_ROAD_LABELS_OVERLAY)) {
    return false;
  }

  if (!isActiveYangonRegionalBasemap()) {
    return false;
  }

  return envFlagEnabled(import.meta.env.VITE_YANGON_ROAD_LABELS_OVERLAY);
}

/** HTTP URL for `exports/yangon/road_labels.geojson` on the local tile server (or explicit env). */
export function getYangonRoadLabelsGeoJsonUrl(): string | undefined {
  if (!shouldUseYangonRoadLabelsOverlay()) return undefined;

  const configured = import.meta.env.VITE_YANGON_ROAD_LABELS_GEOJSON_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim();
  }

  const pmtilesOverride = getBasemapPmtilesUrlOverride();
  if (pmtilesOverride) {
    try {
      const origin = new URL(pmtilesOverride).origin;
      return `${origin}/exports/yangon/road_labels.geojson`;
    } catch {
      /* fall through */
    }
  }

  return 'http://localhost:8080/exports/yangon/road_labels.geojson';
}
