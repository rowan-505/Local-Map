/**
 * Own-user geolocation tracking via `navigator.geolocation.watchPosition`.
 *
 * Client-side only: nothing is sent to an API, persisted, or shared, and exact
 * coordinates are never logged in production. Permission is requested only when
 * `startTracking()` is called — never on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  distanceMeters,
  getLocationQuality,
  shouldAcceptLocationFix,
  shouldRejectImpossibleJump,
} from './locationAccuracy';
import { detectLocationBrowserEnvironment } from './locationBrowserEnv';
import { isInsideMyanmarApprox } from './locationCoverage';
import { isLocationDebugEnabled, logLocationEvent, roundOrNull } from './locationDebug';
import type {
  UserLocationFix,
  UserLocationQuality,
  UserLocationState,
  UserLocationStatus,
} from './userLocationTypes';

/**
 * Strongest practical geolocation options for initial acquisition + warm-up:
 * - enableHighAccuracy: true  → use GPS/GNSS, not just coarse Wi-Fi/cell.
 * - timeout: 30000            → give a cold GPS chip time to lock satellites.
 * - maximumAge: 0             → never accept a cached fix; always a fresh sample,
 *                               so a stale low-accuracy estimate is never trusted.
 *
 * A single long-lived watcher is used for the whole session (no per-render or
 * per-fix recreation), which keeps the code simple and avoids duplicate watchers.
 */
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 30000,
  maximumAge: 0,
};

/**
 * Freshness guard. With `maximumAge: 0` the browser should not hand back a cached
 * sample, but if a device reports a timestamp older than this we reject it as stale
 * so it is never displayed, centered, or treated as precise.
 */
const STALE_FIX_MAX_AGE_MS = 10000;

/**
 * GPS precision-acquisition window: keep collecting fixes (and improving the dot)
 * before committing to a close camera. 30s gives a cold GPS chip time to move from
 * a coarse cell/Wi-Fi estimate (e.g. ±98m) to a real satellite fix.
 */
const WARM_UP_MS = 30000;

/** A fix at/under this accuracy (m) is treated as reliable/precise (follow/zoom). */
const PRECISION_READY_ACCURACY_M = 50;
/** A fix at/under this accuracy (m) is high precision. */
const HIGH_PRECISION_ACCURACY_M = 20;

/** EMA weight for smoothing the displayed dot between nearby reliable fixes. */
const RELIABLE_SMOOTHING_ALPHA = 0.5;
/**
 * Only smooth jitter: if two consecutive reliable fixes are farther apart than this
 * (genuine movement), snap to the raw position instead of lagging behind it.
 */
const RELIABLE_SMOOTHING_MAX_JUMP_M = 30;

const INITIAL_STATE: UserLocationState = {
  status: 'idle',
  fix: null,
  errorMessage: null,
  isFollowing: false,
  quality: null,
  isInsideCoverage: null,
  isOutOfCoverage: false,
  isWarmingUp: false,
  bestFix: null,
  lastReliableFix: null,
  isAwaitingFreshFix: false,
};

export type UseUserLocationResult = UserLocationState & {
  /** Bumped each time a recenter-on-user is requested (follow enable / recenter). */
  readonly recenterRequested: number;
  /** True only when a valid inside-coverage fix is accurate enough (<=50m) to trust. */
  readonly isPrecisionReady: boolean;
  /** True only when accuracy is high (<=20m) inside coverage. */
  readonly isHighPrecision: boolean;
  /** True when a valid fix exists but accuracy is still weak (>50m). */
  readonly isLowPrecision: boolean;
  /** Best (lowest) accuracy seen this session, in meters. */
  readonly bestAccuracyM: number | null;
  /** Elapsed time (ms) since warm-up started, or null when not tracking. */
  readonly precisionWaitElapsedMs: number | null;
  startTracking: () => void;
  stopTracking: () => void;
  enableFollowing: () => void;
  disableFollowing: () => void;
  requestRecenter: () => void;
};

export function useUserLocation(): UseUserLocationResult {
  const [state, setState] = useState<UserLocationState>(INITIAL_STATE);
  const [recenterRequested, setRecenterRequested] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  /** Last accepted fix, used to reject impossible jumps. Reset per tracking session. */
  const lastFixRef = useRef<UserLocationFix | null>(null);
  /** Best (lowest-accuracy) fix seen this session, for warm-up decisions. */
  const bestFixRef = useRef<UserLocationFix | null>(null);
  /** Last raw reliable (<=50m) fix — anchors the dot so low fixes can't move it. */
  const lastReliableFixRef = useRef<UserLocationFix | null>(null);
  /** Last DISPLAYED reliable fix (lightly smoothed), used as the EMA baseline. */
  const lastReliableDisplayRef = useRef<UserLocationFix | null>(null);
  const warmUpTimerRef = useRef<number | null>(null);
  /** Epoch ms when the current warm-up window started (null when not tracking). */
  const warmupStartedAtRef = useRef<number | null>(null);
  /** Whether we've already logged `precision_ready` this session. */
  const precisionReadyLoggedRef = useRef(false);
  /** Last logged quality bucket, to emit `quality_changed` only on transitions. */
  const lastQualityRef = useRef<UserLocationQuality | null>(null);

  const clearWarmUpTimer = useCallback(() => {
    if (warmUpTimerRef.current != null) {
      window.clearTimeout(warmUpTimerRef.current);
      warmUpTimerRef.current = null;
    }
  }, []);

  const clearWatch = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const startTracking = useCallback(() => {
    const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : null;
    logLocationEvent('start_tracking', {
      isSecureContext,
      watchIdExists: watchIdRef.current != null,
    });

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      logLocationEvent('watch_error', { reason: 'geolocation_unsupported', status: 'unsupported' });
      setState((prev) => ({
        ...prev,
        status: 'unsupported',
        errorMessage: 'Location is not supported on this device.',
      }));
      return;
    }

    // Geolocation only works in a secure context (HTTPS or localhost). On insecure
    // origins (e.g. a LAN IP over HTTP) the browser refuses WITHOUT prompting, so we
    // surface a clear, actionable message instead of a silent Yangon fallback.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      logLocationEvent('watch_error', { reason: 'insecure_context', isSecureContext: false, status: 'unsupported' });
      setState((prev) => ({
        ...prev,
        status: 'unsupported',
        errorMessage: 'Location requires HTTPS or localhost',
      }));
      return;
    }

    if (isLocationDebugEnabled() && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((result) => {
          // prompt / granted / denied — read before the watch resolves.
          logLocationEvent('permission_state', { permissionState: result.state });
          if (result.state === 'denied') {
            // We still start the watch (unchanged behavior); the browser will fire
            // PERMISSION_DENIED. This makes the pre-blocked state explicit in logs.
            logLocationEvent('permission_preblocked', {
              permissionState: 'denied',
              reason: 'permission_denied_before_watch',
            });
          }
        })
        .catch(() => {
          /* permissions query unsupported — ignore */
        });
    }

    // Always (re)start from a clean watch. A prior watch id lingers even after an
    // error (denied/timeout/unavailable), so without this an error→re-click would
    // no-op and never re-request permission.
    clearWatch();
    clearWarmUpTimer();
    lastFixRef.current = null;
    bestFixRef.current = null;
    lastReliableFixRef.current = null;
    lastReliableDisplayRef.current = null;
    lastQualityRef.current = null;
    precisionReadyLoggedRef.current = false;
    warmupStartedAtRef.current = Date.now();

    // Begin the precision-acquisition window: collect fixes and improve the dot, but
    // the camera will not commit to a close zoom on an early low-accuracy fix yet.
    logLocationEvent('geolocation_options', {
      reason: 'enableHighAccuracy=true,maximumAge=0,timeout=30000',
    });
    logLocationEvent('acquisition_started', { reason: `${WARM_UP_MS}ms`, isWarmingUp: true });
    warmUpTimerRef.current = window.setTimeout(() => {
      warmUpTimerRef.current = null;
      const bestAccuracyM = roundOrNull(bestFixRef.current?.accuracyM);
      // Distinguish "acquisition finished with a good fix" from "still weak" so logs
      // make clear whether the device GPS simply never improved.
      if (bestAccuracyM != null && bestAccuracyM > PRECISION_READY_ACCURACY_M) {
        logLocationEvent('acquisition_ended_best_still_low', { bestAccuracyM, isWarmingUp: false });
      } else {
        logLocationEvent('warmup_ended', { bestAccuracyM, isWarmingUp: false });
      }
      setState((prev) => ({ ...prev, isWarmingUp: false }));
    }, WARM_UP_MS);

    setState((prev) => ({
      ...prev,
      status: 'requesting_permission',
      errorMessage: null,
      isWarmingUp: true,
      bestFix: null,
      lastReliableFix: null,
      isAwaitingFreshFix: false,
    }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toUserLocationFix(position);
        const quality = getLocationQuality(fix.accuracyM);
        const accuracyM = roundOrNull(fix.accuracyM);
        const ageMs = roundOrNull(Date.now() - fix.timestamp);
        const warmingUp = warmUpTimerRef.current != null;

        // Raw browser callback — distinguishes "device GPS is weak" from app logic.
        logLocationEvent('watch_success', {
          accuracyM,
          quality,
          speedMps: fix.speedMps ?? null,
          headingAvailable: fix.headingDeg != null && Number.isFinite(fix.headingDeg),
          ageMs,
          isWarmingUp: warmingUp,
        });

        if (!shouldAcceptLocationFix(fix)) {
          logLocationEvent('fix_rejected', { reason: 'out_of_range', accuracyM, quality });
          return;
        }
        // Stale samples are never displayed, centered, or treated as precise.
        if (ageMs != null && ageMs > STALE_FIX_MAX_AGE_MS) {
          logLocationEvent('fix_rejected_stale', { accuracyM, quality, ageMs });
          setState((prev) => ({ ...prev, isAwaitingFreshFix: true }));
          return;
        }
        // Drop physically impossible jumps (likely GPS error), keeping the last
        // good fix. Conservative: corroborated high speed is not rejected.
        if (shouldRejectImpossibleJump(lastFixRef.current, fix)) {
          logLocationEvent('fix_rejected_impossible_jump', {
            accuracyM,
            quality,
            previousAccuracyM: roundOrNull(lastFixRef.current?.accuracyM),
          });
          return;
        }

        // Future: an API publisher can consume this UserLocationFix here (V2 stays
        // client-side only — no network, no persistence, no sharing).
        const insideCoverage = isInsideMyanmarApprox(fix.lat, fix.lng);
        const reliable = fix.accuracyM <= PRECISION_READY_ACCURACY_M;

        // Track the best (lowest-accuracy) fix of the session.
        const prevBest = bestFixRef.current;
        const isBetter = !prevBest || fix.accuracyM < prevBest.accuracyM;
        if (isBetter) {
          logLocationEvent('best_fix_improved', {
            previousAccuracyM: roundOrNull(prevBest?.accuracyM),
            bestAccuracyM: accuracyM,
          });
          bestFixRef.current = fix;
        }

        // Emit a quality transition only when the bucket actually changes.
        if (lastQualityRef.current !== quality) {
          logLocationEvent('quality_changed', {
            quality,
            accuracyM,
            reason: `from_${lastQualityRef.current ?? 'none'}`,
          });
          lastQualityRef.current = quality;
        }

        if (reliable) {
          // Reliable (<=50m): this is the trusted dot. Light EMA smoothing removes
          // jitter between nearby reliable fixes; the accuracy circle stays raw.
          lastFixRef.current = fix;
          const displayFix = smoothReliableDisplay(lastReliableDisplayRef.current, fix);
          lastReliableDisplayRef.current = displayFix;
          lastReliableFixRef.current = fix;

          logLocationEvent('fix_accepted_reliable', {
            accuracyM,
            quality,
            isInsideCoverage: insideCoverage,
            isOutOfCoverage: !insideCoverage,
          });
          logLocationEvent('last_reliable_fix_updated', { accuracyM });

          if (insideCoverage && !precisionReadyLoggedRef.current) {
            precisionReadyLoggedRef.current = true;
            logLocationEvent('precision_ready', {
              accuracyM,
              quality,
              precisionWaitElapsedMs:
                warmupStartedAtRef.current != null
                  ? roundOrNull(Date.now() - warmupStartedAtRef.current)
                  : null,
            });
          }

          setState((prev) => ({
            ...prev,
            status: 'tracking',
            fix: displayFix,
            errorMessage: null,
            quality,
            isInsideCoverage: insideCoverage,
            isOutOfCoverage: !insideCoverage,
            bestFix: bestFixRef.current,
            lastReliableFix: fix,
            isAwaitingFreshFix: false,
          }));
          return;
        }

        // Approximate (>50m): display-only. Never auto-followed as precise.
        logLocationEvent('fix_accepted_approximate', {
          accuracyM,
          quality,
          isInsideCoverage: insideCoverage,
          isOutOfCoverage: !insideCoverage,
        });

        if (lastReliableFixRef.current) {
          // We already have a trusted dot — do NOT move it to this far/low fix.
          // Keep the reliable position/quality; only clear the stale flag + best.
          setState((prev) => ({
            ...prev,
            status: 'tracking',
            bestFix: bestFixRef.current,
            isAwaitingFreshFix: false,
          }));
          return;
        }

        // No reliable fix yet → show the approximate fix as display-only (dot + large
        // accuracy circle). The camera will not aggressively center on it.
        lastFixRef.current = fix;
        setState((prev) => ({
          ...prev,
          status: 'tracking',
          fix,
          errorMessage: null,
          quality,
          isInsideCoverage: insideCoverage,
          isOutOfCoverage: !insideCoverage,
          bestFix: bestFixRef.current,
          lastReliableFix: null,
          isAwaitingFreshFix: false,
        }));
      },
      (error) => {
        const status = statusForGeolocationError(error);
        logLocationEvent('watch_error', { reason: `code_${error.code}`, status });
        if (error.code === error.PERMISSION_DENIED) {
          // Actionable, environment-aware guidance so a tester can tell apart:
          // site permission vs OS permission vs Android precise-off vs in-app browser.
          const env = detectLocationBrowserEnvironment();
          const logHelp = (permissionState?: string) => {
            logLocationEvent('permission_denied_help', {
              status,
              reason: 'browser_permission_denied',
              permissionState,
              isSecureContext: env.isSecureContext,
              browserCategory: env.category,
              isLikelyInAppBrowser: env.isLikelyInAppBrowser,
              resetHint:
                'Open site settings for map.coremapmm.com and set Location to Allow, then reload.',
              androidHint:
                'Android Settings → Apps → Chrome → Permissions → Location → Allow. Turn Precise location ON if available.',
              inAppBrowserHint:
                'Open the site in real Chrome/Safari, not Telegram/Facebook in-app browser.',
              browserHint:
                'Chrome blocks repeated dismissed prompts until reset in Page Info / Site Settings.',
            });
          };
          // Best-effort: include the Permissions API state when available.
          if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
            navigator.permissions
              .query({ name: 'geolocation' as PermissionName })
              .then((result) => logHelp(result.state))
              .catch(() => logHelp());
          } else {
            logHelp('unsupported');
          }
        }
        clearWarmUpTimer();
        setState((prev) => ({
          ...prev,
          status,
          errorMessage: messageForGeolocationError(error),
          isFollowing: false,
          isWarmingUp: false,
        }));
      },
      WATCH_OPTIONS,
    );
  }, [clearWatch, clearWarmUpTimer]);

  const stopTracking = useCallback(() => {
    logLocationEvent('stop_tracking', { watchIdExists: watchIdRef.current != null });
    clearWatch();
    clearWarmUpTimer();
    warmupStartedAtRef.current = null;
    lastReliableFixRef.current = null;
    lastReliableDisplayRef.current = null;
    setState((prev) => ({
      ...prev,
      status: 'stopped',
      isFollowing: false,
      isWarmingUp: false,
      isAwaitingFreshFix: false,
    }));
  }, [clearWatch, clearWarmUpTimer]);

  const enableFollowing = useCallback(() => {
    setState((prev) => ({ ...prev, isFollowing: true }));
    setRecenterRequested((n) => n + 1);
  }, []);

  const disableFollowing = useCallback(() => {
    setState((prev) => ({ ...prev, isFollowing: false }));
  }, []);

  const requestRecenter = useCallback(() => {
    setRecenterRequested((n) => n + 1);
  }, []);

  useEffect(() => {
    return () => {
      clearWatch();
      clearWarmUpTimer();
    };
  }, [clearWatch, clearWarmUpTimer]);

  // Derived precision readiness (frontend-only; no faking — purely reflects the
  // browser's reported accuracy). Inside-coverage gating mirrors the camera policy.
  const fixAccuracyM = state.fix?.accuracyM ?? null;
  const insideCoverage = state.isInsideCoverage === true;
  const isHighPrecision =
    insideCoverage && fixAccuracyM != null && fixAccuracyM <= HIGH_PRECISION_ACCURACY_M;
  const isPrecisionReady =
    insideCoverage && fixAccuracyM != null && fixAccuracyM <= PRECISION_READY_ACCURACY_M;
  const isLowPrecision = fixAccuracyM != null && fixAccuracyM > PRECISION_READY_ACCURACY_M;
  const bestAccuracyM = state.bestFix?.accuracyM ?? null;
  const precisionWaitElapsedMs =
    warmupStartedAtRef.current != null ? Date.now() - warmupStartedAtRef.current : null;

  return {
    ...state,
    recenterRequested,
    isPrecisionReady,
    isHighPrecision,
    isLowPrecision,
    bestAccuracyM,
    precisionWaitElapsedMs,
    startTracking,
    stopTracking,
    enableFollowing,
    disableFollowing,
    requestRecenter,
  };
}

/**
 * Light jitter smoothing for the DISPLAYED reliable dot. Returns the raw fix when
 * there's no baseline or when the move is large (genuine travel → no lag). Only the
 * position is eased; accuracy/heading/speed/timestamp stay raw so the accuracy circle
 * reflects the true browser accuracy. Never used for low/poor (>50m) fixes.
 */
function smoothReliableDisplay(
  previousDisplay: UserLocationFix | null,
  raw: UserLocationFix,
): UserLocationFix {
  if (!previousDisplay) return raw;
  const moved = distanceMeters(previousDisplay, raw);
  if (!Number.isFinite(moved) || moved > RELIABLE_SMOOTHING_MAX_JUMP_M) return raw;
  const a = RELIABLE_SMOOTHING_ALPHA;
  return {
    ...raw,
    lat: previousDisplay.lat + a * (raw.lat - previousDisplay.lat),
    lng: previousDisplay.lng + a * (raw.lng - previousDisplay.lng),
  };
}

/** Browser `GeolocationPosition` → our `[lng, lat]`-friendly fix shape. */
function toUserLocationFix(position: GeolocationPosition): UserLocationFix {
  const { coords, timestamp } = position;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM: coords.accuracy,
    altitudeM: coords.altitude ?? undefined,
    headingDeg: coords.heading ?? undefined,
    speedMps: coords.speed ?? undefined,
    timestamp,
  };
}

function statusForGeolocationError(error: GeolocationPositionError): UserLocationStatus {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'permission_denied';
    case error.POSITION_UNAVAILABLE:
      return 'unavailable';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

function messageForGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was denied.';
    case error.POSITION_UNAVAILABLE:
      return 'Your location is currently unavailable.';
    case error.TIMEOUT:
      return 'Timed out while finding your location.';
    default:
      return 'Could not determine your location.';
  }
}
