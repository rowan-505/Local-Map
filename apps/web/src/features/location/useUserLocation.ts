/**
 * Own-user geolocation tracking via `navigator.geolocation.watchPosition`.
 *
 * Client-side only: nothing is sent to an API, persisted, or shared, and exact
 * coordinates are never logged in production. Permission is requested only when
 * `startTracking()` is called — never on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLocationQuality,
  shouldAcceptLocationFix,
  shouldRejectImpossibleJump,
} from './locationAccuracy';
import { isInsideMyanmarApprox } from './locationCoverage';
import type {
  UserLocationFix,
  UserLocationState,
  UserLocationStatus,
} from './userLocationTypes';

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 3000,
};

/** GPS warm-up window: keep improving the fix before committing to a close camera. */
const WARM_UP_MS = 8000;

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
};

export type UseUserLocationResult = UserLocationState & {
  /** Bumped each time a recenter-on-user is requested (follow enable / recenter). */
  readonly recenterRequested: number;
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
  const warmUpTimerRef = useRef<number | null>(null);

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
    if (import.meta.env.DEV) {
      console.debug('[location] startTracking called', {
        secureContext: typeof window !== 'undefined' ? window.isSecureContext : undefined,
      });
    }

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
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
      if (import.meta.env.DEV) {
        console.debug('[location] insecure context — geolocation blocked by browser');
      }
      setState((prev) => ({
        ...prev,
        status: 'unsupported',
        errorMessage: 'Location requires HTTPS or localhost',
      }));
      return;
    }

    if (import.meta.env.DEV && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((result) => {
          console.debug('[location] geolocation permission state:', result.state);
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

    // Enter GPS warm-up: accept fixes and show the dot, but the camera will avoid
    // committing to a close zoom on an early low-accuracy fix until this ends.
    if (import.meta.env.DEV) {
      console.debug('[location] warm-up started', { warmUpMs: WARM_UP_MS });
    }
    warmUpTimerRef.current = window.setTimeout(() => {
      warmUpTimerRef.current = null;
      if (import.meta.env.DEV) {
        console.debug('[location] warm-up ended', {
          bestAccuracyM: bestFixRef.current ? Math.round(bestFixRef.current.accuracyM) : null,
        });
      }
      setState((prev) => ({ ...prev, isWarmingUp: false }));
    }, WARM_UP_MS);

    setState((prev) => ({
      ...prev,
      status: 'requesting_permission',
      errorMessage: null,
      isWarmingUp: true,
      bestFix: null,
    }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toUserLocationFix(position);
        if (!shouldAcceptLocationFix(fix)) {
          if (import.meta.env.DEV) {
            console.warn('[location] ignoring out-of-range geolocation sample');
          }
          return;
        }
        // Drop physically impossible jumps (likely GPS error), keeping the last
        // good fix. Conservative: corroborated high speed is not rejected.
        if (shouldRejectImpossibleJump(lastFixRef.current, fix)) {
          if (import.meta.env.DEV) {
            console.warn('[location] ignoring implausible geolocation jump');
          }
          return;
        }
        lastFixRef.current = fix;
        // Future: an API publisher can consume this UserLocationFix here (V2 stays
        // client-side only — no network, no persistence, no sharing).
        // Outside-coverage fixes are kept as-is (real fix/accuracy/etc.); the
        // camera decides whether to fly to the user or fall back to Yangon.
        const insideCoverage = isInsideMyanmarApprox(fix.lat, fix.lng);
        const quality = getLocationQuality(fix.accuracyM);

        // Track the best (lowest-accuracy) fix of the session.
        const prevBest = bestFixRef.current;
        const isBetter = !prevBest || fix.accuracyM < prevBest.accuracyM;
        if (isBetter) bestFixRef.current = fix;

        if (import.meta.env.DEV) {
          // Accuracy + coverage/quality only — never the exact coordinates.
          console.debug('[location] watchPosition success', {
            accuracyM: Math.round(fix.accuracyM),
            quality,
            insideCoverage,
          });
          if (isBetter) {
            console.debug('[location] best fix improved', {
              accuracyM: Math.round(fix.accuracyM),
            });
          }
        }

        setState((prev) => ({
          ...prev,
          status: 'tracking',
          fix,
          errorMessage: null,
          quality,
          isInsideCoverage: insideCoverage,
          isOutOfCoverage: !insideCoverage,
          bestFix: bestFixRef.current,
        }));
      },
      (error) => {
        if (import.meta.env.DEV) {
          console.debug('[location] watchPosition error', {
            code: error.code,
            message: error.message,
          });
        }
        clearWarmUpTimer();
        setState((prev) => ({
          ...prev,
          status: statusForGeolocationError(error),
          errorMessage: messageForGeolocationError(error),
          isFollowing: false,
          isWarmingUp: false,
        }));
      },
      WATCH_OPTIONS,
    );
  }, [clearWatch, clearWarmUpTimer]);

  const stopTracking = useCallback(() => {
    clearWatch();
    clearWarmUpTimer();
    setState((prev) => ({
      ...prev,
      status: 'stopped',
      isFollowing: false,
      isWarmingUp: false,
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

  return {
    ...state,
    recenterRequested,
    startTracking,
    stopTracking,
    enableFollowing,
    disableFollowing,
    requestRecenter,
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
