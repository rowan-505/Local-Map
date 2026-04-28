/**
 * Country-fit zoom floor from Myanmar bounds + actual map canvas size (via `resize` + `cameraForBounds`).
 */
import maplibregl from 'maplibre-gl';
import {
  MAP_CAMERA_BOUNDS_RIGHT_INSET_PX,
  MAP_COUNTRY_BOUNDS,
  MAP_COUNTRY_VIEW_PADDING,
  MAP_MIN_ZOOM,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';

type BoundsLike = maplibregl.LngLatBoundsLike;

/** Same effective padding as initial country `fitBoundsOptions` (symmetric + optional UI inset split L/R). */
function countryFitPadding(): maplibregl.PaddingOptions {
  const { top, right, bottom, left } = MAP_COUNTRY_VIEW_PADDING;
  const extra = MAP_CAMERA_BOUNDS_RIGHT_INSET_PX;
  return {
    top,
    bottom,
    left: left + extra / 2,
    right: right + extra / 2,
  };
}

export function countryOverviewCamera(map: MapEngine) {
  return map.cameraForBounds(MAP_COUNTRY_BOUNDS as BoundsLike, {
    padding: countryFitPadding(),
  });
}

export type SyncCountryMinZoomOptions = {
  /**
   * When `true`, skip `map.resize()` — use from a MapLibre `resize` listener, since `resize()` always
   * fires that event and calling it again would recurse until stack overflow.
   */
  skipResize?: boolean;
};


export function syncCountryMinZoom(map: MapEngine, opts?: SyncCountryMinZoomOptions): void {
  const el = map.getContainer();
  if (!el.isConnected) return;

  try {
    if (!opts?.skipResize) {
      map.resize();
    }

    // Allow zooming out beyond the Myanmar country-fit opening view.
    // Use the fixed global floor from mapDefaults instead of locking
    // minZoom to cameraForBounds(MAP_COUNTRY_BOUNDS).
    map.setMinZoom(MAP_MIN_ZOOM);
  } catch {
    /* map removed or style not ready */
  }
}