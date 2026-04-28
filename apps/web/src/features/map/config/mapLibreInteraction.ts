/**
 * MapLibre `Map` constructor flags — viewport numbers live in `mapDefaults.ts` (region + fit).
 * Change interaction defaults here only; keeps `mapInstance` free of long literal objects.
 */
import type { MapOptions } from 'maplibre-gl';

export const MAP_LIBRE_INTERACTION_DEFAULTS: Pick<
  MapOptions,
  | 'dragPan'
  | 'scrollZoom'
  | 'boxZoom'
  | 'doubleClickZoom'
  | 'keyboard'
  | 'dragRotate'
  | 'pitchWithRotate'
  | 'pitch'
  | 'minPitch'
  | 'maxPitch'
  | 'touchPitch'
  | 'touchZoomRotate'
> = {
  dragPan: true,
  scrollZoom: true,
  boxZoom: true,
  doubleClickZoom: true,
  keyboard: true,
  dragRotate: false,
  pitchWithRotate: false,
  pitch: 0,
  minPitch: 0,
  maxPitch: 0,
  touchPitch: false,
  touchZoomRotate: true,
};
