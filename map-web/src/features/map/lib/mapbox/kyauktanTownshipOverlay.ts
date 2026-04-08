/**
 * Kyauktan township: GeoJSON source + fill + outline. Tune colors in this file.
 */
import type { ExpressionSpecification } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import { KYAUKTAN_TOWNSHIP_GEOJSON } from '@/data/geo/kyauktanTownshipData';
import {
  KYAUKTAN_TOWNSHIP_FILL_LAYER_ID,
  KYAUKTAN_TOWNSHIP_LINE_LAYER_ID,
  KYAUKTAN_TOWNSHIP_SOURCE_ID,
} from './mapLayerIds';

const FILL_COLOR = '#DCEFFF';
const FILL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0.55,
  14,
  0.6,
  17,
  0.65,
];
const LINE_COLOR = '#4A90A4';
const LINE_WIDTH = 2;

export function ensureKyauktanTownshipOverlay(map: MapEngine): void {
  if (map.getSource(KYAUKTAN_TOWNSHIP_SOURCE_ID)) return;

  map.addSource(KYAUKTAN_TOWNSHIP_SOURCE_ID, {
    type: 'geojson',
    data: KYAUKTAN_TOWNSHIP_GEOJSON,
  });

  map.addLayer({
    id: KYAUKTAN_TOWNSHIP_FILL_LAYER_ID,
    type: 'fill',
    source: KYAUKTAN_TOWNSHIP_SOURCE_ID,
    paint: {
      'fill-color': FILL_COLOR,
      'fill-opacity': FILL_OPACITY,
      'fill-antialias': true,
    },
  });

  map.addLayer({
    id: KYAUKTAN_TOWNSHIP_LINE_LAYER_ID,
    type: 'line',
    source: KYAUKTAN_TOWNSHIP_SOURCE_ID,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': LINE_COLOR,
      'line-width': LINE_WIDTH,
      'line-opacity': 0.9,
    },
  });
}
