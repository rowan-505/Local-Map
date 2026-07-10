/**
 * Location debug helpers for the own-user location precision flow.
 *
 * Console logging (`isLocationDebugEnabled`) runs in local dev OR when explicitly
 * opted in via URL / runtime toggle — see `isLocationDebugEnabled()`.
 *
 * The on-screen overlay (`isLocationDebugOverlayEnabled`) is hidden by default and
 * requires explicit opt-in (`?debugLocation=1`, runtime toggle). `import.meta.env.DEV`
 * alone never shows the overlay.
 *
 * Safety:
 * - Console logs render no UI and persist nothing (no localStorage/sessionStorage).
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
import { detectLocationBrowserEnvironment } from './locationBrowserEnvironment';

/**
 * Opt-in to include exact lat/lng in dev logs. KEEP FALSE in committed code.
 * Coordinates are stripped unless this is true AND the build is dev.
 */
export const LOCAL_DEBUG_LOCATION_COORDS = false;

export type LocationDebugEvent =
  | 'debug_enabled'
  | 'geolocation_options'
  | 'button_click'
  | 'start_tracking'
  | 'acquisition_started'
  | 'permission_state'
  | 'permission_preblocked'
  | 'permission_denied_help'
  | 'watch_success'
  | 'watch_error'
  | 'fix_received'
  | 'fix_rejected'
  | 'fix_rejected_stale'
  | 'fix_rejected_impossible_jump'
  | 'fix_accepted'
  | 'fix_accepted_reliable'
  | 'fix_accepted_approximate'
  | 'last_reliable_fix_updated'
  | 'quality_changed'
  | 'best_fix_improved'
  | 'precision_ready'
  | 'warmup_started'
  | 'warmup_ended'
  | 'warmup_ended_best_still_low'
  | 'acquisition_ended_best_still_low'
  | 'camera_delayed_low_accuracy'
  | 'camera_skipped_low_accuracy'
  | 'camera_center_user'
  | 'camera_center_user_manual_low_accuracy'
  | 'camera_fallback_yangon'
  | 'follow_enabled'
  | 'follow_disabled'
  | 'toast_generated'
  | 'toast_skipped'
  | 'toast_dismissed'
  | 'stop_tracking'
  | 'mobile_permission_audit'
  | 'browser_environment'
  | 'secure_context_check'
  | 'geolocation_api_available'
  | 'permission_state_before_watch'
  | 'watch_created'
  | 'watch_error_raw'
  | 'permissions_policy_check';

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
  /** Coarse browser/environment category (UA-derived; no fingerprinting). */
  browserCategory?: string;
  /** Alias for browserCategory in permission audit logs. */
  userAgentCategory?: string;
  /** True when the page is likely running inside an in-app browser/webview. */
  isLikelyInAppBrowser?: boolean;
  isLikelyAndroidChrome?: boolean;
  isLikelyIOS?: boolean;
  hasNavigatorGeolocation?: boolean;
  permissionsPolicyAllowsGeolocation?: boolean | null;
  errorCode?: number;
  errorMessage?: string | null;
  origin?: string | null;
  /** Actionable guidance for permission-denied debugging (no coordinates). */
  resetHint?: string;
  browserHint?: string;
  androidHint?: string;
  inAppBrowserHint?: string;
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

declare global {
  interface Window {
    /** Runtime location-debug toggle (set by URL flag or `enableLocationDebug()`). */
    __coremapDebugLocation?: boolean;
    /** Console escape hatch to turn detailed location logs on for this session. */
    enableLocationDebug?: () => void;
    disableLocationDebug?: () => void;
  }
}

/** Parse a URL fragment (search or hash) for the `debugLocation` opt-in. */
function fragmentHasFlag(fragment: string | undefined | null): boolean {
  if (!fragment) return false;
  // Accept both `?debugLocation=1` and hash-router forms like `#/path?debugLocation=1`.
  const query = fragment.includes('?')
    ? fragment.slice(fragment.indexOf('?') + 1)
    : fragment.replace(/^#/, '');
  try {
    const value = new URLSearchParams(query).get('debugLocation');
    // Present (even bare `?debugLocation`) or truthy value enables it.
    return value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch {
    return false;
  }
}

/** Whether the current URL (search or hash) opts into location debug logging. */
function hasUrlDebugFlag(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return fragmentHasFlag(window.location.search) || fragmentHasFlag(window.location.hash);
}

function latchUrlDebugFlag(): boolean {
  if (!hasUrlDebugFlag()) return false;
  if (typeof window !== 'undefined') window.__coremapDebugLocation = true;
  return true;
}

/**
 * True when location debug logging should run:
 *   - local dev (`import.meta.env.DEV`), OR
 *   - the deployed URL opts in via `?debugLocation=1` (or `=true`/bare flag), OR
 *   - a runtime toggle set via `window.enableLocationDebug()` (console escape hatch).
 *
 * Re-evaluated on every call (not cached) so it works even if the bundle loaded
 * before the URL was final, on hash routes, or when toggled at runtime. Console
 * only; nothing is persisted and no debug UI is shown.
 */
export function isLocationDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window !== 'undefined' && window.__coremapDebugLocation === true) return true;
  return latchUrlDebugFlag();
}

/**
 * True when the on-screen location debug overlay should render.
 * Explicit opt-in only — never enabled by `import.meta.env.DEV` alone.
 *
 *   - `?debugLocation=1` (or `=true`/bare flag) on the page URL, OR
 *   - `window.enableLocationDebug()` / latched `window.__coremapDebugLocation`.
 */
export function isLocationDebugOverlayEnabled(): boolean {
  if (typeof window !== 'undefined' && window.__coremapDebugLocation === true) return true;
  return latchUrlDebugFlag();
}

// Expose a console escape hatch so real deployed devices can enable logs without a
// rebuild or even a reload: open DevTools and run `enableLocationDebug()`.
if (typeof window !== 'undefined') {
  window.enableLocationDebug = () => {
    window.__coremapDebugLocation = true;
    bannerLogged = false;
    logLocationDebugBanner();
  };
  window.disableLocationDebug = () => {
    window.__coremapDebugLocation = false;
  };
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
  const env = detectLocationBrowserEnvironment();
  emit('debug_enabled', {
    dev: import.meta.env.DEV,
    urlFlag: hasUrlDebugFlag(),
    isSecureContext: env.isSecureContext,
    hasNavigatorGeolocation: env.hasNavigatorGeolocation,
  });
  emit('browser_environment', {
    userAgentCategory: env.userAgentCategory,
    isLikelyInAppBrowser: env.isLikelyInAppBrowser,
    isSecureContext: env.isSecureContext,
    hasNavigatorGeolocation: env.hasNavigatorGeolocation,
    isLikelyAndroidChrome: env.isAndroid && env.isLikelyChrome && !env.isLikelyInAppBrowser,
    isLikelyIOS: env.isIOS,
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
