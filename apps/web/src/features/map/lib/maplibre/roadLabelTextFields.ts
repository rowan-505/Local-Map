/**
 * MapLibre `text-field` expressions for PMTiles `road_labels` source-layer only.
 * Never reads `canonical_name` or streets geometry properties.
 */
import type { ExpressionSpecification } from 'maplibre-gl';

type RoadLabelLanguageMode = 'my' | 'en' | 'both';

export const ROAD_LABEL_LAYER_IDS = [
  'road-labels-major',
  'road-labels-medium',
  'road-labels-local',
  // legacy ids (older base-map.json)
  'road-labels-primary-trunk',
  'road-labels-secondary-tertiary',
  'road-labels',
] as const;

const ROAD_LABEL_LAYER_ID_SET = new Set<string>(ROAD_LABEL_LAYER_IDS);

export function isRoadLabelLayerId(layerId: string): boolean {
  return ROAD_LABEL_LAYER_ID_SET.has(layerId);
}

/** PMTiles `road_labels` — my: name_mm → name → name_en; en: name_en → name → name_mm. */
export function roadLabelTextFieldExpression(mode: RoadLabelLanguageMode): ExpressionSpecification {
  if (mode === 'my') {
    return ['coalesce', ['get', 'name_mm'], ['get', 'name'], ['get', 'name_en']] as ExpressionSpecification;
  }
  if (mode === 'en') {
    return ['coalesce', ['get', 'name_en'], ['get', 'name'], ['get', 'name_mm']] as ExpressionSpecification;
  }
  return [
    'case',
    ['all', ['has', 'name_mm'], ['has', 'name_en']],
    ['concat', ['get', 'name_mm'], '\n', ['get', 'name_en']],
    ['coalesce', ['get', 'name_mm'], ['get', 'name'], ['get', 'name_en']],
  ] as ExpressionSpecification;
}

export function getRoadLabelTextField(
  layerId: string,
  mode: RoadLabelLanguageMode,
): ExpressionSpecification | null {
  if (!isRoadLabelLayerId(layerId)) return null;
  return roadLabelTextFieldExpression(mode);
}
