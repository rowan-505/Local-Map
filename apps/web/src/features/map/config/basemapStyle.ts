import type { StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';
import {
  BASEMAP_VECTOR_SOURCE_ID,
  createBasemapStyle,
  fetchActiveBasemapPmtilesHttpUrl,
} from '@local-map/map-style/basemapSource';
import {
  REGIONAL_VECTOR_SOURCE_MAX_ZOOM,
  patchRegionalLayersForProgressiveDetail,
} from '../lib/maplibre/basemapZoomVisibility';
import {
  getActiveOverviewBasemapStyle,
  isOverviewBasemapEnabled,
} from './overviewBasemapStyle';
import { getOverviewWebMapStyleFromManifest } from './manifestBasemapStyle';
import { getWebBasemapCurrentJsonUrl } from './webBasemapCurrentJsonUrl';

/** Single fontstack for every symbol layer — must match `apps/web/public/fonts/<name>/`. */
export const MAP_SYMBOL_TEXT_FONT = ['NotoSansMyanmar-Regular'] as const;

export { BASEMAP_VECTOR_SOURCE_ID as LOCAL_BASEMAP_SOURCE_ID };

/**
 * Shared MapLibre style snapshot (read-only JSON). Prefer {@link getActiveBasemapStyle}
 * so the PMTiles source URL is resolved at runtime.
 */
export const BASEMAP_STYLE: StyleSpecification = BaseMapStyle as StyleSpecification;

/**
 * Optional direct `.pmtiles` HTTP(S) URL from Vite (`VITE_BASEMAP_PMTILES_URL`).
 * When unset or blank, callers fall back to `current.json` (local tile server / Yangon default).
 */
export function getBasemapPmtilesUrlOverride(): string | undefined {
  const configured = import.meta.env.VITE_BASEMAP_PMTILES_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim();
  }
  return undefined;
}

/** Active basemap archive: env override, else URL from `current.json` (see {@link getWebBasemapCurrentJsonUrl}). */
export async function resolveBasemapPmtilesHttpUrl(): Promise<string> {
  const override = getBasemapPmtilesUrlOverride();
  if (override) {
    return override;
  }
  return fetchActiveBasemapPmtilesHttpUrl({
    currentJsonUrl: getWebBasemapCurrentJsonUrl(),
  });
}

/**
 * Style passed to `maplibregl.Map({ style })`.
 * PMTiles URL from `VITE_BASEMAP_PMTILES_URL` or `current.json` (see {@link getWebBasemapCurrentJsonUrl}).
 * POIs/search/live editing stay on API-driven GeoJSON overlays.
 */
function patchRegionalBasemapStyle(style: StyleSpecification): StyleSpecification {
  const layers = [...(style.layers ?? [])] as StyleSpecification['layers'];
  const background = layers.filter((l) => l.id === 'background');
  const regionalRest = patchRegionalLayersForProgressiveDetail(
    layers.filter((l) => l.id !== 'background') as never,
  );
  const sources = { ...style.sources };
  const basemapSource = sources[BASEMAP_VECTOR_SOURCE_ID];
  if (basemapSource && basemapSource.type === 'vector') {
    sources[BASEMAP_VECTOR_SOURCE_ID] = {
      ...basemapSource,
      minzoom: 0,
      maxzoom: REGIONAL_VECTOR_SOURCE_MAX_ZOOM,
    };
  }
  return {
    ...style,
    sources,
    layers: [...background, ...regionalRest],
  };
}

export async function getActiveBasemapStyle(): Promise<StyleSpecification> {
  const pmtilesUrl = await resolveBasemapPmtilesHttpUrl();
  const style = patchRegionalBasemapStyle(createBasemapStyle(pmtilesUrl) as StyleSpecification);

  if (import.meta.env.DEV) {
    console.info('[map] active regional PMTiles URL:', pmtilesUrl);
  }

  return style;
}

/**
 * Public web map style.
 *
 * Preferred path: overview PMTiles from the basemap manifest (`VITE_BASEMAP_MANIFEST_URL`,
 * default `/basemaps/manifest.json`); regional PMTiles are then loaded dynamically by viewport.
 *
 * Fallback: if the manifest fetch fails, fall back to the legacy single-PMTiles basemap
 * (`VITE_BASEMAP_PMTILES_URL`, else `current.json`).
 *
 * Env override: `VITE_MAP_BASEMAP=overview` keeps the legacy env-only overview path
 * (`VITE_OVERVIEW_PMTILES_URL`) for local testing.
 */
export async function getActiveWebMapStyle(): Promise<StyleSpecification> {
  if (isOverviewBasemapEnabled()) {
    return getActiveOverviewBasemapStyle();
  }

  try {
    return await getOverviewWebMapStyleFromManifest();
  } catch (err) {
    // Backward fallback: manifest fetch failed → use the legacy single-PMTiles basemap
    // (`VITE_BASEMAP_PMTILES_URL`, else `current.json`). Manifest remains the preferred path.
    if (import.meta.env.DEV) {
      console.warn('[map] basemap manifest unavailable; using single-PMTiles fallback:', err);
    }
    return getActiveBasemapStyle();
  }
}
