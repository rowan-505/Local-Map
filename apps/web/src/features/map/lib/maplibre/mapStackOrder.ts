/**
 * Basemap → POI circles (top). Township overlay layers removed.
 */
import type { MapEngine } from '../mapEngineTypes';
import { PLACES_LAYER_ID } from './placesOnMap';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  if (map.getLayer(PLACES_LAYER_ID)) map.moveLayer(PLACES_LAYER_ID);
}
