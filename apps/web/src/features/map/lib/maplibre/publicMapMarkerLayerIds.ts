/**
 * Canonical layer and source ids for public-map point markers.
 *
 * Normal points (POI circles, transport stop circles) live in tile/GeoJSON circle layers.
 * Selected pins (POI symbol, transport symbol) live in separate filtered layers/sources so
 * only one large pin is drawn at a time — see `publicMapMarkerStyles.ts`.
 */

/** POI product overlay (API viewport GeoJSON). */
export const POI_MARKER_LAYER_IDS = {
  source: 'places',
  important: 'places-important-circle',
  normal: 'places-circle',
  selectedHalo: 'places-selected-halo',
  selectedPin: 'places-selected-circle',
  importantLabel: 'places-important-label',
  label: 'places-label',
  selectedLabel: 'places-selected-label',
} as const;

/** Martin transport — dense normal points only (vector tile circles). */
export const TRANSPORT_NORMAL_POINT_LAYER_IDS = {
  stops: 'transport-stops',
  majorTerminals: 'transport-major-terminals',
  ferryLandings: 'transport-ferry-landings',
} as const;

/** Invisible click-target circles above visual markers (same tile features, larger radius). */
export const TRANSPORT_POINT_HITBOX_LAYER_IDS_MAP = {
  stops: 'transport-stops-hitbox',
  majorTerminals: 'transport-major-terminals-hitbox',
  ferryLandings: 'transport-ferry-landings-hitbox',
} as const;

/** Single-feature GeoJSON overlay for hover + selected transport stop pin. */
export const TRANSPORT_SELECTED_MARKER_LAYER_IDS = {
  source: 'transport-stop-highlight-source',
  hoverHalo: 'transport-stop-hover-halo',
  selectedHalo: 'transport-stop-selected-halo',
  selectedCircle: 'transport-stop-selected-circle',
  selectedPin: 'transport-stop-selected-pin',
  selectedLabel: 'transport-stop-selected-label',
} as const;

/** Transport route/infrastructure lines (under point markers). */
export const TRANSPORT_LINE_LAYER_IDS = {
  infrastructure: 'transport-infrastructure-lines',
  routePaths: 'transport-route-paths',
} as const;

/** Transport label symbols (above normal points, still below POI when stack is applied). */
export const TRANSPORT_LABEL_LAYER_IDS = {
  routeLabels: 'transport-route-labels',
  majorTerminalLabels: 'transport-major-terminal-labels',
  ferryLandingLabels: 'transport-ferry-landing-labels',
  majorStopLabels: 'transport-major-stop-labels',
  stopLabels: 'transport-stop-labels',
} as const;

// --- Back-compat aliases (existing modules import these names) ---

export const PLACES_SOURCE_ID = POI_MARKER_LAYER_IDS.source;
export const PLACES_IMPORTANT_LAYER_ID = POI_MARKER_LAYER_IDS.important;
export const PLACES_LAYER_ID = POI_MARKER_LAYER_IDS.normal;
export const PLACES_SELECTED_HALO_LAYER_ID = POI_MARKER_LAYER_IDS.selectedHalo;
export const PLACES_SELECTED_LAYER_ID = POI_MARKER_LAYER_IDS.selectedPin;
export const PLACES_IMPORTANT_LABEL_LAYER_ID = POI_MARKER_LAYER_IDS.importantLabel;
export const PLACES_LABEL_LAYER_ID = POI_MARKER_LAYER_IDS.label;
export const PLACES_SELECTED_LABEL_LAYER_ID = POI_MARKER_LAYER_IDS.selectedLabel;

export const TRANSPORT_STOPS_LAYER_ID = TRANSPORT_NORMAL_POINT_LAYER_IDS.stops;
export const TRANSPORT_MAJOR_TERMINALS_LAYER_ID = TRANSPORT_NORMAL_POINT_LAYER_IDS.majorTerminals;
export const TRANSPORT_FERRY_LANDINGS_LAYER_ID = TRANSPORT_NORMAL_POINT_LAYER_IDS.ferryLandings;

export const TRANSPORT_STOPS_HITBOX_LAYER_ID = TRANSPORT_POINT_HITBOX_LAYER_IDS_MAP.stops;
export const TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID =
  TRANSPORT_POINT_HITBOX_LAYER_IDS_MAP.majorTerminals;
export const TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID =
  TRANSPORT_POINT_HITBOX_LAYER_IDS_MAP.ferryLandings;

export const TRANSPORT_HIGHLIGHT_SOURCE_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.source;
export const TRANSPORT_HOVER_HALO_LAYER_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.hoverHalo;
export const TRANSPORT_SELECTED_HALO_LAYER_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.selectedHalo;
export const TRANSPORT_SELECTED_CIRCLE_LAYER_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.selectedCircle;
export const TRANSPORT_SELECTED_PIN_LAYER_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.selectedPin;
export const TRANSPORT_SELECTED_LABEL_LAYER_ID = TRANSPORT_SELECTED_MARKER_LAYER_IDS.selectedLabel;

export const TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID = TRANSPORT_LINE_LAYER_IDS.infrastructure;
export const TRANSPORT_ROUTE_PATHS_LAYER_ID = TRANSPORT_LINE_LAYER_IDS.routePaths;

export const TRANSPORT_ROUTE_LABELS_LAYER_ID = TRANSPORT_LABEL_LAYER_IDS.routeLabels;
export const TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID =
  TRANSPORT_LABEL_LAYER_IDS.majorTerminalLabels;
export const TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID =
  TRANSPORT_LABEL_LAYER_IDS.ferryLandingLabels;
export const TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID = TRANSPORT_LABEL_LAYER_IDS.majorStopLabels;
export const TRANSPORT_STOP_LABELS_LAYER_ID = TRANSPORT_LABEL_LAYER_IDS.stopLabels;

export const TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS = [
  TRANSPORT_HOVER_HALO_LAYER_ID,
  TRANSPORT_SELECTED_HALO_LAYER_ID,
  TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
] as const;

export const TRANSPORT_LAYER_IDS = [
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
] as const;

export const TRANSPORT_POINT_LAYER_IDS = [
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
] as const;
