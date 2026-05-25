/**
 * MapLibre GL construction — shared style and interaction defaults from `../../config`;
 * viewport from `mapDefaults`. GeoJSON overlays unchanged (`basemapMvpStyle`, POI layers in MapView).
 */
import maplibregl from 'maplibre-gl';
import { getActiveBasemapStyle, MAP_LIBRE_INTERACTION_DEFAULTS } from '../../config';
import {
  ensureMaplibreComplexTextPlugin,
  maplibreComplexTextTransformRequest,
} from './maplibreComplexText';
import {
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';
import { ensurePmtilesProtocol } from '@local-map/map-style/registerPmtilesProtocol';
import { applyMvpBasemapStyle } from './basemapMvpStyle';
import { logGlyphServingHealthInDev } from './glyphDevCheck';
import { syncCountryMinZoom } from './mapCountryMinZoom';

type BoundsLike = maplibregl.LngLatBoundsLike;

/** Vite dev, non-production client build, or localhost (e.g. `vite preview`). */
function isMapDebugExposeEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (!import.meta.env.PROD) return true;
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function exposeMaplibreDebugGlobals(map: MapEngine): void {
  if (!isMapDebugExposeEnabled()) return;
  window.__MAP__ = map;
  window.__MAP_STYLE__ = map.getStyle.bind(map);
  window.__MAP_SOURCES__ = () => map.getStyle().sources;
  window.__MAP_LAYERS__ = () => map.getStyle().layers;
  console.log('[debug] MapLibre map exposed as window.__MAP__');
}

export async function createMaplibreMap(container: HTMLDivElement): Promise<MapEngine> {
  await ensurePmtilesProtocol(maplibregl);
  await ensureMaplibreComplexTextPlugin();
  logGlyphServingHealthInDev();

  /**
   * React `MapView` applies the initial Kyauktan camera after style load because
   * it knows the current sidebar/bottom-sheet layout and can pad the visible area.
   *
   * `maxBounds` is the wide regional box — pan limits only, not the country framing.
   */
  const map = new maplibregl.Map({
    container,
    style: await getActiveBasemapStyle(),
    transformRequest: maplibreComplexTextTransformRequest,
    maxBounds: MAP_MAX_BOUNDS as BoundsLike,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,

    ...MAP_LIBRE_INTERACTION_DEFAULTS,
  });


  map.once('load', () => {
    applyMvpBasemapStyle(map);
    map.on('resize', () => syncCountryMinZoom(map, { skipResize: true }));

    syncCountryMinZoom(map);
    map.once('idle', () => syncCountryMinZoom(map));

    exposeMaplibreDebugGlobals(map);
  });

  return map;
}

export function addNavigationControl(map: MapEngine): void {
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
}
