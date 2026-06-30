/**
 * Lightweight mobile browser environment detection for location debugging.
 *
 * Reads only `navigator.userAgent`, `window.isSecureContext`, and whether
 * `navigator.geolocation` exists. Used for permission-denied diagnostics and
 * debug logs — never for tracking logic. No storage, no coordinates, no network.
 *
 * UA sniffing is heuristic; every browser flag is prefixed "likely".
 */
export type LocationUserAgentCategory =
  | 'android_chrome'
  | 'android_webview_or_custom_tab'
  | 'android_firefox'
  | 'ios_safari'
  | 'ios_webview'
  | 'desktop_chrome'
  | 'desktop_safari'
  | 'unknown';

export type LocationBrowserEnvironment = {
  readonly isAndroid: boolean;
  readonly isIOS: boolean;
  readonly isMobile: boolean;
  readonly isLikelyChrome: boolean;
  readonly isLikelySafari: boolean;
  /** Telegram/Facebook/Instagram webview, Android `; wv`, or similar. */
  readonly isLikelyInAppBrowser: boolean;
  readonly isSecureContext: boolean;
  readonly hasNavigatorGeolocation: boolean;
  readonly userAgentCategory: LocationUserAgentCategory;
};

/** @deprecated Prefer `userAgentCategory`. */
export type LocationBrowserCategory = LocationUserAgentCategory;

/** Known in-app browser / embedded webview UA tokens (case-insensitive). */
const IN_APP_BROWSER_TOKENS = [
  'FBAN',
  'FBAV',
  'FB_IAB',
  'Instagram',
  'Line/',
  'Twitter',
  'WhatsApp',
  'Telegram',
  'Snapchat',
  'TikTok',
  'musical_ly',
  'GSA/',
];

/**
 * Detect a safe, coarse browser/environment view. Never throws; returns
 * conservative false/`unknown` when `navigator` is unavailable.
 */
export function detectLocationBrowserEnvironment(): LocationBrowserEnvironment {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext === true : false;
  const hasNavigatorGeolocation =
    typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS;

  const isAndroidWebView = isAndroid && /;\s*wv\)/i.test(ua);
  const hasInAppToken = IN_APP_BROWSER_TOKENS.some((token) =>
    ua.toLowerCase().includes(token.toLowerCase()),
  );
  const isLikelyInAppBrowser = isAndroidWebView || hasInAppToken;

  const isCriOS = /CriOS/i.test(ua);
  const isFxiOS = /FxiOS/i.test(ua);
  const isLikelyChrome =
    !isLikelyInAppBrowser &&
    ((/Chrome/i.test(ua) && !/(Edg|OPR|SamsungBrowser)/i.test(ua)) || isCriOS);

  const isMacDesktopSafari =
    !isMobile && /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/(Chrome|Chromium|Edg|OPR)/i.test(ua);
  const isLikelySafari =
    (isIOS &&
      /Safari/i.test(ua) &&
      !isCriOS &&
      !isFxiOS &&
      !/(EdgiOS)/i.test(ua) &&
      !isLikelyInAppBrowser) ||
    isMacDesktopSafari;

  const userAgentCategory = categorizeUserAgent({
    ua,
    isAndroid,
    isIOS,
    isMobile,
    isLikelyInAppBrowser,
    isLikelyChrome,
    isLikelySafari,
    isMacDesktopSafari,
  });

  return {
    isAndroid,
    isIOS,
    isMobile,
    isLikelyChrome,
    isLikelySafari,
    isLikelyInAppBrowser,
    isSecureContext,
    hasNavigatorGeolocation,
    userAgentCategory,
  };
}

function categorizeUserAgent(flags: {
  ua: string;
  isAndroid: boolean;
  isIOS: boolean;
  isMobile: boolean;
  isLikelyInAppBrowser: boolean;
  isLikelyChrome: boolean;
  isLikelySafari: boolean;
  isMacDesktopSafari: boolean;
}): LocationUserAgentCategory {
  if (flags.isAndroid) {
    if (flags.isLikelyInAppBrowser) return 'android_webview_or_custom_tab';
    if (/Firefox/i.test(flags.ua)) return 'android_firefox';
    if (flags.isLikelyChrome) return 'android_chrome';
    return 'unknown';
  }
  if (flags.isIOS) {
    if (flags.isLikelyInAppBrowser) return 'ios_webview';
    if (flags.isLikelySafari) return 'ios_safari';
    return 'unknown';
  }
  if (flags.isLikelyChrome) return 'desktop_chrome';
  if (flags.isMacDesktopSafari) return 'desktop_safari';
  return 'unknown';
}
