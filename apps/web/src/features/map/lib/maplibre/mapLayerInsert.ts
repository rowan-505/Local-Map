import type { LayerSpecification } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import { TRANSPORT_STOPS_LAYER_ID } from './publicMapMarkerLayerIds';

/** Route + legacy overlay layer ids — never used as insertion anchors. */
const ROUTE_OVERLAY_LAYER_IDS = new Set([
  'route-connector-from-line',
  'route-connector-to-line',
  'route-connector-line',
  'route-active-casing',
  'route-active-line',
  'route-start-halo',
  'route-end-halo',
  'route-start-point',
  'route-end-point',
  'route-direction-arrows',
]);

const LABEL_LAYER_ID_PATTERN = /label|labels|name|text/i;
const ROAD_LINE_LAYER_ID_PATTERN = /road|street|highway|path/i;
const ROAD_SOURCE_LAYER_PATTERN = /street|road|highway|transport/i;

type StyleLayer = LayerSpecification & {
  readonly source?: string;
  readonly 'source-layer'?: string;
  readonly layout?: { readonly 'text-field'?: unknown };
};

/**
 * Bottom-most symbol layer (legacy helper — not used for route placement).
 * @see findRouteOverlayInsertBeforeLayerId
 */
export function findFirstSymbolLayerId(map: MapEngine): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers?.length) return undefined;

  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    if (ROUTE_OVERLAY_LAYER_IDS.has(layer.id)) continue;
    return layer.id;
  }

  return undefined;
}

/** Index of the topmost basemap road line layer in paint order. */
export function findLastRoadLineLayerIndex(map: MapEngine): number {
  const layers = map.getStyle()?.layers;
  if (!layers?.length) return -1;

  let lastIndex = -1;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i] as StyleLayer;
    if (ROUTE_OVERLAY_LAYER_IDS.has(layer.id)) continue;
    if (isRoadLineLayer(layer)) lastIndex = i;
  }
  return lastIndex;
}

/**
 * Insert route overlays immediately below the first text label layer that sits
 * above road line geometry — keeps roads under the route and labels over the route.
 */
export function findRouteOverlayInsertBeforeLayerId(map: MapEngine): string | undefined {
  if (typeof map.getLayer === 'function' && map.getLayer(TRANSPORT_STOPS_LAYER_ID)) {
    return TRANSPORT_STOPS_LAYER_ID;
  }

  const layers = map.getStyle()?.layers;
  if (!layers?.length) return undefined;

  const lastRoadLineIndex = findLastRoadLineLayerIndex(map);

  for (let i = 0; i < layers.length; i++) {
    if (i <= lastRoadLineIndex) continue;
    const layer = layers[i] as StyleLayer;
    if (ROUTE_OVERLAY_LAYER_IDS.has(layer.id)) continue;
    if (layer.type !== 'symbol') continue;
    if (isTextLabelSymbolLayer(layer)) return layer.id;
  }

  for (let i = 0; i < layers.length; i++) {
    if (i <= lastRoadLineIndex) continue;
    const layer = layers[i] as StyleLayer;
    if (ROUTE_OVERLAY_LAYER_IDS.has(layer.id)) continue;
    if (layer.type === 'symbol' && LABEL_LAYER_ID_PATTERN.test(layer.id)) return layer.id;
  }

  for (let i = Math.max(0, lastRoadLineIndex + 1); i < layers.length; i++) {
    const layer = layers[i] as StyleLayer;
    if (ROUTE_OVERLAY_LAYER_IDS.has(layer.id)) continue;
    return layer.id;
  }

  return undefined;
}

/** @deprecated Use {@link findRouteOverlayInsertBeforeLayerId}. */
export function routeOverlayInsertBeforeLayerId(map: MapEngine): string | undefined {
  return findRouteOverlayInsertBeforeLayerId(map);
}

function isRoadLineLayer(layer: StyleLayer): boolean {
  if (layer.type !== 'line') return false;
  if (ROAD_LINE_LAYER_ID_PATTERN.test(layer.id)) return true;
  const sourceLayer = layer['source-layer'] ?? '';
  return ROAD_SOURCE_LAYER_PATTERN.test(sourceLayer);
}

function isTextLabelSymbolLayer(layer: StyleLayer): boolean {
  if (layer.type !== 'symbol') return false;
  if (LABEL_LAYER_ID_PATTERN.test(layer.id)) return true;
  const textField = layer.layout?.['text-field'];
  return textField !== undefined && textField !== null && textField !== '';
}
