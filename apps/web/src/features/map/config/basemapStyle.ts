import type { StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';
import {
  BASEMAP_VECTOR_SOURCE_ID,
  createBasemapStyle,
  fetchActiveBasemapPmtilesHttpUrl,
} from '@local-map/map-style/basemapSource';
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
export async function getActiveBasemapStyle(): Promise<StyleSpecification> {
  const pmtilesUrl = await resolveBasemapPmtilesHttpUrl();
  const style = createBasemapStyle(pmtilesUrl) as StyleSpecification;

  if (import.meta.env.DEV) {
    console.info('[map] active PMTiles URL:', pmtilesUrl);
  }

  return style;
}
