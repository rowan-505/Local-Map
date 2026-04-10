/**
 * MapLibre GL construction — style URL and interaction defaults from `../../config`;
 * viewport from `mapDefaults`. GeoJSON overlays unchanged (`basemapMvpStyle`, POI layers in MapView).
 */
import maplibregl from 'maplibre-gl';
import { getActiveBasemapStyleUrl, MAP_LIBRE_INTERACTION_DEFAULTS } from '../../config';
import {
  MAP_COUNTRY_BOUNDS,
  MAP_COUNTRY_VIEW_PADDING,
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';
import { applyMvpBasemapStyle } from './basemapMvpStyle';
import { syncCountryMinZoom } from './mapCountryMinZoom';
import { ensurePmtilesProtocol } from './pmtilesProtocol';

type BoundsLike = maplibregl.LngLatBoundsLike;

export function createMaplibreMap(container: HTMLDivElement): MapEngine {
  ensurePmtilesProtocol();

  /**
   * Initial camera = Myanmar country bounds + `MAP_COUNTRY_VIEW_PADDING`, `duration: 0` (no jump).
   * `minZoom` is finalized in `syncCountryMinZoom` to match this same fit at the real canvas size.
   *
   * `maxBounds` is the wide regional box — pan limits only, not the country framing.
   */
  const map = new maplibregl.Map({
    container,
    style: getActiveBasemapStyleUrl(),
    bounds: MAP_COUNTRY_BOUNDS as BoundsLike,
    fitBoundsOptions: {
      padding: MAP_COUNTRY_VIEW_PADDING,
      duration: 0,
      essential: true,
    },
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
  });

  return map;
}

export function addNavigationControl(map: MapEngine): void {
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
}
