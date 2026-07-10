/**
 * Unified public-map click handling with deterministic feature priority.
 */
import type { MapEngine, MapMouseEvent } from '../mapEngineTypes';
import type { MapClickedLocation } from '../../types';
import type { TransportMapSelection } from '@/features/transport/transportMapSelection';
import { transportSelectionFromFeature } from '@/features/transport/transportMapSelection';
import {
  isTransportMapClickTargetKind,
  resolveMapClickTarget,
} from './publicMapClickResolver';
import { applySelectedTransportMarker } from './selectedTransportMarker';
import { showTransportLineFeaturePopup } from './transportMapInteractions';

export type RoutePickMode = 'from' | 'to' | null;

export type BindPublicMapClickInteractionsOptions = {
  readonly getRoutePickMode?: () => RoutePickMode;
  readonly onSelectPoiId?: (id: string | null) => void;
  readonly onSelectTransportStop?: (selection: TransportMapSelection) => void;
  readonly onEmptyMapClick?: (location: MapClickedLocation) => void;
};

export function bindPublicMapClickInteractions(
  map: MapEngine,
  options: BindPublicMapClickInteractionsOptions = {},
): () => void {
  const onClick = (event: MapMouseEvent) => {
    const pickMode = options.getRoutePickMode?.() ?? null;
    const target = resolveMapClickTarget(map, event.point);

    if (pickMode) {
      if (target.kind === 'transport_stop' || target.kind === 'transport_terminal') {
        const feature = target.feature;
        if (feature) {
          const selection = transportSelectionFromFeature(feature);
          if (selection) {
            options.onEmptyMapClick?.({
              label: selection.preview.name,
              coordinates: selection.coordinates,
            });
            return;
          }
        }
      }

      options.onEmptyMapClick?.({
        label: 'Selected map point',
        coordinates: [event.lngLat.lng, event.lngLat.lat],
      });
      return;
    }

    if (target.kind === 'poi_selected' || target.kind === 'poi') {
      const raw = target.feature?.properties?.id;
      if (typeof raw === 'string') {
        options.onSelectPoiId?.(raw);
        return;
      }
      options.onSelectPoiId?.(null);
      options.onEmptyMapClick?.({
        label: 'Clicked location',
        coordinates: [event.lngLat.lng, event.lngLat.lat],
      });
      return;
    }

    if (target.kind === 'transport_selected') {
      event.originalEvent?.stopPropagation?.();
      return;
    }

    if (target.kind === 'transport_stop' || target.kind === 'transport_terminal') {
      const feature = target.feature;
      if (!feature) return;

      const selection = transportSelectionFromFeature(feature);
      if (!selection) return;

      applySelectedTransportMarker(map, selection.highlight);
      options.onSelectTransportStop?.(selection);
      event.originalEvent?.stopPropagation?.();
      return;
    }

    if (target.kind === 'transport_line' && target.feature) {
      showTransportLineFeaturePopup(map, event, target.feature);
      return;
    }

    if (!isTransportMapClickTargetKind(target.kind)) {
      options.onSelectPoiId?.(null);
      options.onEmptyMapClick?.({
        label: 'Clicked location',
        coordinates: [event.lngLat.lng, event.lngLat.lat],
      });
    }
  };

  map.on('click', onClick);
  return () => {
    map.off('click', onClick);
  };
}
