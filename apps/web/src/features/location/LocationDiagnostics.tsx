/**
 * Dev-only own-user location diagnostics — CONSOLE ONLY.
 *
 * Helps tell whether a bad blue-dot position comes from CoreMap logic or from the
 * browser/device GPS itself. Logs a one-line summary to the DevTools console on
 * state changes; it renders NOTHING in the UI. All work is guarded by
 * `import.meta.env.DEV`, so it compiles away in production.
 *
 * Privacy: never logs exact coordinates — only accuracy/quality/coverage flags.
 * Client-side only: no API, no database, no storage, no sharing.
 */
import { useEffect, useState } from 'react';
import { isCenterWorthyAccuracy } from './locationAccuracy';
import type { UserLocationState } from './userLocationTypes';

type PermissionStateLike = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

type LocationDiagnosticsInput = Pick<
  UserLocationState,
  'status' | 'fix' | 'quality' | 'isInsideCoverage' | 'isOutOfCoverage' | 'isWarmingUp'
>;

/** Logs a console-only location summary in development. No UI is rendered. */
export function useLocationDiagnostics({
  status,
  fix,
  quality,
  isInsideCoverage,
  isOutOfCoverage,
  isWarmingUp,
}: LocationDiagnosticsInput): void {
  const permission = useGeolocationPermission();
  const secureContext = typeof window !== 'undefined' ? window.isSecureContext : null;
  const accuracyM = fix ? Math.round(fix.accuracyM) : null;
  const cameraDecision = describeCameraDecision({
    status,
    hasFix: Boolean(fix),
    accuracyM: fix?.accuracyM ?? null,
    isInsideCoverage,
    isWarmingUp,
  });

  // One-line console summary on every meaningful change (no coordinates).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug('[location] diagnostics', {
      status,
      accuracyM,
      quality,
      isInsideCoverage,
      isOutOfCoverage,
      isWarmingUp,
      camera: cameraDecision,
      permission,
      secureContext,
    });
  }, [
    status,
    accuracyM,
    quality,
    isInsideCoverage,
    isOutOfCoverage,
    isWarmingUp,
    cameraDecision,
    permission,
    secureContext,
  ]);
}

/**
 * Deterministic mirror of the HomePage camera policy — describes whether centering
 * is allowed or delayed for the current state without coupling to its internals.
 */
function describeCameraDecision({
  status,
  hasFix,
  accuracyM,
  isInsideCoverage,
  isWarmingUp,
}: {
  status: UserLocationState['status'];
  hasFix: boolean;
  accuracyM: number | null;
  isInsideCoverage: boolean | null;
  isWarmingUp: boolean;
}): string {
  if (
    status === 'permission_denied' ||
    status === 'unavailable' ||
    status === 'timeout' ||
    status === 'unsupported'
  ) {
    return 'fallback: Yangon (error)';
  }
  if (status !== 'tracking' || !hasFix) return '—';
  if (isInsideCoverage === false) return 'fallback: Yangon (outside)';
  if (isCenterWorthyAccuracy(accuracyM)) return 'allowed (good fix)';
  return isWarmingUp
    ? 'delayed (warming up, low accuracy)'
    : 'allowed (conservative, post warm-up)';
}

function useGeolocationPermission(): PermissionStateLike {
  const [state, setState] = useState<PermissionStateLike>('unknown');

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      setState('unsupported');
      return;
    }
    let status: PermissionStatus | null = null;
    let active = true;
    const onChange = () => {
      if (active && status) setState(status.state as PermissionStateLike);
    };
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        if (!active) return;
        status = result;
        setState(result.state as PermissionStateLike);
        result.addEventListener('change', onChange);
      })
      .catch(() => {
        if (active) setState('unsupported');
      });
    return () => {
      active = false;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  return state;
}
