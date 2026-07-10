/**
 * Central overlay stack for the public web map.
 *
 * Basemap PMTiles (land, roads, labels) stay in the style JSON. Everything listed in
 * {@link PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP} is moved above those layers in a fixed order
 * so POI/transport points are not buried by roads, route lines, or labels.
 */
import { moveUserLocationLayersToTop } from '@/features/location/userLocationMapLayers';
import type { MapEngine } from '../mapEngineTypes';
import { applyMapLayerStackBottomToTop } from './mapLayerStack';
import { PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP } from './publicMapMarkerStackOrder';

export function applyMapOverlayStackOrder(map: MapEngine): void {
  applyMapLayerStackBottomToTop(map, PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP);
  moveUserLocationLayersToTop(map);
}
