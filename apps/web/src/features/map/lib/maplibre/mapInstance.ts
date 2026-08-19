/** Create the public MapLibre map. Style and viewport come from `../../config`. */
import maplibregl from 'maplibre-gl';
import { getActiveWebMapStyle, MAP_LIBRE_INTERACTION_DEFAULTS } from '../../config';
import {
  ensureMaplibreComplexTextPlugin,
  maplibreComplexTextTransformRequest,
} from './maplibreComplexText';
import { getPublicMapMapLibreInitOptions } from '../../config/publicMapViewport';
import type { MapEngine } from '../mapEngineTypes';
import { registerPmtilesProtocol } from './registerPmtilesProtocol';
import { logBasemapDebugSnapshot } from './basemapDebug';
import { logGlyphServingHealthInDev } from './glyphDevCheck';

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
}

export async function createMaplibreMap(container: HTMLDivElement): Promise<MapEngine> {
  await registerPmtilesProtocol();
  await ensureMaplibreComplexTextPlugin();
  logGlyphServingHealthInDev();

  const style = await getActiveWebMapStyle();

  const viewport = getPublicMapMapLibreInitOptions();

  const map = new maplibregl.Map({
    container,
    style,
    transformRequest: maplibreComplexTextTransformRequest,
    center: viewport.center,
    zoom: viewport.zoom,
    minZoom: viewport.minZoom,
    maxZoom: viewport.maxZoom,
    ...(viewport.maxBounds !== undefined
      ? { maxBounds: viewport.maxBounds as BoundsLike }
      : {}),

    ...MAP_LIBRE_INTERACTION_DEFAULTS,
  });

  map.once('load', () => {
    exposeMaplibreDebugGlobals(map);
    if (isMapDebugExposeEnabled()) {
      window.__MAP_DEBUG_BASEMAP__ = () => logBasemapDebugSnapshot(map);
    }
  });

  return map;
}

export function addNavigationControl(map: MapEngine): void {
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
}
