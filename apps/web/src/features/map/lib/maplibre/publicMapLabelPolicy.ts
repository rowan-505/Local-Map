/**
 * Zoom gates and layout helpers for public-map POI + transport text labels.
 * Circle/icon layers are separate — `text-optional: true` drops crowded labels, not points.
 */
import type { LanguageMode } from '@local-map/localized-name';
import { getMapTextFieldExpression } from '@local-map/localized-name';
import type { ExpressionSpecification } from 'maplibre-gl';

export const LABEL_ZOOM = {
  /** Major terminal / interchange names. */
  TRANSPORT_TERMINAL_MIN: 12,
  /** Station-class stop names in `transport-stops`. */
  TRANSPORT_MAJOR_STOP_MIN: 14,
  /** Ordinary bus stop names — high zoom only. */
  TRANSPORT_DENSE_STOP_MIN: 18,
  /** Minor ferry landing names. */
  TRANSPORT_FERRY_MIN: 18,
  /** Route names along paths. */
  TRANSPORT_ROUTE_MIN: 14,

  /** Verified / high-importance POI names. */
  POI_IMPORTANT_MIN: 14,
  /** Dense POI field — later than important tier. */
  POI_DENSE_MIN: 17,
} as const;

type TextSizeStop = readonly [zoom: number, size: number];

/** Terminal / major station labels. */
export const TEXT_SIZE_TRANSPORT_TERMINAL: readonly TextSizeStop[] = [
  [12, 10.5],
  [14, 11.5],
  [16, 12.5],
  [18, 13],
];

/** Station-class stop labels. */
export const TEXT_SIZE_TRANSPORT_MAJOR_STOP: readonly TextSizeStop[] = [
  [14, 10.5],
  [16, 11.5],
  [18, 12.5],
];

/** Ordinary bus stop labels. */
export const TEXT_SIZE_TRANSPORT_DENSE_STOP: readonly TextSizeStop[] = [
  [18, 10],
  [20, 11],
];

/** Route line labels. */
export const TEXT_SIZE_TRANSPORT_ROUTE: readonly TextSizeStop[] = [
  [14, 10],
  [16, 10.5],
  [18, 11.5],
];

/** Important POI labels. */
export const TEXT_SIZE_POI_IMPORTANT: readonly TextSizeStop[] = [
  [14, 10.5],
  [16, 11.5],
  [18, 12.5],
];

/** Dense POI labels. */
export const TEXT_SIZE_POI_DENSE: readonly TextSizeStop[] = [
  [17, 10],
  [18, 11],
  [20, 12],
];

/** Selected POI / transport pin caption. */
export const TEXT_SIZE_SELECTED_CAPTION: readonly TextSizeStop[] = [
  [10, 11],
  [14, 12],
  [18, 13],
];

export const LABEL_SORT_KEY = {
  transportTerminal: 1,
  transportMajorStop: 2,
  transportRoute: 5,
  poiImportant: 3,
  transportDenseStop: 10,
  transportFerry: 11,
  poiDenseBase: 20,
} as const;

export function linearZoomTextSize(stops: readonly TextSizeStop[]): ExpressionSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, size] of stops) {
    expr.push(zoom, size);
  }
  return expr as ExpressionSpecification;
}

/** Fade labels in over ~1.5 zoom levels after minzoom. */
export function labelFadeInOpacity(minZoom: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], minZoom, 0, minZoom + 1.5, 1];
}

/** Selected POI/transport pin caption — localized names with tile/API fallback. */
export function selectedMarkerCaptionTextField(
  mode: LanguageMode = 'my',
): ExpressionSpecification {
  return [
    'coalesce',
    getMapTextFieldExpression(mode) as ExpressionSpecification,
    ['get', 'label'],
    ['get', 'name'],
    '',
  ] as ExpressionSpecification;
}

/** POI dense labels — lower sort-key wins; verified/importance boost priority. */
export function poiDenseLabelSortKey(): ExpressionSpecification {
  return [
    '+',
    LABEL_SORT_KEY.poiDenseBase,
    [
      '-',
      100,
      [
        '+',
        ['*', ['to-number', ['get', 'importance_score'], 0], 0.5],
        ['*', ['to-number', ['get', 'is_verified'], 0], 25],
        poiCategoryLabelPriority(),
      ],
    ],
  ] as ExpressionSpecification;
}

/** Category weight for label collision priority (higher weight → lower sort-key). */
function poiCategoryLabelPriority(): ExpressionSpecification {
  return [
    'match',
    ['get', 'poi_category_key'],
    'government',
    18,
    'health',
    16,
    'education',
    14,
    'transport',
    12,
    'religion',
    10,
    'food',
    8,
    'shopping',
    6,
    'hotel',
    4,
    0,
  ] as ExpressionSpecification;
}

/** Important POI tier — same gate as `places-important-circle`. */
export function importantPoiLabelFilter(selectedPoiId: string | null): ExpressionSpecification {
  const excludeSelected =
    selectedPoiId === null
      ? (['has', 'id'] as ExpressionSpecification)
      : (['!=', ['get', 'id'], selectedPoiId] as ExpressionSpecification);
  return [
    'all',
    excludeSelected,
    [
      'any',
      ['>=', ['to-number', ['get', 'importance_score'], 0], 50],
      ['==', ['to-number', ['get', 'is_verified'], 0], 1],
    ],
  ] as ExpressionSpecification;
}

/** Dense POI labels — excludes important tier (already labeled earlier). */
export function densePoiLabelFilter(selectedPoiId: string | null): ExpressionSpecification {
  const excludeSelected =
    selectedPoiId === null
      ? (['has', 'id'] as ExpressionSpecification)
      : (['!=', ['get', 'id'], selectedPoiId] as ExpressionSpecification);
  return [
    'all',
    excludeSelected,
    ['<', ['to-number', ['get', 'importance_score'], 0], 50],
    ['!=', ['to-number', ['get', 'is_verified'], 0], 1],
  ] as ExpressionSpecification;
}
