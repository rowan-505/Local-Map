/**
 * Map defaults for apps/web — operational/Kyauktan helpers and re-exports.
 * Myanmar overview viewport lives in `config/publicMapViewport.ts` (public map only).
 */
import { REGION_SCOPE } from '@/config/regionScope';

export {
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MYANMAR_OVERVIEW_CENTER,
  MYANMAR_OVERVIEW_MAX_BOUNDS,
  MYANMAR_OVERVIEW_MIN_ZOOM,
  MYANMAR_OVERVIEW_ZOOM,
  PUBLIC_MAP_MAX_ZOOM,
  PUBLIC_MAP_OVERVIEW_BOUNDS,
  PUBLIC_MAP_OVERVIEW_CENTER,
  PUBLIC_MAP_OVERVIEW_INITIAL_ZOOM,
  PUBLIC_MAP_OVERVIEW_MAX_BOUNDS,
  PUBLIC_MAP_OVERVIEW_MIN_ZOOM,
} from './config/publicMapViewport';

/** Reference bbox for optional country `cameraForBounds` helpers (API scope, not public map init). */
export const MAP_COUNTRY_BOUNDS = REGION_SCOPE.country.boundsLngLat;

/** Pixel padding for township / sidebar `fitBounds` (not used for overview opening view). */
export const MAP_COUNTRY_VIEW_PADDING = {
  top: 40,
  right: 40,
  bottom: 40,
  left: 40,
} as const;

export const MAP_CAMERA_BOUNDS_RIGHT_INSET_PX = 0;

/** Places panel — kept for optional township / sidebar fits elsewhere; not used for country opening view. */
export const MAP_SIDEBAR_WIDTH_PX = 320;

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

export const MAP_KYAUKTAN_STARTUP_BOUNDS: [[number, number], [number, number]] = [
  [96.2674254, 16.6121997],
  [96.4651032, 16.685961],
];

export const MAP_DEFAULT_CENTER = REGION_SCOPE.operationalArea.centerLngLat;
export const MAP_DEFAULT_ZOOM = 14;

export const MAP_OPERATIONAL_BOUNDS = REGION_SCOPE.operationalArea.boundsLngLat;
