/** Martin transport overlay layers. Sources are registered in `transportSources.ts`. */
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import type { MapEngine } from '../mapEngineTypes';
import {
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_LAYER_IDS,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';
import { TRANSPORT_POINT_HITBOX_LAYER_IDS } from './publicMapClickableLayerRegistry';
import { applyMapLayerStackBottomToTop } from './mapLayerStack';
import { PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP } from './publicMapMarkerStackOrder';
import { MARKER_ZOOM } from './publicMapMarkerPolicy';
import {
  LABEL_SORT_KEY,
  LABEL_ZOOM,
  labelFadeInOpacity,
  linearZoomTextSize,
  TEXT_SIZE_TRANSPORT_DENSE_STOP,
  TEXT_SIZE_TRANSPORT_MAJOR_STOP,
  TEXT_SIZE_TRANSPORT_ROUTE,
  TEXT_SIZE_TRANSPORT_TERMINAL,
} from './publicMapLabelPolicy';
import {
  denseMarkerStrokeWidth,
  stationMarkerStrokeWidth,
  TRANSPORT_MARKER_COLORS,
  transportFerryLandingRadius,
  transportNormalStopRadius,
  transportPointHitboxRadius,
  transportStationPointRadius,
} from './publicMapMarkerStyles';
import {
  clearTransportStopHighlights,
  setTransportHighlightLayersVisible,
} from './transportStopHighlight';
import {
  transportModeColorExpression,
  transportStopFillExpression,
  transportTerminalFillExpression,
  TRANSPORT_MODE_FERRY_COLOR,
} from './transportModeStyle';

export {
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_LAYER_IDS,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_POINT_LAYER_IDS,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';

export {
  TRANSPORT_POINT_HITBOX_LAYER_IDS,
  TRANSPORT_POINT_HIT_LAYER_IDS,
  TRANSPORT_SELECTED_POINT_CLICK_LAYER_IDS,
} from './publicMapClickableLayerRegistry';

/** Every transport overlay layer (incl. labels + hitboxes + selected/hover) — visibility toggling. */
export const TRANSPORT_OVERLAY_LAYER_IDS = [
  ...TRANSPORT_LAYER_IDS,
  ...TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  ...TRANSPORT_POINT_HITBOX_LAYER_IDS,
] as const;

/** Route label: human route name first, else the route code. */
const TRANSPORT_ROUTE_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'public_name'],
  ['get', 'route_code'],
];

/** Only label route features that actually carry a public name or route code. */
const TRANSPORT_ROUTE_LABEL_FILTER: ExpressionSpecification = [
  'any',
  ['to-boolean', ['get', 'public_name']],
  ['to-boolean', ['get', 'route_code']],
];

/**
 * A name field is a real, user-safe name when it is present AND not a generated OSM fallback.
 * Generated import names (e.g. `ferry_terminal osm:N:...`, `osm:W:123`) all contain the
 * `osm:` token, so a single substring test mirrors the `transportDisplayName` helpers without
 * regex (MapLibre `index-of`). Empty/absent fields coalesce to '' → treated as not-a-name.
 */
function realNameFieldExpression(field: string): ExpressionSpecification {
  return [
    'all',
    ['!=', ['coalesce', ['get', field], ''], ''],
    ['==', ['index-of', 'osm:', ['coalesce', ['get', field], '']], -1],
  ] as ExpressionSpecification;
}

/** True when any of name_mm / name_en / name is a real (non-blank, non-generated) name. */
const HAS_REAL_TRANSPORT_NAME: ExpressionSpecification = [
  'any',
  realNameFieldExpression('name_mm'),
  realNameFieldExpression('name_en'),
  realNameFieldExpression('name'),
];

/**
 * Label text = the FIRST real name among name_mm → name_en → name, else '' (no label).
 * Unlike a plain `coalesce`, this never falls through to a generated `osm:` value: a field
 * is only chosen when it passes `realNameFieldExpression`, so generated/blank names can never
 * be rendered as a map label even if the layer filter changes. Used by stop AND terminal labels.
 */
const REAL_TRANSPORT_NAME_TEXT_FIELD: ExpressionSpecification = [
  'case',
  realNameFieldExpression('name_mm'),
  ['get', 'name_mm'],
  realNameFieldExpression('name_en'),
  ['get', 'name_en'],
  realNameFieldExpression('name'),
  ['get', 'name'],
  '',
] as ExpressionSpecification;

const TERMINAL_IS_FERRY: ExpressionSpecification = ['==', ['get', 'mode'], 'ferry'];

/** Reviewed (review_status present and not the OSM import default) OR high confidence (≥80). */
const TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE: ExpressionSpecification = [
  'any',
  [
    'all',
    ['!=', ['coalesce', ['get', 'review_status'], ''], ''],
    ['!=', ['coalesce', ['get', 'review_status'], ''], 'imported_unreviewed'],
  ],
  ['>=', ['coalesce', ['get', 'confidence_score'], 0], 80],
];

/** A ferry that has earned a real name AND review/high-confidence is promoted to major. */
const FERRY_PROMOTED_TO_MAJOR: ExpressionSpecification = [
  'all',
  HAS_REAL_TRANSPORT_NAME,
  TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE,
];

/**
 * Major terminals: named, non-generated. Non-ferry modes (bus/train/air) qualify on a real
 * name alone; ferries only qualify once reviewed/high-confidence. Unnamed and generated-name
 * terminals are excluded entirely.
 */
const MAJOR_TERMINALS_FILTER: ExpressionSpecification = [
  'all',
  HAS_REAL_TRANSPORT_NAME,
  ['any', ['!', TERMINAL_IS_FERRY], TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE],
];

/** Ferry landings: every ferry that has NOT been promoted to a major terminal. */
const FERRY_LANDINGS_FILTER: ExpressionSpecification = [
  'all',
  TERMINAL_IS_FERRY,
  ['!', FERRY_PROMOTED_TO_MAJOR],
];

/**
 * Transport overlay palette tokens — see `publicMapMarkerStyles.ts`.
 */
const TRANSPORT_INFRASTRUCTURE_COLOR = TRANSPORT_MARKER_COLORS.infrastructure;
const TRANSPORT_TERMINAL_STROKE = TRANSPORT_MARKER_COLORS.stroke;
const TRANSPORT_FERRY_LANDING_STROKE = TRANSPORT_MARKER_COLORS.stroke;
const TRANSPORT_STOP_STROKE = TRANSPORT_MARKER_COLORS.stroke;
const TRANSPORT_STOP_LABEL_COLOR = TRANSPORT_MARKER_COLORS.label;

let selectedTransportStopId: string | null = null;

function excludeSelectedPointFilter(
  baseFilter: ExpressionSpecification | undefined,
  selectedId: string | null,
): ExpressionSpecification {
  if (!selectedId) {
    return baseFilter ?? (['has', 'id'] as ExpressionSpecification);
  }
  const excludeSelected: ExpressionSpecification = [
    'all',
    ['!=', ['to-string', ['coalesce', ['get', 'id'], '']], selectedId],
    ['!=', ['to-string', ['coalesce', ['get', 'public_id'], '']], selectedId],
  ];
  if (!baseFilter) return ['all', ['has', 'id'], excludeSelected];
  return ['all', baseFilter, excludeSelected];
}

/** Hides the tile stop/terminal dot under the selected pin overlay. */
export function setTransportSelectedStopId(map: MapEngine, selectedId: string | null): void {
  selectedTransportStopId = selectedId;
  applyTransportPointSelectionFilters(map);
}

function applyTransportPointSelectionFilters(map: MapEngine): void {
  if (map.getLayer(TRANSPORT_STOPS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_STOPS_LAYER_ID,
      excludeSelectedPointFilter(undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_STOPS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_STOPS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_MAJOR_TERMINALS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
      excludeSelectedPointFilter(MAJOR_TERMINALS_FILTER, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(MAJOR_TERMINALS_FILTER, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_FERRY_LANDINGS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_FERRY_LANDINGS_LAYER_ID,
      excludeSelectedPointFilter(FERRY_LANDINGS_FILTER, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(FERRY_LANDINGS_FILTER, selectedTransportStopId),
    );
  }
}

// Label placement priority. MapLibre places/draws features with the LOWER symbol-sort-key first,
// so the most important transport labels get the smallest values and win collisions against the
// less important ones (and over basemap labels, which carry no transport sort-key). Labels are
// collision-managed (no forced overlap) for a clean, professional look.
const TRANSPORT_MAJOR_LABEL_SORT_KEY = LABEL_SORT_KEY.transportTerminal;
const TRANSPORT_MAJOR_STOP_LABEL_SORT_KEY = LABEL_SORT_KEY.transportMajorStop;
const TRANSPORT_ROUTE_LABEL_SORT_KEY = LABEL_SORT_KEY.transportRoute;
const TRANSPORT_STOP_LABEL_SORT_KEY = LABEL_SORT_KEY.transportDenseStop;
const TRANSPORT_FERRY_LABEL_SORT_KEY = LABEL_SORT_KEY.transportFerry;

/** Station/terminal-class stop types — the "major" stops surfaced earlier than ordinary stops. */
const MAJOR_STOP_TYPES = ['bus_station', 'terminal', 'rail_station', 'ferry_terminal', 'airport'];

/**
 * Major stop = station/terminal-class `stop_type`. The Martin stop tiles carry no
 * `importance_score`, so `stop_type` is the deterministic "major" signal (ordinary `bus_stop`s
 * are the normal tier). Used to split stop labels into an early, sparse major tier and a
 * high-zoom-only ordinary tier.
 */
const MAJOR_STOP_FILTER: ExpressionSpecification = [
  'in',
  ['coalesce', ['get', 'stop_type'], 'bus_stop'],
  ['literal', MAJOR_STOP_TYPES],
];

// Transport overlay layer — supporting infrastructure (rail/ferry/etc.), not basemap roads.
// Kept visually secondary to route paths: thinner, dashed, lower opacity, muted slate.
function infrastructureLinesLayer(): LineLayerSpecification {
  return {
    id: TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
    type: 'line',
    source: 'transport-infrastructure-lines-source',
    'source-layer': 'transport_infrastructure_lines_v',
    minzoom: 8,
    layout: { visibility: 'none', 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': TRANSPORT_INFRASTRUCTURE_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.4, 18, 2.4],
      'line-opacity': 0.5,
      'line-dasharray': [2, 2],
    },
  };
}

// Transport overlay layer — transit route paths. Color is mode-driven (bus=violet, rail=teal,
// ferry=blue, other=slate) via `transportModeColorExpression`. Deliberately restrained: thin and
// translucent at low zoom so routes read as a faint network over the roads, growing to a clear
// (but still not overpowering) line when zoomed in.
function routePathsLayer(): LineLayerSpecification {
  return {
    id: TRANSPORT_ROUTE_PATHS_LAYER_ID,
    type: 'line',
    source: 'transport-route-paths-source',
    'source-layer': 'transport_route_paths_v',
    minzoom: 10,
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': transportModeColorExpression(),
      // Thinner at low zoom than before; only grows substantial once zoomed into a city.
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.4, 16, 3, 18, 4.5],
      // Faint when zoomed out so it never dominates roads; firmer (but <1) up close.
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 13, 0.55, 16, 0.75],
    },
  };
}

// Transport overlay layer — major terminals/interchanges. Station-scale circles with white halo;
// visible from z12 (policy). Filtered to real-named (non-generated) terminals.
function majorTerminalsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: MARKER_ZOOM.TRANSPORT_TERMINAL_MIN,
    filter: MAJOR_TERMINALS_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': transportStationPointRadius(),
      'circle-color': transportTerminalFillExpression(),
      'circle-stroke-color': TRANSPORT_TERMINAL_STROKE,
      'circle-stroke-width': stationMarkerStrokeWidth(),
      'circle-opacity': 0.96,
      'circle-stroke-opacity': 1,
    },
  };
}

// Transport overlay layer — ferry/boat landing candidates. Small, low-opacity dots with a
// white ring; only when zoomed in (z13+). Visually subordinate to major terminals.
function ferryLandingsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_FERRY_LANDINGS_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: MARKER_ZOOM.TRANSPORT_FERRY_MIN,
    filter: FERRY_LANDINGS_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': transportFerryLandingRadius(),
      'circle-color': TRANSPORT_MODE_FERRY_COLOR,
      'circle-stroke-color': TRANSPORT_FERRY_LANDING_STROKE,
      'circle-stroke-width': denseMarkerStrokeWidth(),
      'circle-opacity': 0.55,
      'circle-stroke-opacity': 0.95,
    },
  };
}

// Transport overlay layer — stops. Small teal/cyan circles with white stroke; dense-friendly
// at z13+. Station-class stops are slightly larger and indigo-tinted via fill expression.
function stopsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_STOPS_LAYER_ID,
    type: 'circle',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: MARKER_ZOOM.TRANSPORT_BUS_STOP_MIN,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': transportNormalStopRadius(MAJOR_STOP_FILTER),
      'circle-color': transportStopFillExpression(),
      'circle-stroke-color': TRANSPORT_STOP_STROKE,
      'circle-stroke-width': denseMarkerStrokeWidth(),
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.72, 15, 0.88, 18, 0.95],
      'circle-stroke-opacity': 1,
    },
  };
}

// Transport overlay layer — MAJOR stop labels (z14+). Station/terminal-class stops only.
function majorStopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: LABEL_ZOOM.TRANSPORT_MAJOR_STOP_MIN,
    filter: ['all', HAS_REAL_TRANSPORT_NAME, MAJOR_STOP_FILTER],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_MAJOR_STOP),
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_MAJOR_STOP_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_MAJOR_STOP_MIN),
    },
  };
}

// Transport overlay layer — ordinary stop labels (z18+ only).
// Transit-tinted text with a white halo; collision-managed (no forced overlap) for a clean map.
// The text-field resolves only to a real name, so generated OSM fallbacks never render.
function stopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: LABEL_ZOOM.TRANSPORT_DENSE_STOP_MIN,
    filter: ['all', HAS_REAL_TRANSPORT_NAME, ['!', MAJOR_STOP_FILTER]],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_DENSE_STOP),
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      // Collision-managed: ordinary stop labels yield to each other and to higher-priority labels.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_STOP_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_DENSE_STOP_MIN),
    },
  };
}

// Transport overlay layer — major terminal labels (z12+).
// Filtered to major terminals (named, non-generated) and the text-field only ever resolves to
// a real name (never a generated OSM fallback), so unnamed/generated terminals get no label.
// Point-placed, non-overlapping so they yield to existing basemap labels and each other.
function majorTerminalLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: LABEL_ZOOM.TRANSPORT_TERMINAL_MIN,
    filter: ['all', MAJOR_TERMINALS_FILTER, HAS_REAL_TRANSPORT_NAME],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_TERMINAL),
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      // Collision-managed; prioritized over stops/routes via a low sort-key.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_MAJOR_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_TERMINAL_MIN),
    },
  };
}

// Transport overlay layer — ferry landing labels (z18+).
// Filtered to ferry landings that have a real name; the text-field never resolves to a
// generated OSM fallback. Smaller text to match the subtle ferry-landing markers. Most ferry
// landings are unnamed/generated, so this labels only the small named subset.
function ferryLandingLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: LABEL_ZOOM.TRANSPORT_FERRY_MIN,
    filter: ['all', FERRY_LANDINGS_FILTER, HAS_REAL_TRANSPORT_NAME],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_DENSE_STOP),
      'text-offset': [0, 1.0],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_FERRY_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_FERRY_MIN),
    },
  };
}

// Transport overlay layer — route labels (z13+). Line-placed along the route and filtered to
// features with a public_name/route_code, so empty routes add no clutter and labels follow the
// path instead of stamping over roads. Non-overlapping to defer to basemap labels.
function routeLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_ROUTE_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-route-paths-source',
    'source-layer': 'transport_route_paths_v',
    minzoom: LABEL_ZOOM.TRANSPORT_ROUTE_MIN,
    filter: TRANSPORT_ROUTE_LABEL_FILTER,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'symbol-spacing': 450,
      'text-field': TRANSPORT_ROUTE_LABEL_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_ROUTE),
      'text-max-angle': 35,
      'text-padding': 6,
      // Collision-managed: route labels defer to basemap and higher-priority transport labels.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_ROUTE_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': '#0e7490',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_ROUTE_MIN),
    },
  };
}

/** Shared paint for invisible transport click hitboxes (must stay visually imperceptible). */
function transportPointHitboxPaint(): CircleLayerSpecification['paint'] {
  return {
    'circle-radius': transportPointHitboxRadius(),
    'circle-color': '#000000',
    'circle-opacity': 0,
    'circle-stroke-width': 0,
    'circle-stroke-opacity': 0,
  };
}

// Transport overlay layer — invisible click hitbox for all stops (bus_stop + station-class).
// Same source/filter as `transport-stops`; radius is larger than the visual dot (see policy).
function stopsHitboxLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_STOPS_HITBOX_LAYER_ID,
    type: 'circle',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: MARKER_ZOOM.TRANSPORT_BUS_STOP_MIN,
    layout: { visibility: 'none' },
    paint: transportPointHitboxPaint(),
  };
}

function majorTerminalsHitboxLayer(): CircleLayerSpecification {
  // Invisible click target — same source/filter as `transport-major-terminals`.
  return {
    id: TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: MARKER_ZOOM.TRANSPORT_TERMINAL_MIN,
    filter: MAJOR_TERMINALS_FILTER,
    layout: { visibility: 'none' },
    paint: transportPointHitboxPaint(),
  };
}

function ferryLandingsHitboxLayer(): CircleLayerSpecification {
  // Invisible click target — same source/filter as `transport-ferry-landings`.
  return {
    id: TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: MARKER_ZOOM.TRANSPORT_FERRY_MIN,
    filter: FERRY_LANDINGS_FILTER,
    layout: { visibility: 'none' },
    paint: transportPointHitboxPaint(),
  };
}

/**
 * Adds every transport overlay layer, all hidden (`visibility: 'none'`).
 * Idempotent: layers that already exist (after a style reload or re-render) are skipped,
 * so it is safe to call from every `load` handler. Sources must be added first.
 */
export function addTransportLayers(map: MapEngine): void {
  const layers = [
    infrastructureLinesLayer(),
    routePathsLayer(),
    stopsLayer(),
    ferryLandingsLayer(),
    majorTerminalsLayer(),
    routeLabelsLayer(),
    majorTerminalLabelsLayer(),
    ferryLandingLabelsLayer(),
    majorStopLabelsLayer(),
    stopLabelsLayer(),
    stopsHitboxLayer(),
    ferryLandingsHitboxLayer(),
    majorTerminalsHitboxLayer(),
  ];

  for (const layer of layers) {
    if (map.getLayer(layer.id)) continue;
    map.addLayer(layer);
  }
}

/**
 * Shows or hides every transport overlay layer. Only flips `visibility` — basemap and
 * other layers are untouched. Missing layers (overlay not configured) are skipped.
 */
export function setTransportOverlayVisible(map: MapEngine, visible: boolean): void {
  const visibility = visible ? 'visible' : 'none';
  for (const layerId of TRANSPORT_OVERLAY_LAYER_IDS) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(layerId, 'visibility', visibility);
  }
  setTransportHighlightLayersVisible(map, visible);
  if (!visible) {
    selectedTransportStopId = null;
    applyTransportPointSelectionFilters(map);
    clearTransportStopHighlights(map);
  }
}

/**
 * Restacks transport + all public overlays in {@link PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP}.
 * Idempotent — safe after regional PMTiles reload or overlay toggles.
 */
export function moveTransportLayersToTop(map: MapEngine): void {
  applyMapLayerStackBottomToTop(map, PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP);
}
