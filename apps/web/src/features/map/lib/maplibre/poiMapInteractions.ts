/**
 * Pointer hover handling for the POI circle layers.
 * Map clicks are resolved centrally in {@link publicMapClickInteractions.ts}.
 */
import type { MapEngine } from '../mapEngineTypes';
import { PUBLIC_MAP_POI_CLICK_LAYER_IDS } from './publicMapClickableLayerRegistry';

/** @deprecated Use {@link bindPublicMapClickInteractions} for map clicks. Hover only. */
export function bindPoiLayerInteractions(
  map: MapEngine,
  _onSelectPoiId?: (id: string | null) => void,
  _onEmptyMapClick?: unknown,
  _options?: unknown,
): () => void {
  return bindPoiLayerHoverInteractions(map);
}

export function bindPoiLayerHoverInteractions(map: MapEngine): () => void {
  const onEnter = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };

  for (const layerId of PUBLIC_MAP_POI_CLICK_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.on('mouseenter', layerId, onEnter);
      map.on('mouseleave', layerId, onLeave);
    }
  }

  return () => {
    for (const layerId of PUBLIC_MAP_POI_CLICK_LAYER_IDS) {
      if (map.getLayer(layerId)) {
        map.off('mouseenter', layerId, onEnter);
        map.off('mouseleave', layerId, onLeave);
      }
    }
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };
}
