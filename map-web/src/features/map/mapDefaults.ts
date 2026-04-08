/**
 * Map viewport — Kyauktan polygon fit on load; Myanmar bbox for `maxBounds` + `minZoom` floor.
 */
import { REGION_SCOPE, type LngLatBounds } from '@/config/regionScope';

/** Reference bbox for `cameraForBounds` → `setMinZoom` (same as `REGION_SCOPE.country.boundsLngLat`). */
export const MAP_COUNTRY_BOUNDS = REGION_SCOPE.country.boundsLngLat;

export const MAP_COUNTRY_OVERVIEW_PADDING = 64;

export const MAP_CAMERA_BOUNDS_RIGHT_INSET_PX = 0;

/** Places panel (`PoiPanel` `w-80`) — extra right padding when fitting Kyauktan on load. */
export const MAP_SIDEBAR_WIDTH_PX = 320;

const MAX_BOUNDS_PAD_RATIO = 0.03;

function padLngLatBounds(bounds: LngLatBounds): [[number, number], [number, number]] {
  const [sw, ne] = bounds;
  const dLng = (ne[0] - sw[0]) * MAX_BOUNDS_PAD_RATIO;
  const dLat = (ne[1] - sw[1]) * MAX_BOUNDS_PAD_RATIO;
  return [
    [sw[0] - dLng, sw[1] - dLat],
    [ne[0] + dLng, ne[1] + dLat],
  ];
}

/** Pan / clamp limit — padded Myanmar extent (stricter fit uses `MAP_COUNTRY_BOUNDS` in `cameraForBounds`). */
export const MAP_MAX_BOUNDS = padLngLatBounds(REGION_SCOPE.country.boundsLngLat);

const TOWNSHIP_PAD = 48;

/** Asymmetric padding: extra on the right so the township sits comfortably beside the Places column. */
export const MAP_TOWNSHIP_FIT_PADDING = {
  top: TOWNSHIP_PAD,
  bottom: TOWNSHIP_PAD,
  left: TOWNSHIP_PAD,
  right: TOWNSHIP_PAD + MAP_SIDEBAR_WIDTH_PX,
} as const;

export const MAP_TOWNSHIP_FIT_OPTIONS = {
  padding: MAP_TOWNSHIP_FIT_PADDING,
  /** Avoid an overly tight first frame on a small administrative polygon. */
  maxZoom: 14,
  duration: 1200,
  essential: true,
} as const;

export const MAP_INITIAL_CENTER = REGION_SCOPE.operationalArea.centerLngLat;
export const MAP_INITIAL_ZOOM = 11;

export const MAP_DEFAULT_CENTER = REGION_SCOPE.operationalArea.centerLngLat;
export const MAP_DEFAULT_ZOOM = 14;

export const MAP_MIN_ZOOM = 0;
export const MAP_MAX_ZOOM = 22;

export const MAP_OPERATIONAL_BOUNDS = REGION_SCOPE.operationalArea.boundsLngLat;
