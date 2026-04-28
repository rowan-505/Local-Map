/**
 * MapLibre GL construction — style URL and interaction defaults from `../../config`;
 * viewport from `mapDefaults`. GeoJSON overlays unchanged (`basemapMvpStyle`, POI layers in MapView).
 */
import maplibregl from 'maplibre-gl';
import { getActiveBasemapStyleUrl, MAP_LIBRE_INTERACTION_DEFAULTS } from '../../config';
import {
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';
import { applyMvpBasemapStyle } from './basemapMvpStyle';
import { syncCountryMinZoom } from './mapCountryMinZoom';
import { ensurePmtilesProtocol } from './pmtilesProtocol';

type BoundsLike = maplibregl.LngLatBoundsLike;
const KYAUKTAN_INITIAL_BOUNDS = [
  [96.2674254, 16.6121997],
  [96.4651032, 16.685961],
] as const satisfies BoundsLike;

export function createMaplibreMap(container: HTMLDivElement): MapEngine {
  ensurePmtilesProtocol();

  /**
   * Initial camera = Kyauktan bounds, applied on first load with an instant `fitBounds`.
   * `minZoom` is finalized in `syncCountryMinZoom` after load.
   *
   * `maxBounds` is the wide regional box — pan limits only, not the country framing.
   */
  const map = new maplibregl.Map({
    container,
    style: getActiveBasemapStyleUrl(),
    maxBounds: MAP_MAX_BOUNDS as BoundsLike,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,

    ...MAP_LIBRE_INTERACTION_DEFAULTS,
  });


  map.once('load', () => {
    map.fitBounds(KYAUKTAN_INITIAL_BOUNDS, {
      padding: 40,
      duration: 0,
      essential: true,
    });
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
