/** Set bilingual `text-field` on symbol layers. Overview tiles use their own name keys. */
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { LanguageMode } from '@local-map/localized-name';
import { getMapTextFieldExpression } from '@local-map/localized-name';
import type { MapEngine } from '../mapEngineTypes';
import { getOverviewLabelTextField } from './overviewLabelTextFields';
import { getRoadLabelTextField } from './roadLabelTextFields';
import {
  PLACES_SELECTED_LABEL_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
} from './publicMapMarkerLayerIds';
import { selectedMarkerCaptionTextField } from './publicMapLabelPolicy';

const ADMIN_LABEL_LAYER_IDS = new Set([
  'admin-labels-township',
  'admin-labels-ward-village-tract',
  'admin-labels-village-local',
  // legacy ids (older PMTiles / styles)
  'admin-labels',
  'village-labels',
  'admin-neighborhood-labels',
  'admin-area-label-points',
]);

function specHasTextField(layout: LayerSpecification['layout']): layout is NonNullable<LayerSpecification['layout']> & {
  'text-field': unknown;
} {
  return (
    layout !== undefined &&
    typeof layout === 'object' &&
    layout !== null &&
    'text-field' in layout &&
    (layout as { 'text-field'?: unknown })['text-field'] !== undefined
  );
}

/**
 * Resolves `text-field` for a symbol layer — overview layers keep Natural Earth/MIMU fields.
 * Exported for unit tests without a MapLibre runtime.
 */
export function resolveSymbolLayerTextField(
  layerId: string,
  mode: LanguageMode,
): ExpressionSpecification {
  const overviewExpr = getOverviewLabelTextField(layerId);
  if (overviewExpr) {
    return overviewExpr;
  }
  if (ADMIN_LABEL_LAYER_IDS.has(layerId)) {
    return adminAreaLabelPointTextFieldExpression(mode);
  }
  const roadExpr = getRoadLabelTextField(layerId, mode);
  if (roadExpr) {
    return roadExpr;
  }
  if (layerId === PLACES_SELECTED_LABEL_LAYER_ID || layerId === TRANSPORT_SELECTED_LABEL_LAYER_ID) {
    return selectedMarkerCaptionTextField(mode);
  }
  return getMapTextFieldExpression(mode) as ExpressionSpecification;
}

/**
 * Walks `map.getStyle().layers` and updates `text-field` for each symbol layer that has one.
 * Vector tiles should expose `name_mm`, `name_en`, and `name` (see `003_tile_symbol_label_views.sql`).
 */
export function applyAllSymbolLayerTextFieldsForLanguage(map: MapEngine, mode: LanguageMode): void {
  const style = map.getStyle();
  const layers = style?.layers;
  if (layers === undefined || layers.length === 0) return;

  for (const layer of layers as LayerSpecification[]) {
    if (layer.type !== 'symbol') continue;
    if (!specHasTextField(layer.layout)) continue;

    const layerId = layer.id;
    if (!map.getLayer(layerId)) continue;

    try {
      map.setLayoutProperty(layerId, 'text-field', resolveSymbolLayerTextField(layerId, mode));
    } catch {
      /* layer does not support this layout property */
    }
  }
}

function adminAreaLabelPointTextFieldExpression(mode: LanguageMode): ExpressionSpecification {
  if (mode === 'my') {
    return [
      'coalesce',
      ['get', 'name_mm'],
      ['get', 'name'],
      ['get', 'name_en'],
      ['get', 'canonical_name'],
    ] as ExpressionSpecification;
  }

  if (mode === 'en') {
    return [
      'coalesce',
      ['get', 'name_en'],
      ['get', 'name'],
      ['get', 'name_mm'],
      ['get', 'canonical_name'],
    ] as ExpressionSpecification;
  }

  return [
    'let',
    'primary',
    ['coalesce', ['get', 'name_en'], ['get', 'name'], ['get', 'canonical_name'], ''],
    'mm',
    ['coalesce', ['get', 'name_mm'], ''],
    [
      'case',
      ['all', ['!=', ['var', 'primary'], ''], ['!=', ['var', 'mm'], ''], ['!=', ['var', 'primary'], ['var', 'mm']]],
      ['concat', ['var', 'primary'], '\n', ['var', 'mm']],
      ['!=', ['var', 'mm'], ''],
      ['var', 'mm'],
      ['var', 'primary'],
    ],
  ] as ExpressionSpecification;
}

export function applyAllLocalizedMapLabels(map: MapEngine, mode: LanguageMode): void {
  applyAllSymbolLayerTextFieldsForLanguage(map, mode);
}
