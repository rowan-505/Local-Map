/**
 * App POI layers (GeoJSON + circle) — product data only, separate from:
 * - shared vector basemap (`packages/map-style/base-map.json`)
 * - Kyauktan township overlay (`kyauktanTownshipOverlay`)
 */
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';

export const PLACES_SOURCE_ID = 'places' as const;
export const PLACES_LAYER_ID = 'places-circle' as const;

const DEFAULT_COLOR = '#2563eb';
const SELECTED_COLOR = '#ca8a04';

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

export function ensurePlacesLayer(
  map: MapEngine,
  geojson: GeoJSON.FeatureCollection,
  selectedPoiId: string | null,
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
        'circle-radius': 7,
        'circle-color': circleColorExpression(selectedPoiId),
        'circle-opacity': 0.95,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
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
}
