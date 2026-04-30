import type { StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '@local-map/map-style/base-map.json';

/**
 * Shared MapLibre style entrypoint (Martin vector tiles + labels).
 */
export const BASEMAP_STYLE: StyleSpecification = BaseMapStyle as StyleSpecification;

/** Style passed to `maplibregl.Map({ style })`. */
export function getActiveBasemapStyle(): StyleSpecification {
  return BASEMAP_STYLE;
}
