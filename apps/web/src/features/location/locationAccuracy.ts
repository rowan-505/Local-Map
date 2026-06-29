/**
 * Pure helpers for grading and using an own-user location fix.
 *
 * No browser or MapLibre dependency — safe to unit test and reuse anywhere.
 * Quality buckets and zoom levels are deliberately coarse; accuracy is in meters.
 */
import type { UserLocationQuality } from './userLocationTypes';

/** Minimal coordinate shape accepted by {@link shouldAcceptLocationFix}. */
export type LocationFixInput = {
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly accuracyM?: number | null;
};

const GOOD_MAX_M = 20;
const MODERATE_MAX_M = 50;
const LOW_MAX_M = 100;

/**
 * Bucket horizontal accuracy (meters) into a coarse quality grade.
 * Returns `null` when accuracy is missing or non-finite.
 */
export function getLocationQuality(
  accuracyM: number | null | undefined,
): UserLocationQuality | null {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return null;
  if (accuracyM <= GOOD_MAX_M) return 'good';
  if (accuracyM <= MODERATE_MAX_M) return 'moderate';
  if (accuracyM <= LOW_MAX_M) return 'low';
  return 'poor';
}

/**
 * Recommended map zoom for framing a fix. Tighter accuracy → closer zoom.
 * Unknown or non-finite accuracy falls back to the widest zoom (14).
 */
export function getRecommendedLocationZoom(
  accuracyM: number | null | undefined,
): number {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return 14;
  if (accuracyM <= 30) return 17;
  if (accuracyM <= 80) return 15;
  return 14;
}

/**
 * Whether a fix is safe to display. Rejects only structurally invalid
 * coordinates (non-finite or out of WGS84 range); poor accuracy is allowed
 * through so it can be shown and marked low/poor quality elsewhere.
 */
export function shouldAcceptLocationFix(input: LocationFixInput): boolean {
  const { lat, lng } = input;
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/** Above this implied speed a jump between consecutive fixes is treated as GPS error. */
const IMPOSSIBLE_SPEED_MPS = 80;
/**
 * If the browser's own speed reading is finite and at least this high, the device
 * corroborates genuine fast movement, so we do not reject the jump.
 */
const CORROBORATING_SPEED_MPS = 50;

const EARTH_RADIUS_M = 6_371_000;

/** Minimal fix shape needed for jump detection. */
type JumpFix = {
  readonly lat: number;
  readonly lng: number;
  /** Sample time in epoch milliseconds. */
  readonly timestamp: number;
  /** Browser-provided ground speed (m/s), when available. */
  readonly speedMps?: number | null;
};

/**
 * Conservative "teleport" guard: reject a new fix only when it implies an
 * impossible movement speed (> {@link IMPOSSIBLE_SPEED_MPS}) versus the previous
 * fix. This is a coarse sanity check — no map matching, road snapping, or routing.
 *
 * Returns `false` (accept) when there is no previous fix, when timing is unusable,
 * or when the device's own `speedMps` corroborates genuine fast travel.
 */
export function shouldRejectImpossibleJump(
  previousFix: JumpFix | null | undefined,
  nextFix: JumpFix,
): boolean {
  if (!previousFix) return false;
  if (!Number.isFinite(previousFix.timestamp) || !Number.isFinite(nextFix.timestamp)) {
    return false;
  }

  const dtSeconds = (nextFix.timestamp - previousFix.timestamp) / 1000;
  // Non-positive / zero elapsed time can't yield a meaningful speed — don't reject.
  if (!(dtSeconds > 0)) return false;

  // Device says we really are moving fast → trust it, don't reject aggressively.
  if (Number.isFinite(nextFix.speedMps) && (nextFix.speedMps as number) >= CORROBORATING_SPEED_MPS) {
    return false;
  }

  const distanceM = haversineMeters(previousFix, nextFix);
  if (!Number.isFinite(distanceM)) return false;

  const impliedSpeedMps = distanceM / dtSeconds;
  return impliedSpeedMps > IMPOSSIBLE_SPEED_MPS;
}

function haversineMeters(a: JumpFix, b: JumpFix): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
