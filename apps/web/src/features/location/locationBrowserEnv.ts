/**
 * Lightweight, privacy-safe browser/environment detection for location diagnostics.
 *
 * Purpose: when geolocation is denied, help a tester tell apart the real cause —
 * an in-app browser (Telegram/Facebook/Instagram webview) that often blocks or
 * silently fails location, vs. real Chrome/Safari with a site/OS permission issue.
 *
 * Deliberately simple: reads only `navigator.userAgent` + `window.isSecureContext`.
 * No fingerprinting, no network, no storage. UA sniffing is heuristic by nature, so
 * every flag is "likely", and the result is used only for guidance text + logs.
 */
export type LocationBrowserCategory =
  | 'android_chrome'
  | 'android_webview_or_custom_tab'
  | 'ios_safari'
  | 'desktop_chrome'
  | 'unknown';

export type LocationBrowserEnvironment = {
  readonly isAndroid: boolean;
  readonly isIOS: boolean;
  /** Telegram/Facebook/Instagram/etc. webview, or an Android WebView (`; wv`). */
  readonly isLikelyInAppBrowser: boolean;
  readonly isLikelyChrome: boolean;
  readonly isLikelySafari: boolean;
  readonly isSecureContext: boolean;
  readonly category: LocationBrowserCategory;
};

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
  'GSA/', // Google Search App in-app browser
];

/**
 * Detect a safe, coarse view of the current browser/environment. Never throws;
 * returns conservative `unknown`/false values when `navigator` is unavailable.
 */
export function detectLocationBrowserEnvironment(): LocationBrowserEnvironment {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext === true : false;

  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // Android WebView identifies itself with `; wv` (and lacks a real browser brand).
  const isAndroidWebView = isAndroid && /;\s*wv\)/i.test(ua);
  const hasInAppToken = IN_APP_BROWSER_TOKENS.some((token) =>
    ua.toLowerCase().includes(token.toLowerCase()),
  );
  const isLikelyInAppBrowser = isAndroidWebView || hasInAppToken;

  // CriOS = Chrome on iOS; FxiOS/EdgiOS are other iOS browsers. Real Chrome on
  // Android contains "Chrome" but not the Edge/Opera/Samsung brand tokens.
  const isCriOS = /CriOS/i.test(ua);
  const isLikelyChrome =
    !isLikelyInAppBrowser &&
    ((/Chrome/i.test(ua) && !/(Edg|OPR|SamsungBrowser)/i.test(ua)) || isCriOS);
  const isLikelySafari =
    isIOS && /Safari/i.test(ua) && !isCriOS && !/(CriOS|FxiOS|EdgiOS)/i.test(ua) && !isLikelyInAppBrowser;

  const category = categorize({
    isAndroid,
    isIOS,
    isLikelyInAppBrowser,
    isLikelyChrome,
    isLikelySafari,
  });

  return {
    isAndroid,
    isIOS,
    isLikelyInAppBrowser,
    isLikelyChrome,
    isLikelySafari,
    isSecureContext,
    category,
  };
}

function categorize(flags: {
  isAndroid: boolean;
  isIOS: boolean;
  isLikelyInAppBrowser: boolean;
  isLikelyChrome: boolean;
  isLikelySafari: boolean;
}): LocationBrowserCategory {
  if (flags.isAndroid) {
    return flags.isLikelyInAppBrowser ? 'android_webview_or_custom_tab' : 'android_chrome';
  }
  if (flags.isIOS) {
    return flags.isLikelySafari ? 'ios_safari' : 'unknown';
  }
  if (flags.isLikelyChrome) return 'desktop_chrome';
  return 'unknown';
}
