/**
 * Yangon-only road labels from `exports/yangon/road_labels.geojson` (no PMTiles rebuild).
 * Other regional archives are unchanged.
 */
import type { ExpressionSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import {
  getYangonRoadLabelsGeoJsonUrl,
  shouldUseYangonRoadLabelsOverlay,
} from '../../config/yangonRoadLabelsOverlayConfig';
import { MAP_SYMBOL_TEXT_FONT } from '../../config/basemapStyle';
import type { MapEngine } from '../mapEngineTypes';
import { isRoadLabelLayerId, YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS } from './roadLabelTextFields';
import { PLACES_LAYER_ID } from './placesOnMap';

export const YANGON_ROAD_LABELS_OVERLAY_SOURCE_ID = 'yangon-road-labels-overlay';

const ROAD_LABEL_NAME_FILTER: ExpressionSpecification = [
  'all',
  ['!=', ['coalesce', ['get', 'name'], ''], ''],
  ['!=', ['index-of', 'road-', ['downcase', ['coalesce', ['get', 'name'], '']]], 0],
];

function roadLabelLayerTypeFilter(): ExpressionSpecification {
  return [
    'any',
    ['==', ['coalesce', ['get', 'layer_type'], 'road_label'], 'road_label'],
    ['!', ['has', 'layer_type']],
  ] as ExpressionSpecification;
}

function roadClassFilter(classes: string[]): ExpressionSpecification {
  return [
    'in',
    ['downcase', ['coalesce', ['get', 'road_class_code'], 'unknown']],
    ['literal', classes],
  ] as ExpressionSpecification;
}

function lineRoadLabelLayer(
  id: string,
  source: string,
  minzoom: number,
  roadClasses: string[],
  symbolSpacing: number,
  textSize: ExpressionSpecification,
  textOpacity: ExpressionSpecification,
): SymbolLayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    minzoom,
    maxzoom: 20,
    filter: ['all', roadLabelLayerTypeFilter(), roadClassFilter(roadClasses), ROAD_LABEL_NAME_FILTER],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': symbolSpacing,
      'text-field': ['coalesce', ['get', 'name_mm'], ['get', 'name'], ['get', 'name_en']],
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': textSize,
      'text-padding': 6,
      'text-max-angle': 28,
      'text-rotation-alignment': 'map',
      'text-keep-upright': true,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#5a6268',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.2,
      'text-halo-blur': 0.3,
      'text-opacity': textOpacity,
    },
  };
}

function yangonOverlayLayerSpecs(sourceId: string): SymbolLayerSpecification[] {
  return [
    lineRoadLabelLayer(
      YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS[0],
      sourceId,
      11,
      ['motorway', 'trunk', 'primary'],
      520,
      ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 11, 17, 12],
      ['interpolate', ['linear'], ['zoom'], 11, 0.82, 14, 0.92, 17, 0.94],
    ),
    lineRoadLabelLayer(
      YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS[1],
      sourceId,
      12,
      ['secondary', 'tertiary'],
      560,
      ['interpolate', ['linear'], ['zoom'], 12, 9.5, 15, 10.5, 17, 11],
      ['interpolate', ['linear'], ['zoom'], 12, 0.76, 15, 0.88, 17, 0.9],
    ),
    lineRoadLabelLayer(
      YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS[2],
      sourceId,
      14,
      ['residential', 'unclassified', 'living_street', 'unknown'],
      600,
      ['interpolate', ['linear'], ['zoom'], 14, 9, 16, 10, 18, 11],
      ['interpolate', ['linear'], ['zoom'], 14, 0.72, 16, 0.86, 18, 0.9],
    ),
  ];
}

function hideBuiltinRoadLabelLayers(map: MapEngine): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!isRoadLabelLayerId(layer.id)) continue;
    if (YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS.includes(layer.id as (typeof YANGON_ROAD_LABEL_OVERLAY_LAYER_IDS)[number])) {
      continue;
    }
    if (!map.getLayer(layer.id)) continue;
    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    } catch {
      /* layer may not support visibility */
    }
  }
}

function addOverlayLayer(map: MapEngine, spec: SymbolLayerSpecification): void {
  const beforeId = map.getLayer(PLACES_LAYER_ID) ? PLACES_LAYER_ID : undefined;
  if (beforeId) {
    map.addLayer(spec as never, beforeId);
  } else {
    map.addLayer(spec as never);
  }
}

let overlayLoadPromise: Promise<void> | null = null;

/**
 * Fetch Yangon `road_labels.geojson` and add symbol layers. No-op for non-Yangon basemaps.
 */
export function ensureYangonRoadLabelsOverlay(map: MapEngine): Promise<void> {
  if (!shouldUseYangonRoadLabelsOverlay()) {
    return Promise.resolve();
  }

  if (map.getSource(YANGON_ROAD_LABELS_OVERLAY_SOURCE_ID)) {
    return Promise.resolve();
  }

  if (overlayLoadPromise) {
    return overlayLoadPromise;
  }

  const url = getYangonRoadLabelsGeoJsonUrl();
  if (!url) {
    return Promise.resolve();
  }

  overlayLoadPromise = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(
          `[map] Yangon road labels overlay: fetch failed (${response.status}) ${url}`,
        );
        return;
      }

      const data = (await response.json()) as GeoJSON.FeatureCollection;
      const featureCount = data.features?.length ?? 0;
      if (featureCount === 0) {
        console.warn(`[map] Yangon road labels overlay: no features in ${url}`);
        return;
      }

      map.addSource(YANGON_ROAD_LABELS_OVERLAY_SOURCE_ID, {
        type: 'geojson',
        data,
      });

      for (const spec of yangonOverlayLayerSpecs(YANGON_ROAD_LABELS_OVERLAY_SOURCE_ID)) {
        addOverlayLayer(map, spec);
      }

      hideBuiltinRoadLabelLayers(map);

      if (import.meta.env.DEV) {
        console.info(
          `[map] Yangon road labels overlay: ${featureCount} features from ${url}`,
        );
      }
    } catch (error) {
      console.warn('[map] Yangon road labels overlay failed:', error);
    } finally {
      overlayLoadPromise = null;
    }
  })();

  return overlayLoadPromise;
}
