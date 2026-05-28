import type { GeoJSONSource } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import {
  overlayToGeoJSON,
  ROUTE_ACTIVE_SOURCE_ID,
  type DirectionsMapOverlay,
} from './directionsRouteGeoJson';
import { PLACES_IMPORTANT_LAYER_ID, PLACES_LAYER_ID, PLACES_SELECTED_HALO_LAYER_ID } from './placesOnMap';

export {
  bboxFromDirectionsOverlay,
  overlayToGeoJSON,
  ROUTE_ACTIVE_SOURCE_ID,
  type DirectionsMapOverlay,
} from './directionsRouteGeoJson';

export const ROUTE_ACTIVE_CASING_LAYER_ID = 'route-active-casing' as const;
export const ROUTE_ACTIVE_LINE_LAYER_ID = 'route-active-line' as const;
export const ROUTE_START_POINT_LAYER_ID = 'route-start-point' as const;
export const ROUTE_END_POINT_LAYER_ID = 'route-end-point' as const;

const ROUTE_LINE_LAYER_IDS = [ROUTE_ACTIVE_CASING_LAYER_ID, ROUTE_ACTIVE_LINE_LAYER_ID] as const;
const ROUTE_ENDPOINT_LAYER_IDS = [ROUTE_START_POINT_LAYER_ID, ROUTE_END_POINT_LAYER_ID] as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Idempotent: creates source + layers once; no-op until style is loaded. */
export function ensureDirectionsRouteLayers(map: MapEngine): boolean {
  if (!map.isStyleLoaded()) return false;

  if (!map.getSource(ROUTE_ACTIVE_SOURCE_ID)) {
    map.addSource(ROUTE_ACTIVE_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  const lineInsertBefore = routeLineInsertBeforeLayerId(map);

  if (!map.getLayer(ROUTE_ACTIVE_CASING_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_ACTIVE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0c4a6e',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 8, 18, 11],
          'line-opacity': 0.55,
        },
      },
      lineInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_ACTIVE_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_ACTIVE_LINE_LAYER_ID,
        type: 'line',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0284c7',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5.5, 18, 7],
          'line-opacity': 0.95,
        },
      },
      lineInsertBefore,
    );
  }

  const endpointInsertBefore = routeEndpointInsertBeforeLayerId(map);

  if (!map.getLayer(ROUTE_START_POINT_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_START_POINT_LAYER_ID,
        type: 'circle',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'from']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8, 18, 10],
          'circle-color': '#10b981',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      },
      endpointInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_END_POINT_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_END_POINT_LAYER_ID,
        type: 'circle',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'to']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8, 18, 10],
          'circle-color': '#f97316',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      },
      endpointInsertBefore,
    );
  }

  return true;
}

/** Updates GeoJSON only — never duplicates layers. */
export function setDirectionsRouteOverlay(
  map: MapEngine,
  overlay: DirectionsMapOverlay | null,
): void {
  if (!map.isStyleLoaded()) return;
  if (!ensureDirectionsRouteLayers(map)) return;

  const src = map.getSource(ROUTE_ACTIVE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;

  src.setData(overlayToGeoJSON(overlay));
  positionActiveRouteLayers(map);
}

export function ensureDirectionsRouteLayer(
  map: MapEngine,
  overlay: DirectionsMapOverlay | null,
): void {
  setDirectionsRouteOverlay(map, overlay);
}

export function moveDirectionsRouteLayersToTop(map: MapEngine): void {
  positionActiveRouteLayers(map);
}

/** Route line under POI markers; endpoints above normal POI, below selected pin. */
export function positionActiveRouteLayers(map: MapEngine): void {
  const lineBefore =
    map.getLayer(PLACES_IMPORTANT_LAYER_ID) !== undefined
      ? PLACES_IMPORTANT_LAYER_ID
      : map.getLayer(PLACES_LAYER_ID) !== undefined
        ? PLACES_LAYER_ID
        : null;

  if (lineBefore) {
    for (const layerId of ROUTE_LINE_LAYER_IDS) {
      if (map.getLayer(layerId)) map.moveLayer(layerId, lineBefore);
    }
  }

  const endpointBefore =
    map.getLayer(PLACES_SELECTED_HALO_LAYER_ID) !== undefined
      ? PLACES_SELECTED_HALO_LAYER_ID
      : null;

  if (endpointBefore) {
    for (const layerId of ROUTE_ENDPOINT_LAYER_IDS) {
      if (map.getLayer(layerId)) map.moveLayer(layerId, endpointBefore);
    }
  } else {
    for (const layerId of ROUTE_ENDPOINT_LAYER_IDS) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }
}

function routeLineInsertBeforeLayerId(map: MapEngine): string | undefined {
  if (map.getLayer(PLACES_IMPORTANT_LAYER_ID)) return PLACES_IMPORTANT_LAYER_ID;
  if (map.getLayer(PLACES_LAYER_ID)) return PLACES_LAYER_ID;
  return undefined;
}

function routeEndpointInsertBeforeLayerId(map: MapEngine): string | undefined {
  if (map.getLayer(PLACES_SELECTED_HALO_LAYER_ID)) return PLACES_SELECTED_HALO_LAYER_ID;
  return undefined;
}
