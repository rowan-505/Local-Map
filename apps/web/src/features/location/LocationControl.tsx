/**
 * Compact own-location control for the public web map.
 *
 * Client-side only: triggers tracking/recenter via callbacks and renders a small
 * status pill. No modal, no sharing, no backend, nothing persisted.
 */
import type { UserLocationFix, UserLocationStatus } from './userLocationTypes';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { getPermissionDeniedStatusText } from './locationPermissionHints';
import {
  isLikelyAndroidInAppBrowser,
  openCurrentPageInChrome,
} from './openInChromeHelper';

type LocationControlProps = {
  readonly status: UserLocationStatus;
  readonly fix: UserLocationFix | null;
  readonly isFollowing: boolean;
  readonly isOutOfCoverage: boolean;
  /** True during the GPS warm-up window before a usable fix arrives. */
  readonly isWarmingUp: boolean;
  /** True when the latest sample was rejected as stale (waiting for a fresh GPS fix). */
  readonly isAwaitingFreshFix?: boolean;
  /** Likely running inside an in-app browser/webview (Telegram/Facebook/etc.). */
  readonly isLikelyInAppBrowser?: boolean;
  /** Android device flag — combined with in-app for Chrome intent helper. */
  readonly isAndroid?: boolean;
  /** Optional hook error message; used to show the specific reason (e.g. HTTPS requirement). */
  readonly message?: string | null;
  /**
   * True when inside Myanmar, tracking, with a fix whose accuracy is too low (>50m)
   * to auto-center — surfaces a minimal "Use anyway" opt-in.
   */
  readonly canUseApproximate?: boolean;
  /** Conservatively center on the approximate low-accuracy fix (no precise lock). */
  readonly onUseApproximate?: () => void;
  /** Start tracking (when idle/stopped/error) or recenter + follow (when tracking). */
  readonly onLocateClick: () => void;
  readonly onStopClick?: () => void;
};

const ERROR_STATUSES: ReadonlySet<UserLocationStatus> = new Set([
  'permission_denied',
  'unavailable',
  'timeout',
  'unsupported',
]);

export function LocationControl({
  status,
  fix,
  isFollowing,
  isOutOfCoverage,
  isWarmingUp,
  isAwaitingFreshFix = false,
  isLikelyInAppBrowser = false,
  isAndroid = false,
  message,
  canUseApproximate = false,
  onUseApproximate,
  onLocateClick,
  onStopClick,
}: LocationControlProps) {
  const t = useMapUiText();
  const isLocating = status === 'requesting_permission';
  const isTracking = status === 'tracking';
  const isError = ERROR_STATUSES.has(status);
  const statusText = getStatusText({
    status,
    fix,
    isOutOfCoverage,
    isWarmingUp,
    isAwaitingFreshFix,
    isLikelyInAppBrowser,
    message,
    t,
  });
  const showStop = isTracking && Boolean(onStopClick);
  const showUseAnyway = canUseApproximate && Boolean(onUseApproximate);
  const showOpenInChrome =
    isLikelyAndroidInAppBrowser(isAndroid, isLikelyInAppBrowser) &&
    (status === 'permission_denied' || status === 'unsupported');

  const active = isFollowing && isTracking;
  const buttonLabel = isTracking
    ? t('တည်နေရာသို့ ပြန်ရန်', 'Recenter')
    : t('ကျွန်ုပ်၏တည်နေရာ', 'My location');

  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      {showUseAnyway ? (
        <button
          type="button"
          className="rounded-2xl border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-xs font-medium text-amber-900 shadow-map-control backdrop-blur-xl transition-colors hover:bg-amber-100"
          title={t('ခန့်မှန်းတည်နေရာ သုံးရန်', 'Use approximate location')}
          onClick={onUseApproximate}
        >
          {t('အသုံးပြုရန်', 'Use anyway')}
        </button>
      ) : null}

      {showOpenInChrome ? (
        <button
          type="button"
          className="rounded-2xl border border-map-primary/25 bg-map-primary-soft/95 px-2.5 py-1 text-xs font-medium text-map-primary shadow-map-control backdrop-blur-xl transition-colors hover:bg-blue-100"
          title={t('Chrome ဖြင့် ဖွင့်ရန်', 'Open in Chrome')}
          onClick={openCurrentPageInChrome}
        >
          {t('Chrome ဖြင့် ဖွင့်ရန်', 'Open in Chrome')}
        </button>
      ) : null}

      {statusText ? (
        <span
          className={`max-w-52 truncate rounded-2xl border px-2.5 py-1 text-xs font-medium shadow-map-control backdrop-blur-xl ${
            isError || isOutOfCoverage
              ? 'border-amber-200 bg-amber-50/95 text-amber-900'
              : 'border-white/90 bg-white/95 text-map-ink'
          }`}
          role={isError ? 'alert' : 'status'}
          title={statusText}
        >
          {statusText}
        </span>
      ) : null}

      <button
        type="button"
        className={`grid h-11 w-11 place-items-center rounded-2xl border shadow-map-control backdrop-blur-xl transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 lg:h-10 lg:w-10 ${
          active
            ? 'border-map-primary bg-map-primary text-white shadow-map-control'
            : 'border-white/90 bg-white/95 text-map-ink hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary'
        }`}
        aria-pressed={active}
        aria-busy={isLocating}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={onLocateClick}
      >
        <LocationIcon spinning={isLocating} />
      </button>

      {showStop ? (
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-2xl border border-white/90 bg-white/95 text-map-ink shadow-map-control backdrop-blur-xl transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 lg:h-10 lg:w-10"
          aria-label={t('တည်နေရာခြေရာခံမှု ရပ်ရန်', 'Stop location tracking')}
          title={t('တည်နေရာခြေရာခံမှု ရပ်ရန်', 'Stop location tracking')}
          onClick={onStopClick}
        >
          <StopIcon />
        </button>
      ) : null}
    </div>
  );
}

function getStatusText({
  status,
  fix,
  isOutOfCoverage,
  isWarmingUp,
  isAwaitingFreshFix,
  isLikelyInAppBrowser,
  message,
  t,
}: {
  status: UserLocationStatus;
  fix: UserLocationFix | null;
  isOutOfCoverage: boolean;
  isWarmingUp: boolean;
  isAwaitingFreshFix: boolean;
  isLikelyInAppBrowser: boolean;
  message?: string | null;
  t: (myanmar: string, english: string) => string;
}): string | null {
  switch (status) {
    case 'requesting_permission':
      return t('ခွင့်ပြုချက် တောင်းနေသည်…', 'Requesting access…');
    case 'permission_denied':
      return getPermissionDeniedStatusText(isLikelyInAppBrowser);
    case 'unavailable':
      return t('တည်နေရာ မရပါ', 'Location unavailable');
    case 'timeout':
      return t('တည်နေရာ ရယူချိန်ကုန်', 'Location timed out');
    case 'unsupported':
      // Prefer the specific reason (e.g. HTTPS requirement) when the hook provides it.
      return message ?? t('တည်နေရာ မထောက်ပံ့ပါ', 'Location unsupported');
    case 'tracking': {
      if (isOutOfCoverage) return t('ဝန်ဆောင်မှုဧရိယာပြင်ပ', 'Outside coverage');
      // A stale sample was just rejected → tell the user we are awaiting fresh GPS.
      if (isAwaitingFreshFix) return t('GPS စောင့်နေသည်…', 'Waiting for GPS…');
      // No usable fix yet during warm-up → reassure the user we are still improving.
      if (!fix) return isWarmingUp ? t('တည်နေရာ ရှာနေသည်…', 'Locating…') : t('ခြေရာခံနေသည်', 'Tracking');
      const meters = Math.round(fix.accuracyM);
      if (fix.accuracyM <= 20) return t(`တိကျမှု ±${meters} မီတာ`, `Precise ±${meters}m`);
      if (fix.accuracyM <= 50) return t(`တိကျမှု ±${meters} မီတာ`, `Accuracy ±${meters}m`);
      if (fix.accuracyM <= 100) {
        // Still warming up → keep hope; warm-up over → nudge to move outdoors.
        return isWarmingUp
          ? t(`±${meters} မီတာ · ပြန်ညှိနေသည်`, `±${meters}m · Improving`)
          : t(`±${meters} မီတာ · အပြင်သို့ ရွှေ့ပါ`, `±${meters}m · Move outdoors`);
      }
      return t(`±${meters} မီတာ · အပြင်သို့ ရွှေ့ပါ`, `±${meters}m · Move outdoors`);
    }
    default:
      return null;
  }
}

function LocationIcon({ spinning }: { readonly spinning: boolean }) {
  return (
    <svg
      className={`h-4.5 w-4.5 lg:h-4 lg:w-4 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 1v2M8 13v2M1 8h2M13 8h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="h-4 w-4 lg:h-3.5 lg:w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
