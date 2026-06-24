/**
 * Safe user-facing display-name helpers for the Martin transport overlay.
 *
 * Many imported transport features (especially ferry terminals) only carry a generated OSM
 * fallback name like `ferry_terminal osm:N:5305226755` or `osm:W:123`. These are NOT real
 * names: they must never be shown as map labels or as user-facing popup titles. Raw generated
 * names may still appear in dev-only debug details (handled in `transportDebugPopup.ts`).
 *
 * Pure helpers only — no MapLibre, no API, no database access. Shared by the popup model and
 * (later) layer text-field/filter logic so the "what counts as a real name" rule lives once.
 */

type FeatureProperties = Record<string, unknown>;

/** Feature kinds that can produce a transport popup title. */
export type TransportPopupFeatureKind = 'stop' | 'terminal' | 'route' | 'infrastructure';

/** Terminal display class used to drive sizing/emphasis and review triage. */
export type TransportTerminalDisplayClass =
  | 'ferry_landing_candidate'
  | 'named_ferry_landing_candidate'
  | 'major_terminal_candidate'
  | 'unreviewed_terminal_candidate';

/** Substrings that mark a value as a generated OSM id fallback (anywhere in the string). */
const GENERATED_OSM_SUBSTRINGS = ['osm:N:', 'osm:W:', 'osm:R:'] as const;

/** Prefixes that mark a value as a generated `<kind> osm:` import fallback. */
const GENERATED_OSM_PREFIXES = [
  'ferry_terminal osm:',
  'bus_stop osm:',
  'station osm:',
  'terminal osm:',
  'stop osm:',
] as const;

/** Modes treated as "major" terminal modes (bus/train/air interchanges). */
const MAJOR_TERMINAL_MODES = new Set(['bus', 'local_bus', 'train', 'rail', 'air']);

/** Default ferry vehicle-access wording when nothing explicit proves boarding. */
export const FERRY_VEHICLE_ACCESS_UNKNOWN = 'Vehicle access unknown';

/**
 * Explicit vehicle-access keys that could prove a vehicle can board. `amenity=ferry_terminal`
 * is deliberately NOT here: a terminal tag alone never implies car/motorcycle support.
 */
const VEHICLE_ACCESS_KEYS = [
  'motor_vehicle',
  'motorcar',
  'motorcycle',
  'vehicle',
  'car',
  'car_ferry',
] as const;

/** Values that read as "allowed" / "not allowed" for an access tag. */
const VEHICLE_ACCESS_YES = new Set(['yes', 'designated', 'permissive', 'true', '1']);
const VEHICLE_ACCESS_NO = new Set(['no', 'none', 'false', '0']);

/** Candidate name keys, in display-preference order. */
const TRANSPORT_NAME_KEYS = ['name_mm', 'name_en', 'name'] as const;

/** Reads a property as a string, or `undefined` when absent (null/undefined). */
function readString(properties: FeatureProperties, key: string): string | undefined {
  const value = properties[key];
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? value : String(value);
}

/** True when a name is null, undefined, or empty after trimming. */
export function isBlankTransportName(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = typeof value === 'string' ? value : String(value);
  return text.trim() === '';
}

/**
 * True when a non-blank value is a generated OSM import fallback name, i.e. it contains an
 * `osm:N:`/`osm:W:`/`osm:R:` id token or starts with a known `<kind> osm:` import prefix.
 */
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

/** True only when a value is both non-blank and not a generated OSM fallback name. */
export function isRealTransportDisplayName(value: unknown): boolean {
  return !isBlankTransportName(value) && !isGeneratedOsmTransportName(value);
}

/**
 * Preferred real, user-facing display name (name_mm → name_en → name), trimmed.
 * Returns `null` when none of the candidates is a real display name (blank or generated OSM).
 */
export function getTransportDisplayName(properties: FeatureProperties): string | null {
  for (const key of TRANSPORT_NAME_KEYS) {
    const value = readString(properties, key);
    if (isRealTransportDisplayName(value)) {
      return (value as string).trim();
    }
  }
  return null;
}

/** Lowercased `mode` property, or empty string when absent. */
function readMode(properties: FeatureProperties): string {
  return (readString(properties, 'mode') ?? '').trim().toLowerCase();
}

/**
 * User-facing popup title for a (ferry) terminal:
 * - the real display name when one exists,
 * - else the generic "Ferry landing" when the feature is a ferry without a real name,
 * - else `null` (caller decides the non-ferry fallback).
 */
export function getFerryPopupTitle(properties: FeatureProperties): string | null {
  const real = getTransportDisplayName(properties);
  if (real) return real;
  if (readMode(properties) === 'ferry') return 'Ferry landing';
  return null;
}

/** Route fields that safely identify a route (never generated OSM fallbacks). */
const ROUTE_TITLE_KEYS = ['public_name', 'route_code', 'headsign'] as const;

/**
 * Safe, user-facing popup title for ANY transport feature. Guarantees a generated OSM fallback
 * name (e.g. `ferry_terminal osm:N:...`) is never used as a title:
 * - a real display name (name_mm → name_en → name) wins,
 * - else ferries read "Ferry landing",
 * - else routes prefer their public name / route code (also non-generated), then "Transport route",
 * - else a generic per-kind label ("Transport terminal/stop", else "Transport feature").
 */
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

/** True only when an explicit vehicle-access tag is present (amenity tags never count). */
export function hasExplicitVehicleAccessInfo(properties: FeatureProperties): boolean {
  return VEHICLE_ACCESS_KEYS.some((key) => !isBlankTransportName(properties[key]));
}

/**
 * Conservative ferry vehicle-access note. Defaults to "Vehicle access unknown" — including the
 * common case where the Martin tiles carry no vehicle fields at all — and only changes when an
 * explicit vehicle-access tag clearly says yes/no. Never infers car support from the ferry
 * terminal tag itself, and never produces car-specific wording/icons.
 */
export function getFerryVehicleAccessNote(properties: FeatureProperties): string {
  for (const key of VEHICLE_ACCESS_KEYS) {
    const value = readString(properties, key);
    if (isBlankTransportName(value)) continue;
    const normalized = (value as string).trim().toLowerCase();
    if (VEHICLE_ACCESS_YES.has(normalized)) return 'Vehicles can board';
    if (VEHICLE_ACCESS_NO.has(normalized)) return 'No vehicle access';
  }
  // Explicit-but-unrecognized values, or no vehicle tags at all → stay unknown.
  return FERRY_VEHICLE_ACCESS_UNKNOWN;
}

/**
 * Classifies a transport terminal for emphasis/triage:
 * - `ferry_landing_candidate`        — ferry, imported_unreviewed, no real name
 * - `named_ferry_landing_candidate`  — ferry, has a real name, still imported_unreviewed
 * - `major_terminal_candidate`       — bus/train/air with a real name
 * - `unreviewed_terminal_candidate`  — everything else
 */
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
