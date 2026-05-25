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
import type { MapClickedLocation } from '../../types';

const POI_HIT_LAYERS = [
  PLACES_SELECTED_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
] as const;

export function bindPoiLayerInteractions(
  map: MapEngine,
  onSelectPoiId: (id: string | null) => void,
  onEmptyMapClick?: (location: MapClickedLocation) => void,
): () => void {
  const onMapClick = (e: MapMouseEvent) => {
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
