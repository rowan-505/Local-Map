/** Overview tile label fields. Regional `name_mm` / `name_en` are not on these layers. */
import type { ExpressionSpecification } from 'maplibre-gl';

export const OVERVIEW_LABEL_LAYER_IDS = [
  'overview-country-labels',
  'overview-mmr-admin1-labels',
  'overview-populated-places',
] as const;

export type OverviewLabelLayerId = (typeof OVERVIEW_LABEL_LAYER_IDS)[number];

/** Country polygons — uppercase attribute names from the overview export. */
export const OVERVIEW_COUNTRY_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'NAME'],
  ['get', 'ADMIN'],
  ['get', 'NAME_EN'],
  ['get', 'NAME_LONG'],
];

/** Populated places — mixed-case keys from tippecanoe. */
export const OVERVIEW_POPULATED_PLACES_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'NAME'],
  ['get', 'NAMEASCII'],
  ['get', 'name'],
  ['get', 'nameascii'],
];

/** State/region polygons — ST / SR name fields, plus lowercase fallbacks. */
export const OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'ST'],
  ['get', 'ST_MMR'],
  ['get', 'SR'],
  ['get', 'SR_MMR'],
  ['get', 'NAME'],
  ['get', 'name'],
  ['get', 'name_en'],
  ['get', 'name_mm'],
];

const OVERVIEW_LABEL_TEXT_FIELD_BY_LAYER_ID: Readonly<
  Record<OverviewLabelLayerId, ExpressionSpecification>
> = {
  'overview-country-labels': OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  'overview-mmr-admin1-labels': OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD,
  'overview-populated-places': OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
};

export function isOverviewLabelLayerId(layerId: string): layerId is OverviewLabelLayerId {
  return (OVERVIEW_LABEL_LAYER_IDS as readonly string[]).includes(layerId);
}

/** Returns overview-specific `text-field` or `null` for non-overview symbol layers. */
export function getOverviewLabelTextField(layerId: string): ExpressionSpecification | null {
  if (!isOverviewLabelLayerId(layerId)) return null;
  return OVERVIEW_LABEL_TEXT_FIELD_BY_LAYER_ID[layerId];
}
