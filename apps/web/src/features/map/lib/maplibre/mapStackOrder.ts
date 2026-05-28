/**
 * Basemap roads → route overlay → basemap/API labels → POI markers → click pin (top).
 */
import type { MapEngine } from '../mapEngineTypes';
import { restorePublicMapLayersUnderPlaces } from './publicMapGeoLayers';
import {
  PLACES_LABEL_LAYER_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
} from './placesOnMap';
import { moveClickedLocationLayersToTop } from './clickedLocationOnMap';
import { positionActiveRouteLayers } from './directionsRouteOnMap';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  restorePublicMapLayersUnderPlaces(map);
  positionActiveRouteLayers(map);
  if (map.getLayer(PLACES_IMPORTANT_LAYER_ID)) map.moveLayer(PLACES_IMPORTANT_LAYER_ID);
  if (map.getLayer(PLACES_LAYER_ID)) map.moveLayer(PLACES_LAYER_ID);
  if (map.getLayer(PLACES_SELECTED_HALO_LAYER_ID)) map.moveLayer(PLACES_SELECTED_HALO_LAYER_ID);
  if (map.getLayer(PLACES_SELECTED_LAYER_ID)) map.moveLayer(PLACES_SELECTED_LAYER_ID);
  if (map.getLayer(PLACES_LABEL_LAYER_ID)) map.moveLayer(PLACES_LABEL_LAYER_ID);
  positionActiveRouteLayers(map);
  moveClickedLocationLayersToTop(map);
}
