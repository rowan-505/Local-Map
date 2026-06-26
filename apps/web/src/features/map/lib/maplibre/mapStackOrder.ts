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
import { moveSearchHighlightLayers } from './searchHighlightOnMap';
import { moveTransportLayersToTop } from './transportLayers';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  restorePublicMapLayersUnderPlaces(map);
  // Transport (Martin) overlay sits above the basemap — including dynamically loaded regional
  // PMTiles layers, which get appended on top — so it is moved up first; the route/POI/highlight/
  // click overlays below then stack on top of it.
  moveTransportLayersToTop(map);
  // Highlight sits above the basemap but below route/POI/click overlays, so it
  // is moved first (subsequent moves stack on top of it).
  moveSearchHighlightLayers(map);
  positionActiveRouteLayers(map);
  if (map.getLayer(PLACES_IMPORTANT_LAYER_ID)) map.moveLayer(PLACES_IMPORTANT_LAYER_ID);
  if (map.getLayer(PLACES_LAYER_ID)) map.moveLayer(PLACES_LAYER_ID);
  if (map.getLayer(PLACES_SELECTED_HALO_LAYER_ID)) map.moveLayer(PLACES_SELECTED_HALO_LAYER_ID);
  if (map.getLayer(PLACES_SELECTED_LAYER_ID)) map.moveLayer(PLACES_SELECTED_LAYER_ID);
  if (map.getLayer(PLACES_LABEL_LAYER_ID)) map.moveLayer(PLACES_LABEL_LAYER_ID);
  positionActiveRouteLayers(map);
  moveClickedLocationLayersToTop(map);
}
