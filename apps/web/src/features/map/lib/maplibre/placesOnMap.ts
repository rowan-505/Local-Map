/** Place marker layers (GeoJSON). Separate from the vector basemap. */
import type { LanguageMode } from '@local-map/localized-name';
import { getMapTextFieldExpression } from '@local-map/localized-name';
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import type { MapEngine } from '../mapEngineTypes';
import {
  PLACES_IMPORTANT_LABEL_LAYER_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LABEL_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LABEL_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
  PLACES_SOURCE_ID,
} from './publicMapMarkerLayerIds';
import { MARKER_ZOOM } from './publicMapMarkerPolicy';
import {
  densePoiLabelFilter,
  importantPoiLabelFilter,
  LABEL_SORT_KEY,
  LABEL_ZOOM,
  labelFadeInOpacity,
  linearZoomTextSize,
  poiDenseLabelSortKey,
  selectedMarkerCaptionTextField,
  TEXT_SIZE_POI_DENSE,
  TEXT_SIZE_POI_IMPORTANT,
  TEXT_SIZE_SELECTED_CAPTION,
} from './publicMapLabelPolicy';
import {
  denseMarkerStrokeWidth,
  POI_MARKER_COLORS,
  poiImportantPointRadius,
  poiNormalPointRadius,
  SELECTED_POI_PIN_IMAGE_PREFIX,
  SELECTED_MARKER_HALO,
  selectedMarkerHaloRadius,
  selectedPoiPinIconSize,
} from './publicMapMarkerStyles';

export {
  PLACES_SOURCE_ID,
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
  PLACES_IMPORTANT_LABEL_LAYER_ID,
  PLACES_LABEL_LAYER_ID,
  PLACES_SELECTED_LABEL_LAYER_ID,
} from './publicMapMarkerLayerIds';

const DEFAULT_LANGUAGE_MODE: LanguageMode = 'my';

function placesLabelTextField(mode: LanguageMode): ExpressionSpecification {
  return getMapTextFieldExpression(mode) as ExpressionSpecification;
}

const DEFAULT_COLOR = POI_MARKER_COLORS.default;
const SELECTED_COLOR = POI_MARKER_COLORS.selectedPin;
const DEFAULT_STROKE_COLOR = POI_MARKER_COLORS.stroke;
const SELECTED_PLACE_PIN_CATEGORIES = [
  'default',
  'food',
  'shopping',
  'health',
  'education',
  'religion',
  'transport',
  'government',
  'hotel',
] as const;

function normalPoiFilter(selectedPoiId: string | null): ExpressionSpecification {
  if (selectedPoiId === null) return ['has', 'id'] as ExpressionSpecification;
  return ['all', ['has', 'id'], ['!=', ['get', 'id'], selectedPoiId]] as ExpressionSpecification;
}

function importantPoiFilter(selectedPoiId: string | null): ExpressionSpecification {
  return [
    'all',
    normalPoiFilter(selectedPoiId),
    [
      'any',
      ['>=', ['to-number', ['get', 'importance_score'], 0], 50],
      ['==', ['to-number', ['get', 'is_verified'], 0], 1],
    ],
  ] as ExpressionSpecification;
}

function selectedPoiFilter(selectedPoiId: string | null): ExpressionSpecification {
  if (selectedPoiId === null) {
    return ['==', ['get', 'id'], '__none__'] as ExpressionSpecification;
  }
  return ['==', ['get', 'id'], selectedPoiId] as ExpressionSpecification;
}

function normalCircleRadiusExpression(): ExpressionSpecification {
  return poiNormalPointRadius();
}

function importantCircleRadiusExpression(): ExpressionSpecification {
  return poiImportantPointRadius();
}

function poiCategoryColorExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'poi_category_key'],
    'food',
    '#ef4444',
    'shopping',
    '#a855f7',
    'health',
    '#10b981',
    'education',
    '#3b82f6',
    'religion',
    '#f59e0b',
    'transport',
    '#06b6d4',
    'government',
    '#64748b',
    'hotel',
    '#ec4899',
    DEFAULT_COLOR,
  ] as ExpressionSpecification;
}

function selectedHaloRadiusExpression(): ExpressionSpecification {
  return selectedMarkerHaloRadius();
}

function selectedPinIconExpression(): ExpressionSpecification {
  return [
    'coalesce',
    ['get', 'selected_pin_icon'],
    `${SELECTED_POI_PIN_IMAGE_PREFIX}-default`,
  ] as ExpressionSpecification;
}

export function ensurePlacesLayer(
  map: MapEngine,
  geojson: GeoJSON.FeatureCollection,
  selectedPoiId: string | null,
  languageMode: LanguageMode = DEFAULT_LANGUAGE_MODE,
): void {
  ensureSelectedPlacePinImages(map);

  if (!map.getSource(PLACES_SOURCE_ID)) {
    map.addSource(PLACES_SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });
    map.addLayer({
      id: PLACES_IMPORTANT_LAYER_ID,
      type: 'circle',
      source: PLACES_SOURCE_ID,
      minzoom: MARKER_ZOOM.POI_IMPORTANT_MIN,
      maxzoom: MARKER_ZOOM.POI_IMPORTANT_MAX,
      filter: importantPoiFilter(selectedPoiId),
      paint: {
        'circle-radius': importantCircleRadiusExpression(),
        'circle-color': poiCategoryColorExpression(),
        'circle-opacity': 0.82,
        'circle-stroke-width': denseMarkerStrokeWidth(),
        'circle-stroke-color': DEFAULT_STROKE_COLOR,
      },
    });
    map.addLayer({
      id: PLACES_LAYER_ID,
      type: 'circle',
      source: PLACES_SOURCE_ID,
      minzoom: MARKER_ZOOM.POI_DENSE_MIN,
      filter: normalPoiFilter(selectedPoiId),
      paint: {
        'circle-radius': normalCircleRadiusExpression(),
        'circle-color': poiCategoryColorExpression(),
        'circle-opacity': 0.82,
        'circle-stroke-width': denseMarkerStrokeWidth(),
        'circle-stroke-color': DEFAULT_STROKE_COLOR,
      },
    });
    map.addLayer({
      id: PLACES_SELECTED_HALO_LAYER_ID,
      type: 'circle',
      source: PLACES_SOURCE_ID,
      filter: selectedPoiFilter(selectedPoiId),
      paint: {
        'circle-radius': selectedHaloRadiusExpression(),
        'circle-color': SELECTED_COLOR,
        'circle-opacity': SELECTED_MARKER_HALO.poi.opacity,
        'circle-blur': SELECTED_MARKER_HALO.poi.blur,
      },
    });
    map.addLayer({
      id: PLACES_SELECTED_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      filter: selectedPoiFilter(selectedPoiId),
      layout: {
        'icon-image': selectedPinIconExpression(),
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': selectedPoiPinIconSize(),
      },
    });
    map.addLayer({
      id: PLACES_IMPORTANT_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      minzoom: LABEL_ZOOM.POI_IMPORTANT_MIN,
      filter: importantPoiLabelFilter(selectedPoiId),
      layout: {
        'text-field': placesLabelTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_POI_IMPORTANT),
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': LABEL_SORT_KEY.poiImportant,
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': labelFadeInOpacity(LABEL_ZOOM.POI_IMPORTANT_MIN),
      },
    });
    map.addLayer({
      id: PLACES_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      minzoom: LABEL_ZOOM.POI_DENSE_MIN,
      filter: densePoiLabelFilter(selectedPoiId),
      layout: {
        'text-field': placesLabelTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_POI_DENSE),
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': poiDenseLabelSortKey(),
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': labelFadeInOpacity(LABEL_ZOOM.POI_DENSE_MIN),
      },
    });
    map.addLayer({
      id: PLACES_SELECTED_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      filter: selectedPoiFilter(selectedPoiId),
      layout: {
        'text-field': selectedMarkerCaptionTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_SELECTED_CAPTION),
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.75,
        'text-opacity': 1,
      },
    });
    return;
  }

  const src = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource;
  src.setData(geojson);
  ensureMissingPoiLabelLayers(map, selectedPoiId, languageMode);
  setSelectedPoiHighlight(map, selectedPoiId);
}

function ensureMissingPoiLabelLayers(
  map: MapEngine,
  selectedPoiId: string | null,
  languageMode: LanguageMode,
): void {
  if (!map.getSource(PLACES_SOURCE_ID)) return;

  if (!map.getLayer(PLACES_IMPORTANT_LABEL_LAYER_ID)) {
    map.addLayer({
      id: PLACES_IMPORTANT_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      minzoom: LABEL_ZOOM.POI_IMPORTANT_MIN,
      filter: importantPoiLabelFilter(selectedPoiId),
      layout: {
        'text-field': placesLabelTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_POI_IMPORTANT),
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': LABEL_SORT_KEY.poiImportant,
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': labelFadeInOpacity(LABEL_ZOOM.POI_IMPORTANT_MIN),
      },
    });
  }

  if (!map.getLayer(PLACES_LABEL_LAYER_ID)) {
    map.addLayer({
      id: PLACES_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      minzoom: LABEL_ZOOM.POI_DENSE_MIN,
      filter: densePoiLabelFilter(selectedPoiId),
      layout: {
        'text-field': placesLabelTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_POI_DENSE),
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': poiDenseLabelSortKey(),
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': labelFadeInOpacity(LABEL_ZOOM.POI_DENSE_MIN),
      },
    });
  }

  if (!map.getLayer(PLACES_SELECTED_LABEL_LAYER_ID)) {
    map.addLayer({
      id: PLACES_SELECTED_LABEL_LAYER_ID,
      type: 'symbol',
      source: PLACES_SOURCE_ID,
      filter: selectedPoiFilter(selectedPoiId),
      layout: {
        'text-field': selectedMarkerCaptionTextField(languageMode),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_SELECTED_CAPTION),
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.75,
        'text-opacity': 1,
      },
    });
  }
}

export function setPlacesGeoJSON(map: MapEngine, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(geojson);
}

export function setSelectedPoiHighlight(map: MapEngine, selectedPoiId: string | null): void {
  if (!map.getLayer(PLACES_LAYER_ID)) return;
  if (map.getLayer(PLACES_IMPORTANT_LAYER_ID)) {
    map.setFilter(PLACES_IMPORTANT_LAYER_ID, importantPoiFilter(selectedPoiId));
  }
  map.setFilter(PLACES_LAYER_ID, normalPoiFilter(selectedPoiId));
  if (map.getLayer(PLACES_IMPORTANT_LABEL_LAYER_ID)) {
    map.setFilter(PLACES_IMPORTANT_LABEL_LAYER_ID, importantPoiLabelFilter(selectedPoiId));
  }
  if (map.getLayer(PLACES_LABEL_LAYER_ID)) {
    map.setFilter(PLACES_LABEL_LAYER_ID, densePoiLabelFilter(selectedPoiId));
  }
  if (map.getLayer(PLACES_SELECTED_HALO_LAYER_ID)) {
    map.setFilter(PLACES_SELECTED_HALO_LAYER_ID, selectedPoiFilter(selectedPoiId));
  }
  if (map.getLayer(PLACES_SELECTED_LAYER_ID)) {
    map.setFilter(PLACES_SELECTED_LAYER_ID, selectedPoiFilter(selectedPoiId));
  }
  if (map.getLayer(PLACES_SELECTED_LABEL_LAYER_ID)) {
    map.setFilter(PLACES_SELECTED_LABEL_LAYER_ID, selectedPoiFilter(selectedPoiId));
  }
}

function ensureSelectedPlacePinImages(map: MapEngine): void {
  for (const category of SELECTED_PLACE_PIN_CATEGORIES) {
    const imageId = `${SELECTED_POI_PIN_IMAGE_PREFIX}-${category}`;
    if (map.hasImage(imageId)) continue;

    const image = createSelectedPlacePinImage(category);
    if (image) map.addImage(imageId, image, { pixelRatio: 2 });
  }
}

function createSelectedPlacePinImage(
  category: (typeof SELECTED_PLACE_PIN_CATEGORIES)[number],
): ImageData | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 88;
  canvas.height = 104;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(2, 2);
  ctx.shadowColor = 'rgba(15, 23, 42, 0.24)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;

  drawPinPath(ctx);
  ctx.fillStyle = SELECTED_COLOR;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  drawPinPath(ctx);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  drawPinPath(ctx);
  ctx.fillStyle = SELECTED_COLOR;
  ctx.fill();

  drawCategoryGlyph(ctx, category);

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawPinPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(22, 48);
  ctx.bezierCurveTo(20, 43, 7, 31, 7, 19);
  ctx.bezierCurveTo(7, 10, 13.2, 4.5, 22, 4.5);
  ctx.bezierCurveTo(30.8, 4.5, 37, 10, 37, 19);
  ctx.bezierCurveTo(37, 31, 24, 43, 22, 48);
  ctx.closePath();
}

function drawCategoryGlyph(
  ctx: CanvasRenderingContext2D,
  category: (typeof SELECTED_PLACE_PIN_CATEGORIES)[number],
): void {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (category) {
    case 'food':
      drawFoodGlyph(ctx);
      break;
    case 'shopping':
      drawShoppingGlyph(ctx);
      break;
    case 'health':
      drawHealthGlyph(ctx);
      break;
    case 'education':
      drawEducationGlyph(ctx);
      break;
    case 'religion':
      drawReligionGlyph(ctx);
      break;
    case 'transport':
      drawTransportGlyph(ctx);
      break;
    case 'government':
      drawGovernmentGlyph(ctx);
      break;
    case 'hotel':
      drawHotelGlyph(ctx);
      break;
    case 'default':
    default:
      drawDefaultPinGlyph(ctx);
      break;
  }

  ctx.restore();
}

function drawFoodGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(16, 12);
  ctx.lineTo(16, 25);
  ctx.moveTo(13.5, 12);
  ctx.lineTo(13.5, 17);
  ctx.moveTo(18.5, 12);
  ctx.lineTo(18.5, 17);
  ctx.moveTo(26, 12);
  ctx.lineTo(26, 25);
  ctx.stroke();
}

function drawShoppingGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.strokeRect(14, 16, 16, 10);
  ctx.beginPath();
  ctx.moveTo(17, 16);
  ctx.bezierCurveTo(17, 11.5, 27, 11.5, 27, 16);
  ctx.stroke();
}

function drawHealthGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(22, 12);
  ctx.lineTo(22, 26);
  ctx.moveTo(15, 19);
  ctx.lineTo(29, 19);
  ctx.stroke();
}

function drawEducationGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(13, 16);
  ctx.lineTo(22, 12);
  ctx.lineTo(31, 16);
  ctx.lineTo(22, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(16, 19);
  ctx.lineTo(16, 24);
  ctx.lineTo(28, 24);
  ctx.lineTo(28, 19);
  ctx.stroke();
}

function drawReligionGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(13, 25);
  ctx.lineTo(31, 25);
  ctx.moveTo(16, 21);
  ctx.lineTo(28, 21);
  ctx.moveTo(18, 21);
  ctx.lineTo(18, 16);
  ctx.lineTo(22, 12);
  ctx.lineTo(26, 16);
  ctx.lineTo(26, 21);
  ctx.stroke();
}

function drawTransportGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.strokeRect(14, 13, 16, 13);
  ctx.beginPath();
  ctx.moveTo(14, 18);
  ctx.lineTo(30, 18);
  ctx.moveTo(18, 26);
  ctx.lineTo(16, 29);
  ctx.moveTo(26, 26);
  ctx.lineTo(28, 29);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, 23, 1, 0, Math.PI * 2);
  ctx.arc(26, 23, 1, 0, Math.PI * 2);
  ctx.fill();
}

function drawGovernmentGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(13, 25);
  ctx.lineTo(31, 25);
  ctx.moveTo(15, 16);
  ctx.lineTo(29, 16);
  ctx.moveTo(22, 11);
  ctx.lineTo(31, 16);
  ctx.lineTo(13, 16);
  ctx.closePath();
  ctx.moveTo(17, 16);
  ctx.lineTo(17, 25);
  ctx.moveTo(22, 16);
  ctx.lineTo(22, 25);
  ctx.moveTo(27, 16);
  ctx.lineTo(27, 25);
  ctx.stroke();
}

function drawHotelGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(14, 26);
  ctx.moveTo(14, 21);
  ctx.lineTo(31, 21);
  ctx.lineTo(31, 26);
  ctx.moveTo(17, 18);
  ctx.lineTo(22, 18);
  ctx.stroke();
}

function drawDefaultPinGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(22, 18, 5.5, 0, Math.PI * 2);
  ctx.stroke();
}
