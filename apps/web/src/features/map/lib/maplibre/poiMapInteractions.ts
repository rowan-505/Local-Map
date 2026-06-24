/**
 * Pointer handling for the POI circle layer — keeps MapView free of map event API details.
 */
import type { MapEngine, MapMouseEvent } from '../mapEngineTypes';
import {
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
} from './placesOnMap';
import { TRANSPORT_LAYER_IDS } from './transportLayers';
import type { MapClickedLocation } from '../../types';

const POI_HIT_LAYERS = [
  PLACES_SELECTED_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
] as const;

/** Transport overlay features handle their own debug popups; skip empty-map handling for them. */
function isTransportFeatureUnderPoint(map: MapEngine, point: MapMouseEvent['point']): boolean {
  const presentLayers = TRANSPORT_LAYER_IDS.filter((id) => map.getLayer(id));
  if (presentLayers.length === 0) return false;
  return map.queryRenderedFeatures(point, { layers: presentLayers }).length > 0;
}

export type RoutePickMode = 'from' | 'to' | null;

export function bindPoiLayerInteractions(
  map: MapEngine,
  onSelectPoiId: (id: string | null) => void,
  onEmptyMapClick?: (location: MapClickedLocation) => void,
  options?: {
    readonly getRoutePickMode?: () => RoutePickMode;
  },
): () => void {
  const onMapClick = (e: MapMouseEvent) => {
    const pickMode = options?.getRoutePickMode?.() ?? null;
    if (pickMode) {
      onEmptyMapClick?.({
        label: 'Selected map point',
        coordinates: [e.lngLat.lng, e.lngLat.lat],
      });
      return;
    }

    // Transport overlay owns its clicks: a transport feature under the cursor must not be
    // overridden by POI selection or the address panel (transport popup handles it).
    if (isTransportFeatureUnderPoint(map, e.point)) {
      return;
    }

    const hits = map.queryRenderedFeatures(e.point, { layers: [...POI_HIT_LAYERS] });
    const first = hits[0];
    const raw = first?.properties?.id;
    if (typeof raw === 'string') {
      onSelectPoiId(raw);
      return;
    }
    onSelectPoiId(null);
    onEmptyMapClick?.({
      label: 'Clicked location',
      coordinates: [e.lngLat.lng, e.lngLat.lat],
    });
  };

  const onEnter = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };

  map.on('click', onMapClick);
  for (const layerId of POI_HIT_LAYERS) {
    if (map.getLayer(layerId)) {
      map.on('mouseenter', layerId, onEnter);
      map.on('mouseleave', layerId, onLeave);
    }
  }

  return () => {
    map.off('click', onMapClick);
    for (const layerId of POI_HIT_LAYERS) {
      if (map.getLayer(layerId)) {
        map.off('mouseenter', layerId, onEnter);
        map.off('mouseleave', layerId, onLeave);
      }
    }
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };
}
