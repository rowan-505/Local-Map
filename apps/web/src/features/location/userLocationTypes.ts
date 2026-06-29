/**
 * Own-user location types for the public web map (client-side only).
 *
 * Scope: rendering and tracking the current user's own position. No API, no
 * Supabase, no persistence, no sharing. Sharing-specific fields (tokens, expiry,
 * session ids) are intentionally omitted; these types are kept simple so a future
 * sharing feature can build on top of `UserLocationFix` without reshaping it.
 */

/** Lifecycle of own-user location acquisition. */
export type UserLocationStatus =
  | 'idle'
  | 'requesting_permission'
  | 'tracking'
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'stopped';

/**
 * A single resolved position sample.
 *
 * Coordinates are WGS84 (SRID 4326). Note the GeoJSON/MapLibre convention is
 * `[lng, lat]`, while the browser Geolocation API reports `latitude`/`longitude`
 * — convert at the acquisition boundary.
 *
 * Keep this a plain, JSON-serializable record (primitives only — no Date, no class
 * instances). Future: an API publisher / sharing payload can consume `UserLocationFix`
 * directly without reshaping it.
 */
export type UserLocationFix = {
  readonly lat: number;
  readonly lng: number;
  /** Horizontal accuracy radius in meters (Geolocation `coords.accuracy`). */
  readonly accuracyM: number;
  /** Altitude in meters above the WGS84 ellipsoid, when available. */
  readonly altitudeM?: number;
  /** Heading in degrees clockwise from true north, when available. */
  readonly headingDeg?: number;
  /** Ground speed in meters per second, when available. */
  readonly speedMps?: number;
  /** Sample time in epoch milliseconds. */
  readonly timestamp: number;
};

/** Coarse quality bucket derived from a fix (e.g. from `accuracyM`). */
export type UserLocationQuality = 'good' | 'moderate' | 'low' | 'poor';

/** Full client-side state for own-user location. */
export type UserLocationState = {
  readonly status: UserLocationStatus;
  readonly fix: UserLocationFix | null;
  readonly errorMessage: string | null;
  /** Whether the map camera should follow the user's position. */
  readonly isFollowing: boolean;
  readonly quality: UserLocationQuality | null;
  /**
   * Whether the latest fix is within CoreMap's approximate coverage box.
   * `null` until a valid fix has been received. Coarse camera heuristic only —
   * not an authoritative boundary check.
   */
  readonly isInsideCoverage: boolean | null;
  /** True only when a valid fix exists and falls outside the coverage box. */
  readonly isOutOfCoverage: boolean;
};
