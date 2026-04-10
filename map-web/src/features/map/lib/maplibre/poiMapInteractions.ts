/**
 * Pointer handling for the POI circle layer — keeps MapView free of map event API details.
 */
import type { MapEngine, MapMouseEvent } from '../mapEngineTypes';
import { PLACES_LAYER_ID } from './placesOnMap';

export function bindPoiLayerInteractions(
  map: MapEngine,
  onSelectPoiId: (id: string | null) => void,
): () => void {
  const onMapClick = (e: MapMouseEvent) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: [PLACES_LAYER_ID] });
    const first = hits[0];
    const raw = first?.properties?.id;
    if (typeof raw === 'string') {
      onSelectPoiId(raw);
      return;
    }
    onSelectPoiId(null);
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
  map.on('mouseenter', PLACES_LAYER_ID, onEnter);
  map.on('mouseleave', PLACES_LAYER_ID, onLeave);

  return () => {
    map.off('click', onMapClick);
    map.off('mouseenter', PLACES_LAYER_ID, onEnter);
    map.off('mouseleave', PLACES_LAYER_ID, onLeave);
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };
}
