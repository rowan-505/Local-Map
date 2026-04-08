/**
 * Basemap → township fill → township line → POI circles (top).
 */
import type { MapEngine } from '../mapEngineTypes';
import {
  KYAUKTAN_TOWNSHIP_FILL_LAYER_ID,
  KYAUKTAN_TOWNSHIP_LINE_LAYER_ID,
} from './mapLayerIds';
import { PLACES_LAYER_ID } from './placesOnMap';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  if (!map.getLayer(KYAUKTAN_TOWNSHIP_FILL_LAYER_ID) || !map.getLayer(KYAUKTAN_TOWNSHIP_LINE_LAYER_ID)) {
    if (map.getLayer(PLACES_LAYER_ID)) map.moveLayer(PLACES_LAYER_ID);
    return;
  }

  if (map.getLayer(PLACES_LAYER_ID)) {
    map.moveLayer(PLACES_LAYER_ID);
    map.moveLayer(KYAUKTAN_TOWNSHIP_LINE_LAYER_ID, PLACES_LAYER_ID);
    map.moveLayer(KYAUKTAN_TOWNSHIP_FILL_LAYER_ID, KYAUKTAN_TOWNSHIP_LINE_LAYER_ID);
  }
}
