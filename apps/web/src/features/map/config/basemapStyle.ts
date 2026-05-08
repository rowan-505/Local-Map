import type { StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';

/** Single fontstack for every symbol layer — must match `apps/web/public/fonts/<name>/`. */
export const MAP_SYMBOL_TEXT_FONT = ['NotoSansMyanmar-Regular'] as const;

/**
 * Martin vector source id for footprints (must match `packages/map-style/base-map.json`).
 */
export const WEB_MAP_BUILDINGS_VECTOR_SOURCE_ID = 'tiles_buildings_v' as const;

/**
 * Martin vector source id for streets (must match `packages/map-style/base-map.json`).
 */
export const WEB_MAP_STREETS_VECTOR_SOURCE_ID = 'tiles_streets_v' as const;

/**
 * Shared MapLibre style snapshot (read-only). Prefer {@link getActiveBasemapStyle}
 * so buildings and streets MVT URLs get cache-busting `?v=` values.
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
 * `tiles_buildings_v` and `tiles_streets_v` tile URLs so CRUD updates show up without
 * browser/CDN serving old MVT.
 *
 * Override with `VITE_BUILDINGS_TILES_CACHE_BUSTER` / `VITE_STREETS_TILES_CACHE_BUSTER` (e.g. deploy git sha);
 * otherwise uses `Date.now()` per map creation for each source when env is unset.
 */
export function getActiveBasemapStyle(): StyleSpecification {
  const style = cloneStyleSpecification(BASEMAP_STYLE);

  const buildingsBust =
    import.meta.env.VITE_BUILDINGS_TILES_CACHE_BUSTER !== undefined &&
    String(import.meta.env.VITE_BUILDINGS_TILES_CACHE_BUSTER).trim() !== ''
      ? String(import.meta.env.VITE_BUILDINGS_TILES_CACHE_BUSTER).trim()
      : String(Date.now());

  const streetsBust =
    import.meta.env.VITE_STREETS_TILES_CACHE_BUSTER !== undefined &&
    String(import.meta.env.VITE_STREETS_TILES_CACHE_BUSTER).trim() !== ''
      ? String(import.meta.env.VITE_STREETS_TILES_CACHE_BUSTER).trim()
      : String(Date.now());

  const buildings = style.sources?.[WEB_MAP_BUILDINGS_VECTOR_SOURCE_ID];
  if (buildings && buildings.type === 'vector' && 'tiles' in buildings) {
    const tiles = buildings.tiles;
    if (Array.isArray(tiles)) {
      (buildings as { tiles: string[] }).tiles = tiles.map((u) =>
        appendQueryParam(u, 'v', buildingsBust),
      );
    }
  }

  const streets = style.sources?.[WEB_MAP_STREETS_VECTOR_SOURCE_ID];
  if (streets && streets.type === 'vector' && 'tiles' in streets) {
    const stTiles = streets.tiles;
    if (Array.isArray(stTiles)) {
      (streets as { tiles: string[] }).tiles = stTiles.map((u) =>
        appendQueryParam(u, 'v', streetsBust),
      );
    }
  }

  return style;
}
