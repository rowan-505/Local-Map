/**
 * GeoJSON label overlays from `/public/map/geo/*` (bus routes and stops).
 * Road labels come from PMTiles `road_labels` only — not from `/public/map/geo/streets`.
 */
import type {
  ExpressionSpecification,
  GeoJSONSource,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import { PLACES_LAYER_ID } from './publicMapMarkerLayerIds';

export const PUBLIC_MAP_EMPTY_FC = Object.freeze({
  type: 'FeatureCollection' as const,
  features: [] as GeoJSON.Feature[],
});

export const BUS_ROUTE_LABEL_SOURCE_ID = 'public-map-bus-route-labels-src';
export const BUS_STOP_LABEL_SOURCE_ID = 'public-map-bus-stop-labels-src';

const BUS_ROUTE_LAYER_ID = 'public-map-bus-route-labels';
const BUS_STOP_LAYER_ID = 'public-map-bus-stop-labels';

const TEXT_GET_NAME = ['get', 'name'] as ExpressionSpecification;

export const PUBLIC_MAP_GEO_LABEL_LAYER_IDS = [
  BUS_ROUTE_LAYER_ID,
  BUS_STOP_LAYER_ID,
] as const;

const LINE_TEXT_SIZE_INTERPOLATE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  10,
  16,
  12,
  20,
  14,
];

const LINE_LAYOUT_SHARED = {
  'symbol-placement': 'line' as const,
  'text-field': TEXT_GET_NAME,
  'text-size': LINE_TEXT_SIZE_INTERPOLATE,
  'text-font': ['Noto Sans Regular'],
  'text-rotation-alignment': 'map' as const,
  'text-pitch-alignment': 'viewport' as const,
  'text-keep-upright': true as const,
  'text-max-angle': 35,
  'text-padding': 4,
  'text-allow-overlap': false as const,
  'text-ignore-placement': false as const,
  'text-optional': true as const,
};

function addSymbolLayerRelative(
  map: MapEngine,
  spec: SymbolLayerSpecification,
  beforeLayerId?: string,
): void {
  if (beforeLayerId !== undefined && map.getLayer(beforeLayerId)) {
    map.addLayer(spec as never, beforeLayerId);
  } else {
    map.addLayer(spec as never);
  }
}

function busRouteLineSymbolLayer(): SymbolLayerSpecification {
  return {
    id: BUS_ROUTE_LAYER_ID,
    type: 'symbol',
    source: BUS_ROUTE_LABEL_SOURCE_ID,
    minzoom: 12,
    layout: {
      ...LINE_LAYOUT_SHARED,
      'symbol-spacing': 250,
    },
    paint: {
      'text-color': '#a35f17',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.35,
      'text-halo-blur': 0.2,
      'text-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        0.5,
        16,
        0.82,
      ],
    },
  };
}

function pointSymbolLayer(
  id: string,
  source: string,
  minzoom: number,
  paint: SymbolLayerSpecification['paint'],
): SymbolLayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    minzoom,
    layout: {
      'text-field': TEXT_GET_NAME,
      'text-font': ['Noto Sans Myanmar Regular', 'Noto Sans Regular'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        minzoom,
        9.5,
        minzoom + 2,
        10.5,
        minzoom + 5,
        12,
      ],
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-padding': 6,
      'text-optional': true,
    },
    paint,
  };
}

/**
 * Insert GeoJSON overlays once after style load. Line labels anchor before `bus-stops`
 * so they paint above respective line layers yet stay under POI overlays.
 */
export function ensurePublicMapGeoJsonLabelLayers(map: MapEngine): void {
  if (!map.getSource(BUS_ROUTE_LABEL_SOURCE_ID)) {
    map.addSource(BUS_ROUTE_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: { ...PUBLIC_MAP_EMPTY_FC },
    });
    addSymbolLayerRelative(map, busRouteLineSymbolLayer(), 'bus-stops');
  }

  if (!map.getSource(BUS_STOP_LABEL_SOURCE_ID)) {
    map.addSource(BUS_STOP_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: { ...PUBLIC_MAP_EMPTY_FC },
    });
    addSymbolLayerRelative(
      map,
      pointSymbolLayer(BUS_STOP_LAYER_ID, BUS_STOP_LABEL_SOURCE_ID, 15, {
        'text-color': '#92400e',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.2,
      }),
      'poi-circles',
    );
  }

  restorePublicMapLayersUnderPlaces(map);
}

/** After POI layers are (re-)added, tuck public map overlays directly under them for hit-target priority. */
export function restorePublicMapLayersUnderPlaces(map: MapEngine): void {
  if (!map.getLayer(PLACES_LAYER_ID)) return;
  const labelStack = [BUS_ROUTE_LAYER_ID, BUS_STOP_LAYER_ID] as const;
  /** Move bottom-most first so the stack order bottom→top matches `labelStack`. */
  for (const lid of labelStack) {
    if (map.getLayer(lid)) {
      map.moveLayer(lid, PLACES_LAYER_ID);
    }
  }
}

export function setPublicMapGeoJsonSourceData(
  map: MapEngine,
  sourceId: string,
  data: GeoJSON.FeatureCollection | typeof PUBLIC_MAP_EMPTY_FC,
): void {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!src || src.type !== 'geojson') return;
  src.setData(data as GeoJSON.FeatureCollection);
}
