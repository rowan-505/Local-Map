/**
 * Applies or clears the selected transport stop marker on the map.
 * Hides the Martin tile dot and draws halo + anchor circle + pin (MapLibre layers, not DOM).
 */
import type { MapEngine } from '../mapEngineTypes';
import { setTransportSelectedStopId } from './transportLayers';
import {
  setSelectedTransportStop,
  type TransportStopHighlight,
} from './transportStopHighlight';

export function applySelectedTransportMarker(
  map: MapEngine,
  highlight: TransportStopHighlight | null,
): void {
  setSelectedTransportStop(map, highlight);
  setTransportSelectedStopId(map, highlight?.id ?? null);
}
