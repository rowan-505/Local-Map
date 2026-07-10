import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import {
  overlayConnectorsToGeoJSON,
  overlayToGeoJSON,
  ROUTE_ACTIVE_SOURCE_ID,
  ROUTE_CONNECTOR_SOURCE_ID,
  type DirectionsMapOverlay,
} from './directionsRouteGeoJson';
import { applyMapLayerStackBottomToTop } from './mapLayerStack';
import { findRouteOverlayInsertBeforeLayerId } from './mapLayerInsert';
import { PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP } from './publicMapMarkerStackOrder';
import { PLACES_SELECTED_HALO_LAYER_ID } from './publicMapMarkerLayerIds';
export {
  bboxFromDirectionsOverlay,
  overlayConnectorsToGeoJSON,
  overlayToGeoJSON,
  ROUTE_ACTIVE_SOURCE_ID,
  ROUTE_CONNECTOR_SOURCE_ID,
  type DirectionsMapOverlay,
} from './directionsRouteGeoJson';

export const ROUTE_ACTIVE_CASING_LAYER_ID = 'route-active-casing' as const;
/** @deprecated Split into from/to connector layers. */
export const ROUTE_CONNECTOR_LINE_LAYER_ID = 'route-connector-line' as const;
export const ROUTE_CONNECTOR_FROM_LAYER_ID = 'route-connector-from-line' as const;
export const ROUTE_CONNECTOR_TO_LAYER_ID = 'route-connector-to-line' as const;
export const ROUTE_ACTIVE_LINE_LAYER_ID = 'route-active-line' as const;
export const ROUTE_START_HALO_LAYER_ID = 'route-start-halo' as const;
export const ROUTE_END_HALO_LAYER_ID = 'route-end-halo' as const;
export const ROUTE_START_POINT_LAYER_ID = 'route-start-point' as const;
export const ROUTE_END_POINT_LAYER_ID = 'route-end-point' as const;

/** Direction is conveyed by endpoint markers + sidebar steps — no line-following arrow symbols. */

/** Removed arrow layer — kept for idempotent cleanup on existing map sessions. */
const LEGACY_ROUTE_DIRECTION_ARROWS_LAYER_ID = 'route-direction-arrows' as const;
const LEGACY_ROUTE_DIRECTION_ARROW_IMAGE_ID = 'route-direction-arrow' as const;

/** MapLibre requires literal wrapper for constant dash arrays on GeoJSON lines. */
const CONNECTOR_LINE_DASH: ['literal', number[]] = ['literal', [1, 1.25]];

const ROUTE_ACTIVE_COLOR = '#0284c7';
const ROUTE_ACTIVE_LINE_OPACITY = 0.9;
const ROUTE_CASING_COLOR = '#ffffff';
const ROUTE_CONNECTOR_LINE_OPACITY = 0.55;

const ROUTE_ACTIVE_LINE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  2.5,
  14,
  4.5,
  16,
  5,
  18,
  5,
];

const ROUTE_CASING_LINE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  3.5,
  14,
  5,
  18,
  6,
];

const ROUTE_CONNECTOR_LINE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  1.25,
  14,
  1.75,
  18,
  2,
];
const ROUTE_FROM_COLOR = '#10b981';
const ROUTE_TO_COLOR = '#f97316';

const ROUTE_ENDPOINT_HALO_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  9,
  14,
  11,
  18,
  13,
];

const ROUTE_ENDPOINT_DOT_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  6,
  14,
  7.5,
  18,
  9,
];

const ROUTE_ENDPOINT_STROKE_COLOR = '#ffffff';
const ROUTE_ENDPOINT_STROKE_WIDTH = 2.5;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Idempotent: creates source + layers once; no-op until style is loaded. */
export function ensureDirectionsRouteLayers(map: MapEngine): boolean {
  if (!map.isStyleLoaded()) return false;

  removeLegacyRouteDirectionArrowOverlay(map);

  if (!map.getSource(ROUTE_ACTIVE_SOURCE_ID)) {
    map.addSource(ROUTE_ACTIVE_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  if (!map.getSource(ROUTE_CONNECTOR_SOURCE_ID)) {
    map.addSource(ROUTE_CONNECTOR_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_FC,
    });
  }

  const routeLineInsertBefore = findRouteOverlayInsertBeforeLayerId(map);
  const routeEndpointInsertBefore = findRouteEndpointInsertBeforeLayerId(map);

  if (map.getLayer(ROUTE_CONNECTOR_LINE_LAYER_ID)) {
    map.removeLayer(ROUTE_CONNECTOR_LINE_LAYER_ID);
  }

  if (!map.getLayer(ROUTE_CONNECTOR_FROM_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_CONNECTOR_FROM_LAYER_ID,
        type: 'line',
        source: ROUTE_CONNECTOR_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'from-connector'],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#10b981',
          'line-width': ROUTE_CONNECTOR_LINE_WIDTH,
          'line-opacity': ROUTE_CONNECTOR_LINE_OPACITY,
          'line-dasharray': CONNECTOR_LINE_DASH,
        },
      },
      routeLineInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_CONNECTOR_TO_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_CONNECTOR_TO_LAYER_ID,
        type: 'line',
        source: ROUTE_CONNECTOR_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'to-connector'],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#f97316',
          'line-width': ROUTE_CONNECTOR_LINE_WIDTH,
          'line-opacity': ROUTE_CONNECTOR_LINE_OPACITY,
          'line-dasharray': CONNECTOR_LINE_DASH,
        },
      },
      routeLineInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_ACTIVE_CASING_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_ACTIVE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['get', 'kind'], 'route'],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ROUTE_CASING_COLOR,
          'line-width': ROUTE_CASING_LINE_WIDTH,
          'line-opacity': 0.38,
        },
      },
      routeLineInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_ACTIVE_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_ACTIVE_LINE_LAYER_ID,
        type: 'line',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['get', 'kind'], 'route'],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ROUTE_ACTIVE_COLOR,
          'line-width': ROUTE_ACTIVE_LINE_WIDTH,
          'line-opacity': ROUTE_ACTIVE_LINE_OPACITY,
        },
      },
      routeLineInsertBefore,
    );
  }

  applyActiveRouteLayerPaint(map);

  if (!map.getLayer(ROUTE_START_HALO_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_START_HALO_LAYER_ID,
        type: 'circle',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'from']],
        paint: {
          'circle-radius': ROUTE_ENDPOINT_HALO_RADIUS,
          'circle-color': ROUTE_FROM_COLOR,
          'circle-opacity': 0.2,
          'circle-stroke-width': 0,
        },
      },
      routeEndpointInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_END_HALO_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_END_HALO_LAYER_ID,
        type: 'circle',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'to']],
        paint: {
          'circle-radius': ROUTE_ENDPOINT_HALO_RADIUS,
          'circle-color': ROUTE_TO_COLOR,
          'circle-opacity': 0.2,
          'circle-stroke-width': 0,
        },
      },
      routeEndpointInsertBefore,
    );
  }

  if (!map.getLayer(ROUTE_START_POINT_LAYER_ID)) {
    map.addLayer(
      {
        id: ROUTE_START_POINT_LAYER_ID,
        type: 'circle',
        source: ROUTE_ACTIVE_SOURCE_ID,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'from']],
        paint: {
          'circle-radius': ROUTE_ENDPOINT_DOT_RADIUS,
          'circle-color': ROUTE_FROM_COLOR,
          'circle-stroke-color': ROUTE_ENDPOINT_STROKE_COLOR,
          'circle-stroke-width': ROUTE_ENDPOINT_STROKE_WIDTH,
        },
      },
      routeEndpointInsertBefore,
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
          'circle-radius': ROUTE_ENDPOINT_DOT_RADIUS,
          'circle-color': ROUTE_TO_COLOR,
          'circle-stroke-color': ROUTE_ENDPOINT_STROKE_COLOR,
          'circle-stroke-width': ROUTE_ENDPOINT_STROKE_WIDTH,
        },
      },
      routeEndpointInsertBefore,
    );
  }

  applyRouteEndpointLayerPaint(map);

  positionActiveRouteLayers(map);

  return true;
}

/** Updates GeoJSON only — never duplicates layers. */
export function setDirectionsRouteOverlay(
  map: MapEngine,
  overlay: DirectionsMapOverlay | null,
): void {
  const hasContent = hasRouteOverlayContent(overlay);

  if (!map.isStyleLoaded()) {
    if (hasContent) warnRouteOverlay('Map style not loaded; route overlay was not updated.');
    return;
  }

  if (!ensureDirectionsRouteLayers(map)) {
    if (hasContent) warnRouteOverlay('Could not ensure route overlay layers.');
    return;
  }

  const src = map.getSource(ROUTE_ACTIVE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) {
    if (hasContent) warnRouteOverlay('route-active-source is missing after layer setup.');
    return;
  }

  src.setData(overlayToGeoJSON(overlay));

  const connectorSrc = map.getSource(ROUTE_CONNECTOR_SOURCE_ID) as GeoJSONSource | undefined;
  if (!connectorSrc) {
    if (hasContent) warnRouteOverlay('route-connector-source is missing after layer setup.');
  } else {
    try {
      connectorSrc.setData(overlayConnectorsToGeoJSON(overlay));
    } catch (error) {
      connectorSrc.setData(EMPTY_FC);
      if (hasContent) warnRouteOverlay('Failed to update route connector GeoJSON.', error);
    }
  }

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

/**
 * Route lines sit above transport paths and below bus stops; start/end markers sit above
 * normal POIs and below the selected POI pin.
 */
export function positionActiveRouteLayers(map: MapEngine): void {
  applyMapLayerStackBottomToTop(map, PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP);
}

/** Above normal POIs; below selected POI halo + pin. */
function findRouteEndpointInsertBeforeLayerId(map: MapEngine): string | undefined {
  if (map.getLayer(PLACES_SELECTED_HALO_LAYER_ID)) return PLACES_SELECTED_HALO_LAYER_ID;
  return findRouteOverlayInsertBeforeLayerId(map);
}

/** Keeps paint in sync when layers already exist (hot reload / style tweaks). */
function applyRouteEndpointLayerPaint(map: MapEngine): void {
  for (const layerId of [ROUTE_START_HALO_LAYER_ID, ROUTE_END_HALO_LAYER_ID] as const) {
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, 'circle-radius', ROUTE_ENDPOINT_HALO_RADIUS);
    map.setPaintProperty(layerId, 'circle-opacity', 0.2);
    map.setPaintProperty(layerId, 'circle-stroke-width', 0);
  }
  if (map.getLayer(ROUTE_START_HALO_LAYER_ID)) {
    map.setPaintProperty(ROUTE_START_HALO_LAYER_ID, 'circle-color', ROUTE_FROM_COLOR);
  }
  if (map.getLayer(ROUTE_END_HALO_LAYER_ID)) {
    map.setPaintProperty(ROUTE_END_HALO_LAYER_ID, 'circle-color', ROUTE_TO_COLOR);
  }
  if (map.getLayer(ROUTE_START_POINT_LAYER_ID)) {
    map.setPaintProperty(ROUTE_START_POINT_LAYER_ID, 'circle-radius', ROUTE_ENDPOINT_DOT_RADIUS);
    map.setPaintProperty(ROUTE_START_POINT_LAYER_ID, 'circle-color', ROUTE_FROM_COLOR);
    map.setPaintProperty(ROUTE_START_POINT_LAYER_ID, 'circle-stroke-color', ROUTE_ENDPOINT_STROKE_COLOR);
    map.setPaintProperty(ROUTE_START_POINT_LAYER_ID, 'circle-stroke-width', ROUTE_ENDPOINT_STROKE_WIDTH);
  }
  if (map.getLayer(ROUTE_END_POINT_LAYER_ID)) {
    map.setPaintProperty(ROUTE_END_POINT_LAYER_ID, 'circle-radius', ROUTE_ENDPOINT_DOT_RADIUS);
    map.setPaintProperty(ROUTE_END_POINT_LAYER_ID, 'circle-color', ROUTE_TO_COLOR);
    map.setPaintProperty(ROUTE_END_POINT_LAYER_ID, 'circle-stroke-color', ROUTE_ENDPOINT_STROKE_COLOR);
    map.setPaintProperty(ROUTE_END_POINT_LAYER_ID, 'circle-stroke-width', ROUTE_ENDPOINT_STROKE_WIDTH);
  }
}

function hasRouteOverlayContent(overlay: DirectionsMapOverlay | null): boolean {
  if (!overlay) return false;
  return Boolean(
    overlay.geometry?.coordinates?.length || overlay.from !== null || overlay.to !== null,
  );
}

function warnRouteOverlay(message: string, detail?: unknown): void {
  if (detail !== undefined) console.warn('[CoreMap route]', message, detail);
  else console.warn('[CoreMap route]', message);
}

function applyActiveRouteLayerPaint(map: MapEngine): void {
  if (map.getLayer(ROUTE_CONNECTOR_FROM_LAYER_ID)) {
    map.setPaintProperty(ROUTE_CONNECTOR_FROM_LAYER_ID, 'line-width', ROUTE_CONNECTOR_LINE_WIDTH);
    map.setPaintProperty(ROUTE_CONNECTOR_FROM_LAYER_ID, 'line-opacity', ROUTE_CONNECTOR_LINE_OPACITY);
    map.setPaintProperty(ROUTE_CONNECTOR_FROM_LAYER_ID, 'line-dasharray', CONNECTOR_LINE_DASH);
  }
  if (map.getLayer(ROUTE_CONNECTOR_TO_LAYER_ID)) {
    map.setPaintProperty(ROUTE_CONNECTOR_TO_LAYER_ID, 'line-width', ROUTE_CONNECTOR_LINE_WIDTH);
    map.setPaintProperty(ROUTE_CONNECTOR_TO_LAYER_ID, 'line-opacity', ROUTE_CONNECTOR_LINE_OPACITY);
    map.setPaintProperty(ROUTE_CONNECTOR_TO_LAYER_ID, 'line-dasharray', CONNECTOR_LINE_DASH);
  }
  if (map.getLayer(ROUTE_ACTIVE_CASING_LAYER_ID)) {
    map.setPaintProperty(ROUTE_ACTIVE_CASING_LAYER_ID, 'line-color', ROUTE_CASING_COLOR);
    map.setPaintProperty(ROUTE_ACTIVE_CASING_LAYER_ID, 'line-width', ROUTE_CASING_LINE_WIDTH);
    map.setPaintProperty(ROUTE_ACTIVE_CASING_LAYER_ID, 'line-opacity', 0.38);
  }
  if (map.getLayer(ROUTE_ACTIVE_LINE_LAYER_ID)) {
    map.setPaintProperty(ROUTE_ACTIVE_LINE_LAYER_ID, 'line-color', ROUTE_ACTIVE_COLOR);
    map.setPaintProperty(ROUTE_ACTIVE_LINE_LAYER_ID, 'line-width', ROUTE_ACTIVE_LINE_WIDTH);
    map.setPaintProperty(ROUTE_ACTIVE_LINE_LAYER_ID, 'line-opacity', ROUTE_ACTIVE_LINE_OPACITY);
  }
}

function removeLegacyRouteDirectionArrowOverlay(map: MapEngine): void {
  if (map.getLayer(LEGACY_ROUTE_DIRECTION_ARROWS_LAYER_ID)) {
    map.removeLayer(LEGACY_ROUTE_DIRECTION_ARROWS_LAYER_ID);
  }
  if (map.hasImage(LEGACY_ROUTE_DIRECTION_ARROW_IMAGE_ID)) {
    map.removeImage(LEGACY_ROUTE_DIRECTION_ARROW_IMAGE_ID);
  }
}
