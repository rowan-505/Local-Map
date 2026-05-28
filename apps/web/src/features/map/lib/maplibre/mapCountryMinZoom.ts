/**
 * Optional `cameraForBounds` helpers for Myanmar country bbox (API scope, tests, future UX).
 * Public map init uses fixed overview center/zoom from `overviewConstants` instead.
 */
import maplibregl from 'maplibre-gl';
import { getEffectivePublicMapMinZoom } from '../../config/publicMapViewport';
import {
  MAP_CAMERA_BOUNDS_RIGHT_INSET_PX,
  MAP_COUNTRY_BOUNDS,
  MAP_COUNTRY_VIEW_PADDING,
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


/**
 * Resizes the map canvas and re-applies the overview zoom floor.
 * Prefer `map.resize()` alone in `MapView` unless something reset `minZoom`.
 */
export function syncCountryMinZoom(map: MapEngine, opts?: SyncCountryMinZoomOptions): void {
  const el = map.getContainer();
  if (!el.isConnected) return;

  try {
    if (!opts?.skipResize) {
      map.resize();
    }

    // Overview PMTiles coverage — do not relax below the country overview framing.
    map.setMinZoom(getEffectivePublicMapMinZoom());
  } catch {
    /* map removed or style not ready */
  }
}