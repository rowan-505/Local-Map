/**
 * Country-fit zoom floor from Myanmar bounds + actual map canvas size (via `resize` + `cameraForBounds`).
 */
import maplibregl from 'maplibre-gl';
import {
  MAP_CAMERA_BOUNDS_RIGHT_INSET_PX,
  MAP_COUNTRY_BOUNDS,
  MAP_COUNTRY_OVERVIEW_PADDING,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';

type BoundsLike = maplibregl.LngLatBoundsLike;

function countryFitPadding(): number | maplibregl.PaddingOptions {
  const p = MAP_COUNTRY_OVERVIEW_PADDING;
  const r = p + MAP_CAMERA_BOUNDS_RIGHT_INSET_PX;
  if (r === p) return p;
  return { top: p, bottom: p, left: p, right: r };
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
 * Syncs WebGL size to the container (unless `skipResize`), then sets `minZoom` from fitting
 * `MAP_COUNTRY_BOUNDS` in view. Pan range is limited by `maxBounds` on the map (Myanmar, padded).
 */
export function syncCountryMinZoom(map: MapEngine, opts?: SyncCountryMinZoomOptions): void {
  const el = map.getContainer();
  if (!el.isConnected) return;

  try {
    if (!opts?.skipResize) {
      map.resize();
    }
    const cam = countryOverviewCamera(map);
    if (typeof cam?.zoom === 'number' && Number.isFinite(cam.zoom)) {
      map.setMinZoom(cam.zoom);
    }
  } catch {
    /* map removed or style not ready */
  }
}
