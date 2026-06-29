/**
 * Console-only debug helper for the own-user location precision flow.
 *
 * - Logs ONLY when `import.meta.env.DEV` is true (compiled away in production).
 * - Never logs exact coordinates by default. A local-only opt-in
 *   (`LOCAL_DEBUG_LOCATION_COORDS`) exists for hands-on debugging; it MUST stay
 *   `false` in committed code and is additionally ignored outside dev.
 * - Renders no UI. Client-side only: no API, no storage, no sharing.
 *
 * Usage:
 *   logLocationEvent('watch_success', { accuracyM: 95, quality: 'low', isInsideCoverage: true });
 *   → [location] watch_success { accuracyM: 95, quality: 'low', isInsideCoverage: true }
 */
import type { UserLocationQuality, UserLocationStatus } from './userLocationTypes';

/**
 * Opt-in to include exact lat/lng in dev logs. KEEP FALSE in committed code.
 * Coordinates are stripped unless this is true AND the build is dev.
 */
export const LOCAL_DEBUG_LOCATION_COORDS = false;

export type LocationDebugEvent =
  | 'button_click'
  | 'start_tracking'
  | 'permission_state'
  | 'watch_success'
  | 'watch_error'
  | 'fix_received'
  | 'fix_rejected'
  | 'fix_accepted'
  | 'quality_changed'
  | 'best_fix_improved'
  | 'precision_ready'
  | 'warmup_started'
  | 'warmup_ended'
  | 'warmup_ended_best_still_low'
  | 'camera_delayed_low_accuracy'
  | 'camera_center_user'
  | 'camera_fallback_yangon'
  | 'follow_enabled'
  | 'follow_disabled'
  | 'toast_generated'
  | 'toast_skipped'
  | 'toast_dismissed'
  | 'stop_tracking';

/** Safe, coordinate-free metadata fields. Exact lat/lng are stripped by default. */
export type LocationDebugMeta = {
  status?: UserLocationStatus;
  accuracyM?: number | null;
  quality?: UserLocationQuality | null;
  speedMps?: number | null;
  headingAvailable?: boolean;
  ageMs?: number | null;
  isInsideCoverage?: boolean | null;
  isOutOfCoverage?: boolean;
  isWarmingUp?: boolean;
  bestAccuracyM?: number | null;
  previousAccuracyM?: number | null;
  precisionWaitElapsedMs?: number | null;
  reason?: string;
  permissionState?: string;
  isSecureContext?: boolean | null;
  watchIdExists?: boolean;
  cameraAction?: string;
  tone?: string;
  /** Only emitted when LOCAL_DEBUG_LOCATION_COORDS is true (dev-only). */
  lat?: number;
  lng?: number;
};

/** Log a single, readable location event to the console in development only. */
export function logLocationEvent(event: LocationDebugEvent, meta: LocationDebugMeta = {}): void {
  if (!import.meta.env.DEV) return;
  const safe: LocationDebugMeta = { ...meta };
  if (!LOCAL_DEBUG_LOCATION_COORDS) {
    delete safe.lat;
    delete safe.lng;
  }
  // Use console.log (Info level) so logs are visible by default. `console.debug`
  // maps to the "Verbose" level, which Chrome DevTools hides unless explicitly
  // enabled. Styled prefix makes the [location] stream easy to spot/filter.
  console.log(`%c[location]%c ${event}`, 'color:#0284c7;font-weight:600', 'color:inherit', safe);
}

/** Round accuracy/age to whole meters/ms for compact logs (null-safe). */
export function roundOrNull(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value);
}
