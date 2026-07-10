/**
 * Canonical zoom gates and circle-radius stops for public-map POI + transport markers.
 * Colors and selected-pin images stay in `publicMapMarkerStyles.ts`.
 */
import type { ExpressionSpecification } from 'maplibre-gl';

export const MARKER_ZOOM = {
  POI_DENSE_MIN: 13,
  POI_IMPORTANT_MIN: 10,
  POI_IMPORTANT_MAX: 13,
  POI_LABEL_MIN: 17,
  POI_LABEL_IMPORTANT_MIN: 14,

  TRANSPORT_BUS_STOP_MIN: 13,
  TRANSPORT_STATION_MIN: 12,
  TRANSPORT_TERMINAL_MIN: 12,
  TRANSPORT_FERRY_MIN: 13,

  /** @deprecated Use {@link LABEL_ZOOM} in `publicMapLabelPolicy.ts`. */
  LABEL_IMPORTANT_MIN: 14,
  /** @deprecated Use {@link LABEL_ZOOM} in `publicMapLabelPolicy.ts`. */
  LABEL_DENSE_MIN: 18,
} as const;

type ZoomStop = readonly [zoom: number, radius: number];

/** Normal bus stop / dense POI — small readable dots (not pins). */
export const RADIUS_BUS_STOP_STOPS: readonly ZoomStop[] = [
  [13, 2.5],
  [14, 3],
  [16, 4.5],
  [18, 6],
  [20, 7],
];

/** Station-class stop in `transport-stops` or major terminal circles. */
export const RADIUS_STATION_TERMINAL_STOPS: readonly ZoomStop[] = [
  [12, 6],
  [14, 8],
  [16, 10],
  [18, 12],
  [20, 14],
];

/** Verified / high-importance POI tier (z10–12.99). */
export const RADIUS_POI_IMPORTANT_STOPS: readonly ZoomStop[] = [
  [10, 4],
  [12, 5.5],
  [13, 6],
];

/** Minor ferry landing — subordinate to bus stops. */
export const RADIUS_FERRY_LANDING_STOPS: readonly ZoomStop[] = [
  [13, 2],
  [14, 2.5],
  [16, 3.5],
  [18, 4.5],
  [20, 5],
];

/** Solid selected-transport anchor circle (under the pin). */
export const RADIUS_SELECTED_TRANSPORT_ANCHOR_STOPS: readonly ZoomStop[] = [
  [13, 4],
  [14, 5],
  [16, 7],
  [18, 9],
  [20, 10],
];

/** Selected marker halo (POI + transport). */
export const RADIUS_SELECTED_HALO_STOPS: readonly ZoomStop[] = [
  [10, 10],
  [14, 14],
  [18, 16],
  [20, 18],
];

/** Selected pin icon-size scale. */
export const SIZE_SELECTED_PIN_STOPS: readonly ZoomStop[] = [
  [10, 0.7],
  [14, 0.88],
  [18, 1],
  [20, 1.05],
];

/** Transport pointer-hover halo. */
export const RADIUS_TRANSPORT_HOVER_HALO_STOPS: readonly ZoomStop[] = [
  [13, 5],
  [16, 7],
  [18, 10],
  [20, 11],
];

/** Stable invisible click target — visual dots stay small; radius does not grow past z16. */
export const TRANSPORT_POINT_HITBOX_RADIUS_EXPRESSION: ExpressionSpecification = [
  'step',
  ['zoom'],
  8,
  14,
  10,
  16,
  12,
];

/** Documented hitbox bands for tests and docs (visual markers use separate radii). */
export const TRANSPORT_POINT_HITBOX_ZOOM_BANDS = [
  { from: 12, to: 13, radius: 8 },
  { from: 14, to: 15, radius: 10 },
  { from: 16, to: 20, radius: 12 },
] as const;

/** Resolve the stable hitbox radius for a map zoom level (mirrors the step expression). */
export function transportPointHitboxRadiusAtZoom(zoom: number): number {
  if (zoom >= 16) return 12;
  if (zoom >= 14) return 10;
  return 8;
}

/** White stroke on dense circle markers. */
export const STROKE_DENSE_STOPS: readonly ZoomStop[] = [
  [13, 1.1],
  [16, 1.25],
  [18, 1.4],
  [20, 1.5],
];

/** White stroke on station/terminal circles. */
export const STROKE_STATION_STOPS: readonly ZoomStop[] = [
  [12, 1.5],
  [16, 2],
  [18, 2.5],
  [20, 3],
];

export function linearZoomRadius(stops: readonly ZoomStop[]): ExpressionSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, radius] of stops) {
    expr.push(zoom, radius);
  }
  return expr as ExpressionSpecification;
}

/** Bus stop radius; major `stop_type` uses station/terminal scale in the same layer. */
export function busStopRadiusWithMajorCase(
  majorStopFilter: ExpressionSpecification,
): ExpressionSpecification {
  const bus = RADIUS_BUS_STOP_STOPS;
  const station = RADIUS_STATION_TERMINAL_STOPS;
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  const zoomLevels = new Set([...bus, ...station].map(([z]) => z));
  for (const zoom of [...zoomLevels].sort((a, b) => a - b)) {
    const busR = bus.find(([z]) => z === zoom)?.[1] ?? bus[bus.length - 1][1];
    const stationR = station.find(([z]) => z === zoom)?.[1] ?? station[station.length - 1][1];
    expr.push(zoom, ['case', majorStopFilter, stationR, busR]);
  }
  return expr as ExpressionSpecification;
}
