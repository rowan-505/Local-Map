/**
 * Hide generated import ids (`osm:N:123`, `ferry_terminal osm:…`) from map labels and popups.
 */

type FeatureProperties = Record<string, unknown>;

export type TransportPopupFeatureKind = 'stop' | 'terminal' | 'route' | 'infrastructure';

export type TransportTerminalDisplayClass =
  | 'ferry_landing_candidate'
  | 'named_ferry_landing_candidate'
  | 'major_terminal_candidate'
  | 'unreviewed_terminal_candidate';

const GENERATED_OSM_SUBSTRINGS = ['osm:N:', 'osm:W:', 'osm:R:'] as const;

const GENERATED_OSM_PREFIXES = [
  'ferry_terminal osm:',
  'bus_stop osm:',
  'station osm:',
  'terminal osm:',
  'stop osm:',
] as const;

const MAJOR_TERMINAL_MODES = new Set(['bus', 'local_bus', 'train', 'rail', 'air']);

export const FERRY_VEHICLE_ACCESS_UNKNOWN = 'Vehicle access unknown';

/** Amenity=ferry_terminal is not enough to claim vehicle boarding. */
const VEHICLE_ACCESS_KEYS = [
  'motor_vehicle',
  'motorcar',
  'motorcycle',
  'vehicle',
  'car',
  'car_ferry',
] as const;

const VEHICLE_ACCESS_YES = new Set(['yes', 'designated', 'permissive', 'true', '1']);
const VEHICLE_ACCESS_NO = new Set(['no', 'none', 'false', '0']);

const TRANSPORT_NAME_KEYS = ['name_mm', 'name_en', 'name'] as const;

function readString(properties: FeatureProperties, key: string): string | undefined {
  const value = properties[key];
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? value : String(value);
}

export function isBlankTransportName(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = typeof value === 'string' ? value : String(value);
  return text.trim() === '';
}

export function isGeneratedOsmTransportName(value: unknown): boolean {
  if (isBlankTransportName(value)) return false;
  const text = (typeof value === 'string' ? value : String(value)).trim();

  for (const token of GENERATED_OSM_SUBSTRINGS) {
    if (text.includes(token)) return true;
  }
  for (const prefix of GENERATED_OSM_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}

export function isRealTransportDisplayName(value: unknown): boolean {
  return !isBlankTransportName(value) && !isGeneratedOsmTransportName(value);
}

export function getTransportDisplayName(properties: FeatureProperties): string | null {
  for (const key of TRANSPORT_NAME_KEYS) {
    const value = readString(properties, key);
    if (isRealTransportDisplayName(value)) {
      return (value as string).trim();
    }
  }
  return null;
}

function readMode(properties: FeatureProperties): string {
  return (readString(properties, 'mode') ?? '').trim().toLowerCase();
}

export function getFerryPopupTitle(properties: FeatureProperties): string | null {
  const real = getTransportDisplayName(properties);
  if (real) return real;
  if (readMode(properties) === 'ferry') return 'Ferry landing';
  return null;
}

const ROUTE_TITLE_KEYS = ['public_name', 'route_code', 'headsign'] as const;

export function getTransportPopupTitle(
  properties: FeatureProperties,
  featureKind: TransportPopupFeatureKind,
): string {
  const real = getTransportDisplayName(properties);
  if (real) return real;

  if (readMode(properties) === 'ferry') return 'Ferry landing';

  if (featureKind === 'route') {
    for (const key of ROUTE_TITLE_KEYS) {
      const value = readString(properties, key);
      if (isRealTransportDisplayName(value)) return (value as string).trim();
    }
    return 'Transport route';
  }

  switch (featureKind) {
    case 'terminal':
      return 'Transport terminal';
    case 'stop':
      return 'Transport stop';
    default:
      return 'Transport feature';
  }
}

export function hasExplicitVehicleAccessInfo(properties: FeatureProperties): boolean {
  return VEHICLE_ACCESS_KEYS.some((key) => !isBlankTransportName(properties[key]));
}

export function getFerryVehicleAccessNote(properties: FeatureProperties): string {
  for (const key of VEHICLE_ACCESS_KEYS) {
    const value = readString(properties, key);
    if (isBlankTransportName(value)) continue;
    const normalized = (value as string).trim().toLowerCase();
    if (VEHICLE_ACCESS_YES.has(normalized)) return 'Vehicles can board';
    if (VEHICLE_ACCESS_NO.has(normalized)) return 'No vehicle access';
  }
  return FERRY_VEHICLE_ACCESS_UNKNOWN;
}

export function getTransportTerminalDisplayClass(
  properties: FeatureProperties,
): TransportTerminalDisplayClass {
  const mode = readMode(properties);
  const reviewStatus = (readString(properties, 'review_status') ?? '').trim().toLowerCase();
  const hasRealName = getTransportDisplayName(properties) !== null;
  const isImportedUnreviewed = reviewStatus === 'imported_unreviewed';

  if (mode === 'ferry') {
    if (!hasRealName && isImportedUnreviewed) return 'ferry_landing_candidate';
    if (hasRealName && isImportedUnreviewed) return 'named_ferry_landing_candidate';
  }

  if (MAJOR_TERMINAL_MODES.has(mode) && hasRealName) {
    return 'major_terminal_candidate';
  }

  return 'unreviewed_terminal_candidate';
}
