/**
 * Normalizes MapLibre transport feature properties into a popup-ready model,
 * keyed by Martin source-layer name (with layer-id fallback). Debug inspection only —
 * no API calls. Tolerant of missing fields: absent/null/empty values render as "—".
 *
 * User-facing titles never expose generated OSM fallback names: terminal titles go through
 * the `transportDisplayName` helpers, so unnamed ferries read as "Ferry landing" instead of
 * `ferry_terminal osm:N:...`. Raw generated names remain only in the dev-only debug block.
 */
import { getFerryVehicleAccessNote, getTransportPopupTitle } from './transportDisplayName';

export const TRANSPORT_MISSING_VALUE = '—';

export type TransportFeatureKind = 'stop' | 'terminal' | 'route' | 'infrastructure';

export type TransportPopupRow = {
  readonly label: string;
  readonly value: string;
};

export type TransportPopupModel = {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly TransportPopupRow[];
};

type FeatureProperties = Record<string, unknown>;

const SOURCE_LAYER_TO_KIND: Readonly<Record<string, TransportFeatureKind>> = {
  transport_stops_v: 'stop',
  transport_terminals_v: 'terminal',
  transport_route_paths_v: 'route',
  transport_infrastructure_lines_v: 'infrastructure',
};

const LAYER_ID_TO_KIND: Readonly<Record<string, TransportFeatureKind>> = {
  'transport-stops': 'stop',
  'transport-stops-hitbox': 'stop',
  'transport-major-stop-labels': 'stop',
  'transport-stop-labels': 'stop',
  'transport-major-terminals': 'terminal',
  'transport-major-terminals-hitbox': 'terminal',
  'transport-major-terminal-labels': 'terminal',
  'transport-ferry-landings': 'terminal',
  'transport-ferry-landings-hitbox': 'terminal',
  'transport-ferry-landing-labels': 'terminal',
  'transport-route-paths': 'route',
  'transport-infrastructure-lines': 'infrastructure',
};

/** Resolves the feature kind from the MVT source-layer name first, then the style layer id. */
export function resolveTransportKind(
  sourceLayer: string | null | undefined,
  layerId: string | null | undefined,
): TransportFeatureKind | null {
  if (sourceLayer && sourceLayer in SOURCE_LAYER_TO_KIND) {
    return SOURCE_LAYER_TO_KIND[sourceLayer];
  }
  if (layerId && layerId in LAYER_ID_TO_KIND) {
    return LAYER_ID_TO_KIND[layerId];
  }
  return null;
}

/** True when a property carries a real value (0 and false are kept; null/undefined/'' are not). */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/** First present value among `keys`, as a trimmed string; otherwise `undefined`. */
function coalesce(properties: FeatureProperties, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (hasValue(value)) {
      return typeof value === 'string' ? value.trim() : String(value);
    }
  }
  return undefined;
}

/** Single-property display value, or the missing marker. */
function display(properties: FeatureProperties, key: string): string {
  const value = properties[key];
  return hasValue(value)
    ? typeof value === 'string'
      ? value.trim()
      : String(value)
    : TRANSPORT_MISSING_VALUE;
}

/** Display value from the first present of several keys, or the missing marker. */
function displayCoalesce(properties: FeatureProperties, keys: readonly string[]): string {
  return coalesce(properties, keys) ?? TRANSPORT_MISSING_VALUE;
}

/** Lowercased value of a single property, or empty string when absent. */
function readLower(properties: FeatureProperties, key: string): string {
  return (coalesce(properties, [key]) ?? '').toLowerCase();
}

/**
 * Terminal popup model. Ferries get user-safe wording (never a generated OSM name):
 * an unnamed ferry reads "Ferry landing", and imported-unreviewed ferries are flagged as
 * candidates with an "Imported from OSM, not verified" note. The transport tiles carry no
 * vehicle-access field, so ferry vehicle access is always reported as unknown.
 */
function buildTerminalPopupModel(properties: FeatureProperties): TransportPopupModel {
  const mode = readLower(properties, 'mode');
  const isFerry = mode === 'ferry';
  const isImportedUnreviewed = readLower(properties, 'review_status') === 'imported_unreviewed';

  const title = getTransportPopupTitle(properties, 'terminal');

  const subtitle = isFerry
    ? isImportedUnreviewed
      ? 'Ferry landing candidate'
      : 'Ferry landing'
    : 'Transport terminal';

  const rows: TransportPopupRow[] = [
    { label: 'Mode', value: display(properties, 'mode') },
    { label: 'Type', value: display(properties, 'terminal_role') },
    { label: 'Confidence', value: display(properties, 'confidence_score') },
    {
      label: 'Review',
      value: isImportedUnreviewed
        ? 'Imported from OSM, not verified'
        : display(properties, 'review_status'),
    },
  ];

  if (isFerry) {
    rows.push({ label: 'Vehicle', value: getFerryVehicleAccessNote(properties) });
  }

  return { title, subtitle, rows };
}

export function buildTransportPopupModel(
  kind: TransportFeatureKind,
  properties: FeatureProperties,
): TransportPopupModel {
  switch (kind) {
    case 'stop':
      return {
        title: getTransportPopupTitle(properties, 'stop'),
        subtitle: 'Transport stop',
        rows: [
          { label: 'Mode', value: display(properties, 'mode') },
          { label: 'Type', value: display(properties, 'stop_type') },
          { label: 'Confidence', value: display(properties, 'confidence_score') },
          { label: 'Review', value: display(properties, 'review_status') },
        ],
      };
    case 'terminal':
      return buildTerminalPopupModel(properties);
    case 'route':
      return {
        title: getTransportPopupTitle(properties, 'route'),
        subtitle: 'Transport route',
        rows: [
          { label: 'Mode', value: display(properties, 'mode') },
          { label: 'Type', value: displayCoalesce(properties, ['route_kind', 'path_kind']) },
          { label: 'Route code', value: display(properties, 'route_code') },
          { label: 'Variant', value: display(properties, 'variant_code') },
          {
            label: 'Direction',
            value: displayCoalesce(properties, ['direction_name', 'headsign']),
          },
          { label: 'Distance', value: display(properties, 'distance_m') },
          { label: 'Confidence', value: display(properties, 'confidence_score') },
          { label: 'Review', value: display(properties, 'review_status') },
        ],
      };
    case 'infrastructure':
      return {
        title: getTransportPopupTitle(properties, 'infrastructure'),
        subtitle: 'Transport infrastructure',
        rows: [
          { label: 'Mode', value: display(properties, 'mode') },
          { label: 'Type', value: display(properties, 'line_type') },
          { label: 'Confidence', value: display(properties, 'confidence_score') },
          { label: 'Review', value: display(properties, 'review_status') },
        ],
      };
  }
}
