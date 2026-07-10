/**
 * One reusable search-result highlight overlay.
 *
 * A single GeoJSON source feeds four type-filtered layers (polygon fill, polygon
 * outline, line, point). We never create a layer per result: selecting a result
 * only calls `source.setData()`. Layers are added once via
 * `ensureSearchHighlightLayers` and reused for the life of the map.
 */
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { PublicSearchResult, SearchEntityType, SearchResultGeometry } from '@/features/poi/api/publicMapApi';
import type { MapCameraPadding } from '../mapCameraPadding';
import type { MapEngine } from '../mapEngineTypes';

export const SEARCH_HIGHLIGHT_SOURCE_ID = 'search-highlight-source' as const;
export const SEARCH_HIGHLIGHT_POLYGON_FILL_LAYER_ID = 'search-highlight-polygon-fill' as const;
export const SEARCH_HIGHLIGHT_POLYGON_OUTLINE_LAYER_ID =
  'search-highlight-polygon-outline' as const;
export const SEARCH_HIGHLIGHT_LINE_LAYER_ID = 'search-highlight-line' as const;
export const SEARCH_HIGHLIGHT_POINT_LAYER_ID = 'search-highlight-point' as const;

export const SEARCH_HIGHLIGHT_LAYER_IDS = [
  SEARCH_HIGHLIGHT_POLYGON_FILL_LAYER_ID,
  SEARCH_HIGHLIGHT_POLYGON_OUTLINE_LAYER_ID,
  SEARCH_HIGHLIGHT_LINE_LAYER_ID,
  SEARCH_HIGHLIGHT_POINT_LAYER_ID,
] as const;

const HIGHLIGHT_COLOR = '#2563eb';
const HIGHLIGHT_FILL_OPACITY = 0.14;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Point-like results render a pin directly; everything else fetches geometry on select. */
const POINT_LIKE_ENTITY_TYPES: ReadonlySet<SearchEntityType> = new Set([
  'place',
  'address',
  'bus_stop',
  'transport_stop',
  'transport_terminal',
  'plus_code',
  'coordinate',
]);

const POLYGON_GEOMETRY: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
];
const LINE_GEOMETRY: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
];
const POINT_GEOMETRY: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Point', 'MultiPoint'],
  true,
  false,
];

const HIGHLIGHT_LINE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  3,
  14,
  4.5,
  18,
  6,
];

const HIGHLIGHT_POINT_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  6,
  14,
  8,
  18,
  11,
];

/** Camera animation duration for selecting a result (kept snappy: 300–500ms). */
export const SEARCH_HIGHLIGHT_CAMERA_DURATION_MS = 400;

export type FitSearchResultOptions = {
  readonly padding?: MapCameraPadding | number;
  /** Pre-fetched geometry from React Query (selection overlay). */
  readonly geometry?: SearchResultGeometry | null;
  /** Override the point fly-to zoom; defaults to a per-entity value. */
  readonly zoom?: number;
  readonly duration?: number;
};

/** Idempotent: creates the source + four layers once. No-op if style not ready. */
export function ensureSearchHighlightLayers(map: MapEngine): boolean {
  if (!map.isStyleLoaded()) return false;

  if (!map.getSource(SEARCH_HIGHLIGHT_SOURCE_ID)) {
    map.addSource(SEARCH_HIGHLIGHT_SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
  }

  if (!map.getLayer(SEARCH_HIGHLIGHT_POLYGON_FILL_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_HIGHLIGHT_POLYGON_FILL_LAYER_ID,
      type: 'fill',
      source: SEARCH_HIGHLIGHT_SOURCE_ID,
      filter: POLYGON_GEOMETRY,
      paint: {
        'fill-color': HIGHLIGHT_COLOR,
        'fill-opacity': HIGHLIGHT_FILL_OPACITY,
      },
    });
  }

  if (!map.getLayer(SEARCH_HIGHLIGHT_POLYGON_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_HIGHLIGHT_POLYGON_OUTLINE_LAYER_ID,
      type: 'line',
      source: SEARCH_HIGHLIGHT_SOURCE_ID,
      filter: POLYGON_GEOMETRY,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': HIGHLIGHT_COLOR,
        'line-width': HIGHLIGHT_LINE_WIDTH,
        'line-opacity': 0.85,
      },
    });
  }

  if (!map.getLayer(SEARCH_HIGHLIGHT_LINE_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_HIGHLIGHT_LINE_LAYER_ID,
      type: 'line',
      source: SEARCH_HIGHLIGHT_SOURCE_ID,
      filter: LINE_GEOMETRY,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': HIGHLIGHT_COLOR,
        'line-width': HIGHLIGHT_LINE_WIDTH,
        'line-opacity': 0.9,
      },
    });
  }

  if (!map.getLayer(SEARCH_HIGHLIGHT_POINT_LAYER_ID)) {
    map.addLayer({
      id: SEARCH_HIGHLIGHT_POINT_LAYER_ID,
      type: 'circle',
      source: SEARCH_HIGHLIGHT_SOURCE_ID,
      filter: POINT_GEOMETRY,
      paint: {
        'circle-radius': HIGHLIGHT_POINT_RADIUS,
        'circle-color': HIGHLIGHT_COLOR,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    });
  }

  return true;
}

/** Updates GeoJSON only — never adds/removes layers. */
export function setSearchHighlight(
  map: MapEngine,
  featureOrCollection: GeoJSON.Feature | GeoJSON.FeatureCollection,
): void {
  if (!ensureSearchHighlightLayers(map)) return;
  const src = map.getSource(SEARCH_HIGHLIGHT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(
    featureOrCollection.type === 'FeatureCollection'
      ? featureOrCollection
      : { type: 'FeatureCollection', features: [featureOrCollection] },
  );
}

/** Empties the highlight source — keeps layers in place for reuse. */
export function clearSearchHighlight(map: MapEngine): void {
  const src = map.getSource(SEARCH_HIGHLIGHT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(EMPTY_FC);
}

/** Keeps highlight layers grouped; callers move them within the overlay stack. */
export function moveSearchHighlightLayers(map: MapEngine, beforeId?: string): void {
  for (const layerId of SEARCH_HIGHLIGHT_LAYER_IDS) {
    if (!map.getLayer(layerId)) continue;
    if (beforeId && map.getLayer(beforeId)) map.moveLayer(layerId, beforeId);
    else map.moveLayer(layerId);
  }
}

/**
 * Render + frame a selected search result:
 * - point / plus_code: build a Point feature and fly to it.
 * - line / polygon: fit the result bbox immediately, then fetch full geometry and
 *   swap the source data (a center pin is shown meanwhile as a fallback).
 */
export async function fitSearchResult(
  map: MapEngine,
  result: PublicSearchResult,
  options: FitSearchResultOptions = {},
): Promise<void> {
  if (!ensureSearchHighlightLayers(map)) return;

  const center = searchResultCenter(result);

  if (isPointLikeHighlight(result)) {
    if (!center) {
      clearSearchHighlight(map);
      return;
    }
    setSearchHighlight(map, highlightPointFeature(center, result));
    flyToSearchPoint(map, center, result, options);
    return;
  }

  if (result.bbox) {
    fitSearchBounds(map, result.bbox, options);
  } else if (center) {
    flyToSearchPoint(map, center, result, options);
  }

  if (options.geometry?.feature) {
    setSearchHighlight(map, withHighlightProps(options.geometry.feature, result));
    return;
  }

  if (center) {
    setSearchHighlight(map, highlightPointFeature(center, result));
  }
}

export function isPointLikeHighlight(result: PublicSearchResult): boolean {
  if (POINT_LIKE_ENTITY_TYPES.has(result.entityType)) return true;
  // No bbox to fit and no fetchable geometry => treat as a point.
  return !result.bbox && result.hasGeometry === false;
}

export function searchResultCenter(
  result: PublicSearchResult,
): readonly [number, number] | null {
  if (result.center && result.center.length >= 2) {
    return [result.center[0], result.center[1]];
  }
  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return [result.lng, result.lat];
  }
  if (result.cameraTarget?.type === 'point') {
    return result.cameraTarget.center;
  }
  if (result.bbox && result.bbox.length >= 4) {
    const [minLng, minLat, maxLng, maxLat] = result.bbox;
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }
  return null;
}

function flyToSearchPoint(
  map: MapEngine,
  center: readonly [number, number],
  result: PublicSearchResult,
  options: FitSearchResultOptions,
): void {
  map.flyTo({
    center: [center[0], center[1]],
    zoom: options.zoom ?? searchResultPointZoom(result),
    duration: options.duration ?? SEARCH_HIGHLIGHT_CAMERA_DURATION_MS,
    padding: options.padding,
    essential: true,
  });
}

function fitSearchBounds(
  map: MapEngine,
  bbox: readonly [number, number, number, number],
  options: FitSearchResultOptions,
): void {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    {
      padding: options.padding,
      maxZoom: 17,
      duration: options.duration ?? SEARCH_HIGHLIGHT_CAMERA_DURATION_MS,
      essential: true,
    },
  );
}

function searchResultPointZoom(result: PublicSearchResult): number {
  if (result.cameraTarget?.type === 'point' && typeof result.cameraTarget.zoom === 'number') {
    return result.cameraTarget.zoom;
  }
  switch (result.entityType) {
    case 'admin_area':
      return 14;
    case 'street':
    case 'street_group':
    case 'bus_route':
    case 'bus_route_variant':
    case 'transport_route':
    case 'transport_route_variant':
      return 15;
    case 'plus_code':
    case 'coordinate':
      return 18;
    default:
      return 16;
  }
}

function highlightPointFeature(
  center: readonly [number, number],
  result: PublicSearchResult,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [center[0], center[1]] },
    properties: highlightProps(result),
  };
}

function withHighlightProps(
  feature: GeoJSON.Feature,
  result: PublicSearchResult,
): GeoJSON.Feature {
  return {
    ...feature,
    properties: { ...(feature.properties ?? {}), ...highlightProps(result) },
  };
}

function highlightProps(result: PublicSearchResult): GeoJSON.GeoJsonProperties {
  return {
    kind: 'search-highlight',
    entityType: result.entityType,
    entityId: result.entityId ?? null,
  };
}
