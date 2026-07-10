/**
 * On-screen location diagnostics overlay — DEBUG ONLY.
 *
 * Renders a tiny, fixed panel with permission/environment diagnostics so a tester
 * on a real phone (where the DevTools console is invisible) can see why location
 * was denied. It is shown ONLY when `isLocationDebugOverlayEnabled()` is true
 * (`?debugLocation=1` or `enableLocationDebug()`); otherwise it renders nothing.
 *
 * Privacy: never shows exact coordinates — only permission state, secure-context,
 * browser category, in-app-browser flag, accuracy, and a reset hint.
 * Client-side only: no API, no database, no storage, no sharing.
 */
import { useEffect, useState } from 'react';
import {
  detectLocationBrowserEnvironment,
  type LocationBrowserEnvironment,
} from './locationBrowserEnvironment';
import { detectPermissionsPolicyAllowsGeolocation, getLocationAuditOrigin } from './locationPermissionAudit';
import { getPermissionDeniedDebugHints } from './locationPermissionHints';
import { isLocationDebugOverlayEnabled } from './locationDebug';
import type { UserLocationStatus } from './userLocationTypes';

type PermissionStateLike = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

type LocationDebugOverlayProps = {
  readonly status: UserLocationStatus;
  readonly accuracyM: number | null;
  readonly isInsideCoverage: boolean | null;
};

export function LocationDebugOverlay({
  status,
  accuracyM,
  isInsideCoverage,
}: LocationDebugOverlayProps) {
  const [env, setEnv] = useState<LocationBrowserEnvironment | null>(null);
  const permission = useGeolocationPermission();

  // Compute UA-derived env on mount (client only; stable for the session).
  useEffect(() => {
    if (!isLocationDebugOverlayEnabled()) return;
    setEnv(detectLocationBrowserEnvironment());
  }, []);

  if (!isLocationDebugOverlayEnabled() || !env) return null;

  const rows: Array<[string, string]> = [
    ['status', status],
    ['permission', permission],
    ['secureContext', String(env.isSecureContext)],
    ['origin', getLocationAuditOrigin() ?? '—'],
    ['browser', env.userAgentCategory],
    ['inAppBrowser', String(env.isLikelyInAppBrowser)],
    [
      'policyGeo',
      String(detectPermissionsPolicyAllowsGeolocation() ?? 'n/a'),
    ],
    ['accuracyM', accuracyM == null ? '—' : `${accuracyM}`],
    ['inCoverage', isInsideCoverage == null ? '—' : String(isInsideCoverage)],
  ];

  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-9999 max-w-[80vw] rounded-lg border border-sky-300 bg-white/95 p-2 font-mono text-[10px] leading-tight text-neutral-800 shadow-lg backdrop-blur"
      role="status"
      aria-label="Location debug diagnostics"
    >
      <div className="mb-1 font-semibold text-sky-700">location debug</div>
      <table>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td className="pr-2 text-neutral-500">{key}</td>
              <td className="font-medium">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === 'permission_denied' ? (
        <div className="mt-1 max-w-[72vw] space-y-0.5 text-[10px] text-amber-700">
          {getPermissionDeniedDebugHints(env.isLikelyInAppBrowser).map((hint) => (
            <div key={hint}>{hint}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Live Permissions API state (geolocation), debug-gated. Falls back gracefully. */
function useGeolocationPermission(): PermissionStateLike {
  const [state, setState] = useState<PermissionStateLike>('unknown');

  useEffect(() => {
    if (!isLocationDebugOverlayEnabled()) return;
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      setState('unsupported');
      return;
    }
    let permissionStatus: PermissionStatus | null = null;
    let active = true;
    const onChange = () => {
      if (active && permissionStatus) setState(permissionStatus.state as PermissionStateLike);
    };
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        if (!active) return;
        permissionStatus = result;
        setState(result.state as PermissionStateLike);
        result.addEventListener('change', onChange);
      })
      .catch(() => {
        if (active) setState('unsupported');
      });
    return () => {
      active = false;
      permissionStatus?.removeEventListener('change', onChange);
    };
  }, []);

  return state;
}
