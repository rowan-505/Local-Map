/**
 * Public map marker style tokens — colors, sizes, and selected-pin treatment.
 *
 * ## Normal points vs selected pins (why they are separate)
 *
 * **Normal points** — small MapLibre `circle` layers backed by vector tiles (transport)
 * or viewport GeoJSON (POI). They must stay cheap at hundreds–thousands per screen:
 * tiny radius, optional collision, no per-feature DOM.
 *
 * **Selected pins** — a second layer path for exactly one (or hover: one) feature:
 * - The normal circle for that id is hidden via a layer filter.
 * - A soft halo `circle` + large `symbol` pin (canvas `map.addImage`, not HTML DOM)
 *   draws above the quiet field so detail selection reads clearly (Naver-style).
 *
 * POI and transport both use MapLibre symbol pins for selection — not `maplibregl.Marker` DOM.
 *
 * Zoom/size policy: `publicMapMarkerPolicy.ts`.
 */
import type { ExpressionSpecification } from 'maplibre-gl';
import {
  busStopRadiusWithMajorCase,
  linearZoomRadius,
  TRANSPORT_POINT_HITBOX_RADIUS_EXPRESSION,
  RADIUS_BUS_STOP_STOPS,
  RADIUS_FERRY_LANDING_STOPS,
  RADIUS_POI_IMPORTANT_STOPS,
  RADIUS_SELECTED_HALO_STOPS,
  RADIUS_SELECTED_TRANSPORT_ANCHOR_STOPS,
  RADIUS_STATION_TERMINAL_STOPS,
  RADIUS_TRANSPORT_HOVER_HALO_STOPS,
  SIZE_SELECTED_PIN_STOPS,
  STROKE_DENSE_STOPS,
  STROKE_STATION_STOPS,
} from './publicMapMarkerPolicy';

export const MARKER_STROKE_WHITE = '#ffffff';

/** POI category circles — unchanged product palette. */
export const POI_MARKER_COLORS = {
  default: '#0ea5e9',
  selectedPin: '#f97316',
  stroke: MARKER_STROKE_WHITE,
} as const;

/**
 * Transport overlay palette — teal/cyan family, distinct from POI category colors.
 * Major stations/terminals use indigo for stronger emphasis at the same zoom.
 */
export const TRANSPORT_MARKER_COLORS = {
  bus: '#0891b2',
  rail: '#0f766e',
  ferry: '#2563eb',
  fallback: '#64748b',
  majorPoint: '#3730a3',
  selectedPin: '#0e7490',
  stroke: MARKER_STROKE_WHITE,
  label: '#0e7490',
  infrastructure: '#64748b',
} as const;

/** POI dense field — same scale as normal bus stops. */
export function poiNormalPointRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_BUS_STOP_STOPS);
}

/** POI important tier (z10–12.99). */
export function poiImportantPointRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_POI_IMPORTANT_STOPS);
}

/** Selected transport anchor circle (solid dot under the pin). */
export function selectedTransportAnchorRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_SELECTED_TRANSPORT_ANCHOR_STOPS);
}

/** Selected POI / transport halo radius. */
export function selectedMarkerHaloRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_SELECTED_HALO_STOPS);
}

/** Selected POI pin symbol scale. */
export function selectedPoiPinIconSize(): ExpressionSpecification {
  return linearZoomRadius(SIZE_SELECTED_PIN_STOPS);
}

/** Selected transport stop pin symbol scale. */
export function selectedTransportPinIconSize(): ExpressionSpecification {
  return linearZoomRadius(SIZE_SELECTED_PIN_STOPS);
}

/** Transport hover halo (lighter than selected). */
export function transportHoverHaloRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_TRANSPORT_HOVER_HALO_STOPS);
}

/** Invisible transport point click hitbox (see {@link PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS}). */
export function transportPointHitboxRadius(): ExpressionSpecification {
  return TRANSPORT_POINT_HITBOX_RADIUS_EXPRESSION;
}

/** Ordinary + station-class bus stops in `transport-stops`. */
export function transportNormalStopRadius(
  majorStopFilter: ExpressionSpecification,
): ExpressionSpecification {
  return busStopRadiusWithMajorCase(majorStopFilter);
}

/** Major terminal / interchange circles. */
export function transportStationPointRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_STATION_TERMINAL_STOPS);
}

/** Minor ferry landing circles. */
export function transportFerryLandingRadius(): ExpressionSpecification {
  return linearZoomRadius(RADIUS_FERRY_LANDING_STOPS);
}

/** White stroke width for dense POI + bus-stop circles. */
export function denseMarkerStrokeWidth(): ExpressionSpecification {
  return linearZoomRadius(STROKE_DENSE_STOPS);
}

/** White stroke width for station/terminal circles. */
export function stationMarkerStrokeWidth(): ExpressionSpecification {
  return linearZoomRadius(STROKE_STATION_STOPS);
}

export const SELECTED_POI_PIN_IMAGE_PREFIX = 'selected-place-pin' as const;

/** Mode-specific selected transport pin sprites (MapLibre symbol, not DOM). */
export const SELECTED_TRANSPORT_PIN_IMAGE_IDS = {
  bus: 'selected-transport-stop-pin-bus',
  rail: 'selected-transport-stop-pin-rail',
  ferry: 'selected-transport-stop-pin-ferry',
  terminal: 'selected-transport-stop-pin-terminal',
} as const;

/** @deprecated Use {@link SELECTED_TRANSPORT_PIN_IMAGE_IDS}.bus */
export const SELECTED_TRANSPORT_PIN_IMAGE_ID = SELECTED_TRANSPORT_PIN_IMAGE_IDS.bus;

export const SELECTED_MARKER_HALO = {
  poi: {
    color: POI_MARKER_COLORS.selectedPin,
    opacity: 0.18,
    blur: 0.35,
  },
  transport: {
    color: TRANSPORT_MARKER_COLORS.selectedPin,
    opacity: 0.2,
    blur: 0.35,
  },
  transportHover: {
    color: TRANSPORT_MARKER_COLORS.selectedPin,
    opacity: 0.22,
    blur: 0.2,
  },
} as const;
