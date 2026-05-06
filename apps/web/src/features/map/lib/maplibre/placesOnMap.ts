/**
 * App POI layers (GeoJSON + circle) — product data only, separate from:
 * - shared vector basemap (`packages/map-style/base-map.json`)
 * - Kyauktan township overlay (`kyauktanTownshipOverlay`)
 */
import type { LanguageMode } from '@local-map/localized-name';
import { getMapTextFieldExpression } from '@local-map/localized-name';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import type { MapEngine } from '../mapEngineTypes';

export const PLACES_SOURCE_ID = 'places' as const;
export const PLACES_LAYER_ID = 'places-circle' as const;
export const PLACES_LABEL_LAYER_ID = 'places-label' as const;

const DEFAULT_LANGUAGE_MODE: LanguageMode = 'my';

function placesLabelTextField(mode: LanguageMode): ExpressionSpecification {
  return getMapTextFieldExpression(mode) as ExpressionSpecification;
}

const DEFAULT_COLOR = '#0ea5e9';
const SELECTED_COLOR = '#f97316';
const DEFAULT_STROKE_COLOR = '#ffffff';
const SELECTED_STROKE_COLOR = '#7c2d12';

function circleColorExpression(selectedPoiId: string | null): string | ExpressionSpecification {
  if (selectedPoiId === null) {
    return DEFAULT_COLOR;
  }
  return [
    'case',
    ['==', ['get', 'id'], selectedPoiId],
    SELECTED_COLOR,
    DEFAULT_COLOR,
  ];
}

function circleRadiusExpression(selectedPoiId: string | null): number | ExpressionSpecification {
  if (selectedPoiId === null) {
    return ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7];
  }
  return [
    'case',
    ['==', ['get', 'id'], selectedPoiId],
    ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 8, 18, 11],
    ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7],
  ];
}

function strokeColorExpression(selectedPoiId: string | null): string | ExpressionSpecification {
  if (selectedPoiId === null) {
    return DEFAULT_STROKE_COLOR;
  }
  return [
    'case',
    ['==', ['get', 'id'], selectedPoiId],
    SELECTED_STROKE_COLOR,
    DEFAULT_STROKE_COLOR,
  ];
}

function strokeWidthExpression(selectedPoiId: string | null): number | ExpressionSpecification {
  if (selectedPoiId === null) {
    return 1.5;
  }
  return ['case', ['==', ['get', 'id'], selectedPoiId], 2.5, 1.5];
}

export function ensurePlacesLayer(
  map: MapEngine,
  geojson: GeoJSON.FeatureCollection,
  selectedPoiId: string | null,
  languageMode: LanguageMode = DEFAULT_LANGUAGE_MODE,
): void {
  if (!map.getSource(PLACES_SOURCE_ID)) {
    map.addSource(PLACES_SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });
    map.addLayer({
      id: PLACES_LAYER_ID,
      type: 'circle',
      source: PLACES_SOURCE_ID,
      paint: {
        'circle-radius': circleRadiusExpression(selectedPoiId),
        'circle-color': circleColorExpression(selectedPoiId),
        'circle-opacity': 0.92,
        'circle-stroke-width': strokeWidthExpression(selectedPoiId),
        'circle-stroke-color': strokeColorExpression(selectedPoiId),
      },
    });
    map.addLayer({
      id: PLACES_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      layout: {
        'text-field': placesLabelTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': 12,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });
    return;
  }

  const src = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource;
  src.setData(geojson);
  setSelectedPoiHighlight(map, selectedPoiId);
}

export function setPlacesGeoJSON(map: MapEngine, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(geojson);
}

export function setSelectedPoiHighlight(map: MapEngine, selectedPoiId: string | null): void {
  if (!map.getLayer(PLACES_LAYER_ID)) return;
  map.setPaintProperty(PLACES_LAYER_ID, 'circle-color', circleColorExpression(selectedPoiId));
  map.setPaintProperty(PLACES_LAYER_ID, 'circle-radius', circleRadiusExpression(selectedPoiId));
  map.setPaintProperty(
    PLACES_LAYER_ID,
    'circle-stroke-color',
    strokeColorExpression(selectedPoiId),
  );
  map.setPaintProperty(
    PLACES_LAYER_ID,
    'circle-stroke-width',
    strokeWidthExpression(selectedPoiId),
  );
}
