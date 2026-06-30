/**
 * Mobile geolocation permission audit helpers — debug only.
 *
 * Emits structured console events (via `logLocationEvent`) so testers can tell apart:
 * site permission vs OS permission vs in-app browser vs Permissions-Policy vs insecure
 * context. Never logs exact coordinates. Client-side only; no storage/API.
 */
import { detectLocationBrowserEnvironment } from './locationBrowserEnvironment';
import {
  LOCATION_PERMISSION_ANDROID_HINT,
  LOCATION_PERMISSION_IN_APP_HINT,
  LOCATION_PERMISSION_RESET_HINT,
} from './locationPermissionHints';
import { logLocationEvent } from './locationDebug';

/** Whether the Permissions-Policy / Feature-Policy allows geolocation in this frame. */
export function detectPermissionsPolicyAllowsGeolocation(): boolean | null {
  if (typeof document === 'undefined') return null;
  const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean } })
    .permissionsPolicy;
  if (policy?.allowsFeature) {
    try {
      return policy.allowsFeature('geolocation');
    } catch {
      return null;
    }
  }
  // Legacy Feature-Policy API (older Chromium).
  const legacy = (document as Document & { featurePolicy?: { allowsFeature: (f: string) => boolean } })
    .featurePolicy;
  if (legacy?.allowsFeature) {
    try {
      return legacy.allowsFeature('geolocation');
    } catch {
      return null;
    }
  }
  return null;
}

/** Page origin for audit logs (scheme + host only; no path/query). */
export function getLocationAuditOrigin(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    return window.location.origin || null;
  } catch {
    return null;
  }
}

type AuditBaseMeta = {
  isSecureContext: boolean | null;
  hasNavigatorGeolocation: boolean;
  permissionState?: string;
  userAgentCategory: string;
  isLikelyInAppBrowser: boolean;
  isLikelyAndroidChrome: boolean;
  isLikelyIOS: boolean;
  permissionsPolicyAllowsGeolocation: boolean | null;
  origin: string | null;
};

function buildAuditBaseMeta(): AuditBaseMeta {
  const env = detectLocationBrowserEnvironment();
  return {
    isSecureContext: env.isSecureContext,
    hasNavigatorGeolocation: env.hasNavigatorGeolocation,
    userAgentCategory: env.userAgentCategory,
    isLikelyInAppBrowser: env.isLikelyInAppBrowser,
    isLikelyAndroidChrome: env.isAndroid && env.isLikelyChrome && !env.isLikelyInAppBrowser,
    isLikelyIOS: env.isIOS,
    permissionsPolicyAllowsGeolocation: detectPermissionsPolicyAllowsGeolocation(),
    origin: getLocationAuditOrigin(),
  };
}

/**
 * One-shot permission/environment audit when the user taps locate and tracking starts.
 * Individual events mirror each checklist item for easy DevTools filtering.
 */
export function logMobilePermissionAuditOnStart(): void {
  const base = buildAuditBaseMeta();

  logLocationEvent('mobile_permission_audit', {
    ...base,
    reason: 'user_clicked_locate',
  });
  logLocationEvent('browser_environment', {
    userAgentCategory: base.userAgentCategory,
    isLikelyInAppBrowser: base.isLikelyInAppBrowser,
    isLikelyAndroidChrome: base.isLikelyAndroidChrome,
    isLikelyIOS: base.isLikelyIOS,
    origin: base.origin,
  });
  logLocationEvent('secure_context_check', {
    isSecureContext: base.isSecureContext,
    origin: base.origin,
    reason: base.isSecureContext ? 'secure' : 'insecure_or_unknown',
  });
  logLocationEvent('geolocation_api_available', {
    hasNavigatorGeolocation: base.hasNavigatorGeolocation,
    reason: base.hasNavigatorGeolocation ? 'available' : 'missing',
  });
  logLocationEvent('permissions_policy_check', {
    permissionsPolicyAllowsGeolocation: base.permissionsPolicyAllowsGeolocation,
    reason:
      base.permissionsPolicyAllowsGeolocation === false
        ? 'policy_blocks_geolocation'
        : base.permissionsPolicyAllowsGeolocation === true
          ? 'policy_allows_geolocation'
          : 'policy_not_detectable',
  });

  // Best-effort Permissions API read before watchPosition resolves (async).
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        logLocationEvent('permission_state_before_watch', {
          permissionState: result.state,
          ...base,
          reason:
            result.state === 'denied'
              ? 'site_or_os_already_denied'
              : result.state === 'granted'
                ? 'already_granted'
                : 'prompt_expected',
        });
        if (result.state === 'denied') {
          logPermissionPreblocked(base, result.state);
        }
      })
      .catch(() => {
        logLocationEvent('permission_state_before_watch', {
          permissionState: 'unsupported',
          ...base,
          reason: 'permissions_api_query_failed',
        });
      });
  } else {
    logLocationEvent('permission_state_before_watch', {
      permissionState: 'unsupported',
      ...base,
      reason: 'permissions_api_unavailable',
    });
  }
}

/** Log when watchPosition returns a watch id (confirms the API call was made). */
export function logWatchCreated(watchId: number): void {
  const base = buildAuditBaseMeta();
  logLocationEvent('watch_created', {
    ...base,
    watchIdExists: true,
    reason: `watch_id_${watchId}`,
  });
}

/** Raw geolocation error from the browser callback (before status mapping). */
export function logWatchErrorRaw(error: GeolocationPositionError): void {
  const base = buildAuditBaseMeta();
  logLocationEvent('watch_error_raw', {
    ...base,
    errorCode: error.code,
    errorMessage: error.message || null,
    reason: `code_${error.code}`,
  });
}

/** Enriched permission-denied help after PERMISSION_DENIED from watchPosition. */
export function logPermissionDeniedHelp(error: GeolocationPositionError): void {
  const base = buildAuditBaseMeta();
  const logHelp = (permissionState?: string) => {
    if (permissionState === 'denied') {
      logPermissionPreblocked(base, permissionState);
    }
    logLocationEvent('permission_denied_help', {
      status: 'permission_denied',
      reason: 'browser_permission_denied',
      permissionState,
      errorCode: error.code,
      errorMessage: error.message || null,
      ...base,
      resetHint: LOCATION_PERMISSION_RESET_HINT,
      androidHint: LOCATION_PERMISSION_ANDROID_HINT,
      inAppBrowserHint: LOCATION_PERMISSION_IN_APP_HINT,
      browserHint:
        'Chrome blocks repeated dismissed prompts until reset in Page Info / Site Settings.',
    });
  };

  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => logHelp(result.state))
      .catch(() => logHelp('unknown'));
  } else {
    logHelp('unsupported');
  }
}

function logPermissionPreblocked(
  base: AuditBaseMeta,
  permissionState: string,
): void {
  logLocationEvent('permission_preblocked', {
    permissionState,
    reason: 'permission_denied_before_watch',
    ...base,
    resetHint: LOCATION_PERMISSION_RESET_HINT,
    androidHint: LOCATION_PERMISSION_ANDROID_HINT,
    inAppBrowserHint: LOCATION_PERMISSION_IN_APP_HINT,
  });
}
