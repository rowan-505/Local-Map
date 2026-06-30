/**
 * Console-only debug helper for the own-user location precision flow.
 *
 * Logs when EITHER:
 *   - `import.meta.env.DEV` is true (local dev), OR
 *   - the page URL carries `?debugLocation=1` or `?debugLocation=true` — this lets
 *     us debug REAL devices on the deployed HTTPS domain without a dev build.
 *
 * Safety:
 * - Console only; renders no UI and persists nothing (no localStorage/sessionStorage).
 * - Never logs exact coordinates by default. A local-only opt-in
 *   (`LOCAL_DEBUG_LOCATION_COORDS`) exists for hands-on debugging; it MUST stay
 *   `false` in committed code.
 * - No private user identifiers are logged — only coarse accuracy/quality/coverage.
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
  | 'debug_enabled'
  | 'button_click'
  | 'start_tracking'
  | 'permission_state'
  | 'permission_preblocked'
  | 'permission_denied_help'
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
  /** Actionable guidance for permission-denied debugging (no coordinates). */
  resetHint?: string;
  browserHint?: string;
  isSecureContext?: boolean | null;
  watchIdExists?: boolean;
  cameraAction?: string;
  tone?: string;
  /** Debug-mode banner fields. */
  dev?: boolean;
  urlFlag?: boolean;
  /** Only emitted when LOCAL_DEBUG_LOCATION_COORDS is true (dev-only). */
  lat?: number;
  lng?: number;
};

/** Whether the URL carries `?debugLocation=1` or `?debugLocation=true`. Read once. */
function hasUrlDebugFlag(): boolean {
  if (typeof window === 'undefined' || !window.location?.search) return false;
  try {
    const value = new URLSearchParams(window.location.search).get('debugLocation');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

// Computed once per page load; the URL flag does not change mid-session for our SPA.
const URL_DEBUG_FLAG = hasUrlDebugFlag();

/**
 * True when location debug logging should run: in local dev OR when the deployed
 * URL opts in via `?debugLocation=1` / `?debugLocation=true`. Console-only; nothing
 * is persisted, and no debug UI is shown.
 */
export function isLocationDebugEnabled(): boolean {
  return import.meta.env.DEV || URL_DEBUG_FLAG;
}

let bannerLogged = false;

function emit(event: LocationDebugEvent, meta: LocationDebugMeta): void {
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

/** One-time banner confirming debug is active and why (dev vs URL flag). */
export function logLocationDebugBanner(): void {
  if (!isLocationDebugEnabled() || bannerLogged) return;
  bannerLogged = true;
  emit('debug_enabled', {
    dev: import.meta.env.DEV,
    urlFlag: URL_DEBUG_FLAG,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
  });
}

/** Log a single, readable location event to the console when debug is enabled. */
export function logLocationEvent(event: LocationDebugEvent, meta: LocationDebugMeta = {}): void {
  if (!isLocationDebugEnabled()) return;
  // Ensure the "why is this logging" banner precedes the first real event.
  logLocationDebugBanner();
  emit(event, meta);
}

/** Round accuracy/age to whole meters/ms for compact logs (null-safe). */
export function roundOrNull(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value);
}
