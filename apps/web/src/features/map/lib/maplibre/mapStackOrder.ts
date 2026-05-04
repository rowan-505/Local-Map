/**
 * Basemap → API GeoJSON labels → POI circles → POI labels (top).
 */
import type { MapEngine } from '../mapEngineTypes';
import { restorePublicMapLayersUnderPlaces } from './publicMapGeoLayers';
import { PLACES_LABEL_LAYER_ID, PLACES_LAYER_ID } from './placesOnMap';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  if (map.getLayer(PLACES_LAYER_ID)) map.moveLayer(PLACES_LAYER_ID);
  if (map.getLayer(PLACES_LABEL_LAYER_ID)) map.moveLayer(PLACES_LABEL_LAYER_ID);
  restorePublicMapLayersUnderPlaces(map);
}
