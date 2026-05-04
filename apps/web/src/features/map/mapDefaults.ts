/**
 * Map viewport — Myanmar country fit + zoom floor, wide pan limits (`maxBounds`).
 */
import { REGION_SCOPE } from '@/config/regionScope';

/** Reference bbox for initial fit, `cameraForBounds`, and `setMinZoom` (same as `REGION_SCOPE.country.boundsLngLat`). */
export const MAP_COUNTRY_BOUNDS = REGION_SCOPE.country.boundsLngLat;

/**
 * Pixel padding when fitting Myanmar (initial `bounds` + `syncCountryMinZoom` / `cameraForBounds`).
 * Single source so opening view and min zoom-out limit match.
 */
export const MAP_COUNTRY_VIEW_PADDING = {
  top: 40,
  right: 40,
  bottom: 40,
  left: 40,
} as const;

export const MAP_CAMERA_BOUNDS_RIGHT_INSET_PX = 0;

/** Places panel — kept for optional township / sidebar fits elsewhere; not used for country opening view. */
export const MAP_SIDEBAR_WIDTH_PX = 320;

/**
 * Pan limits only — wider than Myanmar so users can pan in all directions into nearby regions.
 * (Suggested regional box; not used for initial camera or min zoom.)
 */
export const MAP_MAX_BOUNDS: readonly [[number, number], [number, number]] = [
  [80.0, -2.0],
  [115.0, 36.0],
];

const TOWNSHIP_PAD = 48;

/** Asymmetric padding for optional animated township `fitBounds` (e.g. future UX). */
export const MAP_TOWNSHIP_FIT_PADDING = {
  top: TOWNSHIP_PAD,
  bottom: TOWNSHIP_PAD,
  left: TOWNSHIP_PAD,
  right: TOWNSHIP_PAD + MAP_SIDEBAR_WIDTH_PX,
} as const;

export const MAP_TOWNSHIP_FIT_OPTIONS = {
  padding: MAP_TOWNSHIP_FIT_PADDING,
  maxZoom: 14,
  duration: 1200,
  essential: true,
} as const;

export const MAP_DEFAULT_CENTER = REGION_SCOPE.operationalArea.centerLngLat;
export const MAP_DEFAULT_ZOOM = 14;

/**
 * Passed to `new Map({ minZoom })` only until `syncCountryMinZoom` runs — must stay low so we never
 * cap zoom-out above the true country-fit zoom from `cameraForBounds`.
 */
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 22;

export const MAP_OPERATIONAL_BOUNDS = REGION_SCOPE.operationalArea.boundsLngLat;
