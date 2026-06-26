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
/** Major/station-class stop labels — shown earlier (and sparser) than normal stop labels. */
export const TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID = 'transport-major-stop-labels';
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
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
] as const;

/**
 * Bottom-to-top render order of the transport overlay (lines → casing equiv → circles → labels).
 * Mirrors the `addTransportLayers` insertion order so the move-to-top helper restacks transport
 * exactly as it was first added. `moveLayer(id)` with no `beforeId` pushes each layer to the top,
 * so the LAST id here ends up topmost. Keep this in sync with `addTransportLayers`.
 */
const TRANSPORT_RENDER_ORDER = [
  // Supporting infrastructure line acts as the route casing (drawn under route paths).
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  // Stop/terminal circles.
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  // Transport labels last so they sit above all transport geometry (and the basemap).
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
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

// Label placement priority. MapLibre places/draws features with the LOWER symbol-sort-key first,
// so the most important transport labels get the smallest values and win collisions against the
// less important ones (and over basemap labels, which carry no transport sort-key). Labels are
// collision-managed (no forced overlap) for a clean, professional look.
const TRANSPORT_MAJOR_LABEL_SORT_KEY = 1; // terminals + major/station-class stops
const TRANSPORT_ROUTE_LABEL_SORT_KEY = 5; // route names along the line
const TRANSPORT_STOP_LABEL_SORT_KEY = 10; // ordinary stop names (lowest priority)

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

/** Zoom-based label text-size ramp (compact at low zoom, comfortable when zoomed in). */
function labelTextSize(small: number, large: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 12, small, 16, large, 18, large + 1];
}

/** Zoom-based label opacity — fades labels in rather than popping them at minzoom. */
function labelTextOpacity(minZoom: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], minZoom, 0, minZoom + 1.5, 1];
}

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
      // Small dots at low zoom; major/station-class stops get a slightly larger radius so they
      // read as more important than ordinary bus stops. Grows gently with zoom.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        ['case', MAJOR_STOP_FILTER, 2.6, 1.8],
        15,
        ['case', MAJOR_STOP_FILTER, 4.2, 3.2],
        18,
        ['case', MAJOR_STOP_FILTER, 7, 6],
      ],
      'circle-color': transportModeColorExpression(),
      'circle-stroke-color': TRANSPORT_STOP_STROKE,
      // Hairline outline at low zoom so dense fields stay clean; firmer when zoomed in.
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 15, 1, 18, 1.5],
      // Fade dots in with zoom instead of a hard pop at minzoom.
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.45, 15, 0.8, 18, 0.9],
    },
  };
}

// Transport overlay layer — MAJOR stop labels (z12+). Only station/terminal-class stops, which
// are sparse, so they can appear earlier without clutter. Collision-managed (no forced overlap)
// and high placement priority via a low sort-key, so they win over ordinary stop/route labels.
function majorStopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: 12,
    filter: ['all', HAS_REAL_TRANSPORT_NAME, MAJOR_STOP_FILTER],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': labelTextSize(11, 12.5),
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_MAJOR_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelTextOpacity(12),
    },
  };
}

// Transport overlay layer — ordinary stop labels (z15.5+ only, to avoid a dense label cluster at
// city zoom). Excludes major/station-class stops (handled by the major-stop label layer above).
// Transit-tinted text with a white halo; collision-managed (no forced overlap) for a clean map.
// The text-field resolves only to a real name, so generated OSM fallbacks never render.
function stopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': 'transport_stops_v',
    minzoom: 15.5,
    filter: ['all', HAS_REAL_TRANSPORT_NAME, ['!', MAJOR_STOP_FILTER]],
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': labelTextSize(10.5, 11.5),
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
      'text-opacity': labelTextOpacity(15.5),
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
      'text-size': labelTextSize(11.5, 13),
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
      'text-opacity': labelTextOpacity(12),
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
      'text-size': labelTextSize(10.5, 11.5),
      'text-offset': [0, 1.0],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_STOP_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelTextOpacity(15),
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
    minzoom: 13,
    filter: TRANSPORT_ROUTE_LABEL_FILTER,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      // Wider spacing so route names repeat sparsely along the line instead of crowding it.
      'symbol-spacing': 450,
      'text-field': TRANSPORT_ROUTE_LABEL_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': labelTextSize(10.5, 11.5),
      'text-max-angle': 35,
      'text-padding': 6,
      // Collision-managed: route labels defer to basemap and higher-priority transport labels.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_ROUTE_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': '#5b21b6',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': labelTextOpacity(13),
    },
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
    // Ferry landings under major terminals so a major terminal wins when stacked.
    ferryLandingsLayer(),
    majorTerminalsLayer(),
    stopsLayer(),
    // Labels added after all geometry so they render on top.
    routeLabelsLayer(),
    majorTerminalLabelsLayer(),
    ferryLandingLabelsLayer(),
    majorStopLabelsLayer(),
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

/**
 * Restacks the transport overlay above the basemap. Each existing transport layer is moved to
 * the top (no `beforeId`) in {@link TRANSPORT_RENDER_ORDER} (lines → casing → circles → labels),
 * so transport always renders above PMTiles streets, road labels, and basemap labels.
 *
 * Idempotent and safe to call repeatedly: after `addTransportLayers`, and after the dynamic
 * regional PMTiles loader adds/removes/reloads basemap layers (newly added PMTiles layers are
 * appended on top and would otherwise cover the transport overlay). Missing layers are skipped.
 */
export function moveTransportLayersToTop(map: MapEngine): void {
  for (const layerId of TRANSPORT_RENDER_ORDER) {
    if (!map.getLayer(layerId)) continue;
    map.moveLayer(layerId);
  }
}
