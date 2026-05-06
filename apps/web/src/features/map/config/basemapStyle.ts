import type { StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';

/** Single fontstack for every symbol layer — must match `apps/web/public/fonts/<name>/`. */
export const MAP_SYMBOL_TEXT_FONT = ['NotoSansMyanmar-Regular'] as const;

/**
 * Martin vector source id for footprints (must match `packages/map-style/base-map.json`).
 */
export const WEB_MAP_BUILDINGS_VECTOR_SOURCE_ID = 'tiles_buildings_v' as const;

/**
 * Shared MapLibre style snapshot (read-only). Prefer {@link getActiveBasemapStyle}
 * for the map instance so buildings tiles can be cache-busted safely.
 */
export const BASEMAP_STYLE: StyleSpecification = BaseMapStyle as StyleSpecification;

function cloneStyleSpecification(style: StyleSpecification): StyleSpecification {
  if (typeof structuredClone === 'function') {
    return structuredClone(style) as StyleSpecification;
  }
  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}

function appendQueryParam(urlTemplate: string, key: string, value: string): string {
  const pair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return urlTemplate.includes('?') ? `${urlTemplate}&${pair}` : `${urlTemplate}?${pair}`;
}

/**
 * Style passed to `maplibregl.Map({ style })`.
 * Clones the shared basemap and adds a cache-busting query param to **only**
 * `tiles_buildings_v` tile URLs so dashboard-created footprints show up without
 * browser/CDN serving old MVT.
 *
 * Override with `VITE_BUILDINGS_TILES_CACHE_BUSTER` (e.g. deploy git sha);
 * otherwise uses `Date.now()` per map creation.
 */
export function getActiveBasemapStyle(): StyleSpecification {
  const style = cloneStyleSpecification(BASEMAP_STYLE);
  const bustFromEnv = import.meta.env.VITE_BUILDINGS_TILES_CACHE_BUSTER;
  const cacheBuster =
    bustFromEnv !== undefined && String(bustFromEnv).trim() !== ''
      ? String(bustFromEnv).trim()
      : String(Date.now());

  const buildings = style.sources?.[WEB_MAP_BUILDINGS_VECTOR_SOURCE_ID];
  if (!buildings || buildings.type !== 'vector' || !('tiles' in buildings)) {
    return style;
  }

  const tiles = buildings.tiles;
  if (!Array.isArray(tiles)) {
    return style;
  }

  (buildings as { tiles: string[] }).tiles = tiles.map((u) =>
    appendQueryParam(u, 'v', cacheBuster),
  );

  return style;
}
