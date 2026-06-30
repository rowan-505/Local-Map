/**
 * Android Chrome intent helper for opening the current page in real Chrome
 * from an in-app browser / custom tab. Used only when location permission fails
 * inside a webview. No storage, no API.
 */

const CHROME_PACKAGE = 'com.android.chrome';
const DEFAULT_HOST = 'map.coremapmm.com';

/** Current page path + query (preserves ?debugLocation=1 etc.). */
function getPathAndQuery(): string {
  if (typeof window === 'undefined') return '/';
  const { pathname, search } = window.location;
  return `${pathname || '/'}${search || ''}`;
}

/** Normal https URL for the current page (clipboard / fallback open). */
export function getCurrentPageHttpsUrl(): string {
  if (typeof window === 'undefined') return `https://${DEFAULT_HOST}/`;
  return window.location.href;
}

/**
 * Android intent URL to open the current page in Chrome.
 * Example: intent://map.coremapmm.com/?debugLocation=1#Intent;scheme=https;package=com.android.chrome;end
 */
export function buildAndroidChromeIntentUrl(): string {
  if (typeof window === 'undefined') {
    return `intent://${DEFAULT_HOST}/#Intent;scheme=https;package=${CHROME_PACKAGE};end`;
  }
  const host = window.location.host || DEFAULT_HOST;
  const pathAndQuery = getPathAndQuery();
  const suffix = pathAndQuery.startsWith('/') ? pathAndQuery.slice(1) : pathAndQuery;
  return `intent://${host}/${suffix}#Intent;scheme=https;package=${CHROME_PACKAGE};end`;
}

/** Copy text when clipboard API is available. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try Chrome intent first; fall back to opening or copying the https URL.
 * Safe to call from a user gesture (button click).
 */
export function openCurrentPageInChrome(): void {
  if (typeof window === 'undefined') return;

  const httpsUrl = getCurrentPageHttpsUrl();
  const intentUrl = buildAndroidChromeIntentUrl();

  let handedOff = false;
  const cancelHandoffWatch = () => {
    handedOff = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') cancelHandoffWatch();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const fallback = () => {
    if (handedOff) return;
    cancelHandoffWatch();
    openOrCopyHttps(httpsUrl);
  };

  try {
    window.location.href = intentUrl;
  } catch {
    fallback();
    return;
  }

  window.setTimeout(fallback, 600);
}

function openOrCopyHttps(httpsUrl: string): void {
  try {
    const opened = window.open(httpsUrl, '_blank', 'noopener,noreferrer');
    if (opened) return;
  } catch {
    /* continue to copy */
  }
  void copyToClipboard(httpsUrl);
}

/** True when the helper should be offered (Android in-app / custom tab only). */
export function isLikelyAndroidInAppBrowser(
  isAndroid: boolean,
  isLikelyInAppBrowser: boolean,
): boolean {
  return isAndroid && isLikelyInAppBrowser;
}
