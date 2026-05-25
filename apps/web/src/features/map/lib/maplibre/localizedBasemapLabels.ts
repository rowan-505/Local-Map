/**
 * Applies bilingual `text-field` to every symbol layer in the loaded style that defines one.
 */
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { LanguageMode } from '@local-map/localized-name';
import { getMapTextFieldExpression } from '@local-map/localized-name';
import type { MapEngine } from '../mapEngineTypes';

const ADMIN_LABEL_LAYER_IDS = new Set([
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
 * Walks `map.getStyle().layers` and updates `text-field` for each symbol layer that has one.
 * Vector tiles should expose `name_mm`, `name_en`, and `name` (see `003_tile_symbol_label_views.sql`).
 */
export function applyAllSymbolLayerTextFieldsForLanguage(map: MapEngine, mode: LanguageMode): void {
  const style = map.getStyle();
  const layers = style?.layers;
  if (layers === undefined || layers.length === 0) return;

  const expr = getMapTextFieldExpression(mode) as ExpressionSpecification;

  for (const layer of layers as LayerSpecification[]) {
    if (layer.type !== 'symbol') continue;
    if (!specHasTextField(layer.layout)) continue;

    const layerId = layer.id;
    if (!map.getLayer(layerId)) continue;

    try {
      map.setLayoutProperty(
        layerId,
        'text-field',
        ADMIN_LABEL_LAYER_IDS.has(layerId)
          ? adminAreaLabelPointTextFieldExpression(mode)
          : expr,
      );
      console.log('Updated label language layer:', layerId);
    } catch {
      /* e.g. layer does not support this layout property */
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
