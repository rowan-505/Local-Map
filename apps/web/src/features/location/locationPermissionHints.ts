/**
 * Shared permission-denied copy for UI, toast, debug logs, and debug overlay.
 * Client-side only; no storage. Keeps user-facing text consistent.
 */
export const LOCATION_PERMISSION_RESET_HINT =
  'Open site settings for map.coremapmm.com and set Location to Allow, then reload.';

export const LOCATION_PERMISSION_ANDROID_HINT =
  'Android Settings → Apps → Chrome → Permissions → Location → Allow. Turn Precise location ON.';

export const LOCATION_PERMISSION_IN_APP_HINT =
  'Open the site in real Chrome/Safari, not Telegram/Facebook/Messenger browser.';

/** Compact status pill when geolocation returns PERMISSION_DENIED. */
export function getPermissionDeniedStatusText(isLikelyInAppBrowser: boolean): string {
  if (isLikelyInAppBrowser) return 'Open in Chrome to use location';
  return 'Location denied · Allow site permission';
}

/** Transient toast when geolocation returns PERMISSION_DENIED. */
export function getPermissionDeniedToastMessage(
  isLikelyInAppBrowser: boolean,
  isLikelyAndroidChrome: boolean,
): string {
  if (isLikelyInAppBrowser) return 'Open in Chrome/Safari to test precise location';
  if (isLikelyAndroidChrome) return 'Allow location for map.coremapmm.com';
  return 'Allow location for map.coremapmm.com';
}

/** Debug-overlay hint lines when permission is denied (shown only with ?debugLocation=1). */
export function getPermissionDeniedDebugHints(isLikelyInAppBrowser: boolean): readonly string[] {
  if (isLikelyInAppBrowser) return [LOCATION_PERMISSION_IN_APP_HINT];
  return [LOCATION_PERMISSION_RESET_HINT, LOCATION_PERMISSION_ANDROID_HINT];
}
