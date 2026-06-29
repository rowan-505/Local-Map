/**
 * Compact own-location control for the public web map.
 *
 * Client-side only: triggers tracking/recenter via callbacks and renders a small
 * status pill. No modal, no sharing, no backend, nothing persisted.
 */
import type { UserLocationFix, UserLocationStatus } from './userLocationTypes';

type LocationControlProps = {
  readonly status: UserLocationStatus;
  readonly fix: UserLocationFix | null;
  readonly isFollowing: boolean;
  readonly isOutOfCoverage: boolean;
  /** True during the GPS warm-up window before a usable fix arrives. */
  readonly isWarmingUp: boolean;
  /** Optional hook error message; used to show the specific reason (e.g. HTTPS requirement). */
  readonly message?: string | null;
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
  message,
  onLocateClick,
  onStopClick,
}: LocationControlProps) {
  const isLocating = status === 'requesting_permission';
  const isTracking = status === 'tracking';
  const isError = ERROR_STATUSES.has(status);
  const statusText = getStatusText({ status, fix, isOutOfCoverage, isWarmingUp, message });
  const showStop = isTracking && Boolean(onStopClick);

  const active = isFollowing && isTracking;
  const buttonLabel = isTracking ? 'Recenter on my location' : 'Show my location';

  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      {statusText ? (
        <span
          className={`max-w-48 truncate rounded-2xl border px-2.5 py-1 text-xs font-medium shadow-lg shadow-neutral-900/10 backdrop-blur-xl ${
            isError || isOutOfCoverage
              ? 'border-amber-200 bg-amber-50/95 text-amber-900'
              : 'border-white/80 bg-white/95 text-neutral-700'
          }`}
          role={isError ? 'alert' : 'status'}
        >
          {statusText}
        </span>
      ) : null}

      <button
        type="button"
        className={`grid h-10 w-10 place-items-center rounded-2xl border shadow-lg shadow-neutral-900/10 backdrop-blur-xl transition-colors lg:h-9 lg:w-9 ${
          active
            ? 'border-sky-500 bg-sky-600 text-white shadow-sky-900/20'
            : 'border-white/80 bg-white/95 text-neutral-700 hover:bg-neutral-100'
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
          className="grid h-10 w-10 place-items-center rounded-2xl border border-white/80 bg-white/95 text-neutral-700 shadow-lg shadow-neutral-900/10 backdrop-blur-xl transition-colors hover:bg-neutral-100 lg:h-9 lg:w-9"
          aria-label="Stop location tracking"
          title="Stop location tracking"
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
  message,
}: {
  status: UserLocationStatus;
  fix: UserLocationFix | null;
  isOutOfCoverage: boolean;
  isWarmingUp: boolean;
  message?: string | null;
}): string | null {
  switch (status) {
    case 'requesting_permission':
      return 'Finding precise location…';
    case 'permission_denied':
      return 'Location denied · Showing Yangon';
    case 'unavailable':
      return 'Location unavailable · Showing Yangon';
    case 'timeout':
      return 'Location timeout · Showing Yangon';
    case 'unsupported':
      // Prefer the specific reason (e.g. HTTPS requirement) when the hook provides it.
      return message ?? 'Location unsupported · Showing Yangon';
    case 'tracking': {
      if (isOutOfCoverage) return 'Outside CoreMap coverage · Showing Yangon';
      // No usable fix yet during warm-up → reassure the user we are still improving.
      if (!fix) return isWarmingUp ? 'Finding precise location…' : 'Tracking';
      const meters = Math.round(fix.accuracyM);
      if (fix.accuracyM <= 20) return `Precise ±${meters}m`;
      if (fix.accuracyM <= 50) return `Accuracy ±${meters}m`;
      if (fix.accuracyM <= 100) return `Low accuracy ±${meters}m · Improving…`;
      return `Poor accuracy ±${meters}m · Move outdoors if possible`;
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
