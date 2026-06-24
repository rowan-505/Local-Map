/**
 * Martin transport overlay layers (hidden by default — `visibility: 'none'`).
 * Sources are registered separately in `transportSources.ts`; this module only adds layers
 * and never calls the Fastify API. Keep styling simple and readable (no overstyling).
 */
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import type { MapEngine } from '../mapEngineTypes';
import { transportModeColorExpression, TRANSPORT_MODE_FERRY_COLOR } from './transportModeStyle';

export const TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID = 'transport-infrastructure-lines';
export const TRANSPORT_ROUTE_PATHS_LAYER_ID = 'transport-route-paths';
/**
 * Terminals are split into two layers driven by name quality + mode (see filters below):
 * - major terminals: named, non-generated bus/train/air (or reviewed/high-confidence) — z9+
 * - ferry landings: every ferry that isn't a promoted major terminal — small/subtle, z13+
 */
export const TRANSPORT_MAJOR_TERMINALS_LAYER_ID = 'transport-major-terminals';
export const TRANSPORT_FERRY_LANDINGS_LAYER_ID = 'transport-ferry-landings';
export const TRANSPORT_STOPS_LAYER_ID = 'transport-stops';
export const TRANSPORT_STOP_LABELS_LAYER_ID = 'transport-stop-labels';
/** Terminal labels are split to match the marker split and their distinct zoom thresholds. */
export const TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID = 'transport-major-terminal-labels';
export const TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID = 'transport-ferry-landing-labels';
export const TRANSPORT_ROUTE_LABELS_LAYER_ID = 'transport-route-labels';

/**
 * Click hit-test priority order (highest first): point layers before line layers, so an
 * overlapping stop/terminal wins over a route/infrastructure line under the cursor.
 */
export const TRANSPORT_LAYER_IDS = [
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
] as const;

/** Every transport overlay layer (incl. label symbols) — used for visibility toggling. */
export const TRANSPORT_OVERLAY_LAYER_IDS = [
  ...TRANSPORT_LAYER_IDS,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
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
 * Transport overlay palette — deliberately separate from POI/place colors and basemap roads.
 * POIs use sky/cyan/red/purple category fills with white strokes; the basemap draws roads in
 * neutral casings. Transport uses a violet/indigo "transit" family for routes & terminals,
 * a muted slate for infrastructure, and dark/white strokes for points, so overlay features
 * never read as places or roads. These tokens style the OVERLAY only — never the basemap.
 *
 * Per-mode fills (bus/rail/ferry) come from `transportModeColorExpression`; the constants
 * below are the mode-independent strokes/secondary colors.
 */
const TRANSPORT_INFRASTRUCTURE_COLOR = '#64748b'; // slate-500 — supporting infrastructure
const TRANSPORT_TERMINAL_STROKE = '#ffffff'; // strong white halo around major terminals
const TRANSPORT_FERRY_LANDING_STROKE = '#1d4ed8'; // blue-700 — crisp ring for low-opacity landings
const TRANSPORT_STOP_STROKE = '#0e3a5f'; // dark navy outline for contrast on light basemap
const TRANSPORT_STOP_LABEL_COLOR = '#155e75'; // cyan-800 — readable transit label

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

// Transport overlay layer — transit route paths. Intentionally bolder than basemap roads
// (wider with zoom) so riders can trace a route over the base streets. Color is mode-driven
// (bus=violet, rail=teal, ferry=blue, other=slate) via `transportModeColorExpression`.
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
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 4, 18, 7],
      'line-opacity': 0.85,
    },
  };
}

// Transport overlay layer — major terminals/interchanges. The most important overlay points:
// larger than stops with a strong white halo, visible earlier (z9+). Filtered to real-named
// (non-generated) terminals. Fill is mode-driven (bus=violet, rail=teal, ferry=blue, other=
// slate) via `transportModeColorExpression`.
function majorTerminalsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: 9,
    filter: MAJOR_TERMINALS_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 9, 18, 12],
      'circle-color': transportModeColorExpression(),
      'circle-stroke-color': TRANSPORT_TERMINAL_STROKE,
      // Strong outline that scales with the marker so it stays well-defined when zoomed in.
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 2.5, 18, 3],
      'circle-opacity': 0.95,
      'circle-stroke-opacity': 1,
    },
  };
}

// Transport overlay layer — ferry/boat landing candidates. Mostly OSM-imported, unreviewed
// points that are NOT major terminals, so they stay deliberately small, low-opacity and only
// appear when zoomed in (z13+). A small ferry-blue fill with a crisp darker-blue ring: clearly
// outlined yet faint, and intentionally NOT the orange POI/place pin style — it reads as a minor
// landing, not a vehicle ferry terminal, and stays visually subordinate to major terminals.
function ferryLandingsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_FERRY_LANDINGS_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: 13,
    filter: FERRY_LANDINGS_FILTER,
    layout: { visibility: 'none' },
    paint: {
      // Tiny at z13, only slightly larger from z15+ — always smaller than major terminals.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 15, 3.5, 18, 5],
      'circle-color': TRANSPORT_MODE_FERRY_COLOR,
      // Crisp, slightly darker-blue ring gives definition without a heavy white POI-like halo.
      'circle-stroke-color': TRANSPORT_FERRY_LANDING_STROKE,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 1.4],
      // Low fill opacity keeps the dense field faint; the ring stays readable on its own.
      'circle-opacity': 0.45,
      'circle-stroke-opacity': 0.9,
    },
  };
}

// Transport overlay layer — stops. Small and dense-friendly (appear at z13) with a dark navy
// outline so they stay legible on the light basemap without mimicking POI markers. Fill is
// mode-driven (bus=violet, rail=teal, ferry=blue, other=slate) via `transportModeColorExpression`.
function stopsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_STOPS_LAYER_ID,
    type: 'circle',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: 13,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 15, 5, 18, 7],
      'circle-color': transportModeColorExpression(),
      'circle-stroke-color': TRANSPORT_STOP_STROKE,
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.9,
    },
  };
}

// Transport overlay layer — stop labels (z15+). Transit-tinted text with a white halo,
// distinct from POI/place label color, anchored below the stop circle. Filtered to real
// (non-generated, non-blank) names, and the text-field resolves only to a real name, so
// generated OSM fallback names (e.g. `bus_stop osm:...`) never render as stop labels.
function stopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: 15,
    filter: HAS_REAL_TRANSPORT_NAME,
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
    },
  };
}

// Transport overlay layer — major terminal labels (z12+, terminals appear earlier than stops).
// Filtered to major terminals (named, non-generated) and the text-field only ever resolves to
// a real name (never a generated OSM fallback), so unnamed/generated terminals get no label.
// Point-placed, non-overlapping so they yield to existing basemap labels and each other.
function majorTerminalLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: 12,
    filter: ['all', MAJOR_TERMINALS_FILTER, HAS_REAL_TRANSPORT_NAME],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': 12,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  };
}

// Transport overlay layer — ferry landing labels (z15+ only, later than major terminals).
// Filtered to ferry landings that have a real name; the text-field never resolves to a
// generated OSM fallback. Smaller text to match the subtle ferry-landing markers. Most ferry
// landings are unnamed/generated, so this labels only the small named subset.
function ferryLandingLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-terminals-source',
    'source-layer': 'transport_terminals_v',
    minzoom: 15,
    filter: ['all', FERRY_LANDINGS_FILTER, HAS_REAL_TRANSPORT_NAME],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': 11,
      'text-offset': [0, 1.0],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
    },
  };
}

// Transport overlay layer — route labels (z12+). Line-placed along the route and filtered to
// features with a public_name/route_code, so empty routes add no clutter and labels follow the
// path instead of stamping over roads. Non-overlapping to defer to basemap labels.
function routeLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_ROUTE_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-route-paths-source',
    'source-layer': 'transport_route_paths_v',
    minzoom: 12,
    filter: TRANSPORT_ROUTE_LABEL_FILTER,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'symbol-spacing': 300,
      'text-field': TRANSPORT_ROUTE_LABEL_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': 11,
      'text-max-angle': 35,
      'text-padding': 6,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#5b21b6',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  };
}

/**
 * Adds the five transport overlay layers, all hidden (`visibility: 'none'`).
 * Idempotent: layers that already exist (after a style reload or re-render) are skipped,
 * so it is safe to call from every `load` handler. Sources must be added first.
 */
export function addTransportLayers(map: MapEngine): void {
  const layers = [
    infrastructureLinesLayer(),
    routePathsLayer(),
    // Ferry landings under major terminals so a major terminal wins when stacked.
    ferryLandingsLayer(),
    majorTerminalsLayer(),
    stopsLayer(),
    // Labels added after all geometry so they render on top.
    routeLabelsLayer(),
    majorTerminalLabelsLayer(),
    ferryLandingLabelsLayer(),
    stopLabelsLayer(),
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
}
