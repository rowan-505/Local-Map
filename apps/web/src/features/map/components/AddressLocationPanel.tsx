import { useEffect, useState } from 'react';
import type { MapClickedLocation } from '@/features/map/types';
import { useReverseAddress } from '@/features/map/api/useReverseAddress';
import { useAuth } from '@/features/auth/state/useAuth';
import { useSavedPlaces } from '@/features/saved-places/state/useSavedPlaces';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import { ShareCard } from '@/features/share/components/ShareCard';
import { ActionButton, MetadataList, MetadataRow } from '@/components/ui/sidebarUi';
import { sidebarCard } from '@/components/ui/sidebarTokens';
import type { RoutePoint } from '@/features/routing/lib/routePoint';

type AddressLocationPanelProps = {
  readonly location: MapClickedLocation | null;
  readonly zoom?: number;
  readonly onUseAsRouteStart: (point: RoutePoint) => void;
  readonly onUseAsRouteDestination: (point: RoutePoint) => void;
};

/** Neutral, full-width report button styling so it matches Save in the action row (parity with the POI detail card). */
const REPORT_BUTTON_CLASS =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50';

export function AddressLocationPanel({
  location,
  zoom,
  onUseAsRouteStart,
  onUseAsRouteDestination,
}: AddressLocationPanelProps) {
  const reverse = useReverseAddress(location?.coordinates ?? null);
  const { isAuthenticated, openAuthModal } = useAuth();
  const [showShare, setShowShare] = useState(false);

  if (!location) {
    return (
      <section className="p-3" aria-label="Inspect map location">
        <article className={sidebarCard}>
          <div className="px-4 pb-4 pt-3">
            <p className={locationLabelClass}>Location</p>
            <h2 className="mt-1 text-base font-semibold leading-6 text-neutral-900">
              Click anywhere on the map
            </h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              Click anywhere on the map to inspect a location.
            </p>
          </div>
        </article>
      </section>
    );
  }

  const [lng, lat] = location.coordinates;
  const coordinates = formatCoordinates(lng, lat);
  const routePoint: RoutePoint = {
    label: `Clicked location (${coordinates})`,
    coordinates: location.coordinates,
  };

  // Prefer the live reverse-geocode result once it arrives (background refresh),
  // otherwise fall back to any stored snapshot (e.g. from a resolved share link)
  // so shared data shows immediately without waiting for the network.
  const addressLine = reverse.data?.address_line ?? location.addressLine ?? null;
  const plusCode = reverse.data?.plus_code ?? location.plusCode ?? null;

  return (
    <section className="p-3" aria-label="Inspect map location">
      <article className={sidebarCard}>
        <div className="px-4 pb-3.5 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={locationLabelClass}>Location</p>
              <h2 className="mt-1 text-base font-semibold leading-6 text-neutral-900">
                Inspect location
              </h2>
            </div>
            <MapPointBadge />
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <ActionButton primary title="Route start" onClick={() => onUseAsRouteStart(routePoint)}>
              Start
            </ActionButton>
            <ActionButton
              primary
              title="Route destination"
              onClick={() => onUseAsRouteDestination(routePoint)}
            >
              To
            </ActionButton>
            <ActionButton title="Share location" onClick={() => setShowShare((open) => !open)}>
              Share
            </ActionButton>
            <ActionButton title="Copy coordinates" onClick={() => copyText(coordinates)}>
              Copy
            </ActionButton>
          </div>

          <div className={`mt-1.5 grid gap-1.5 ${isAuthenticated ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isAuthenticated ? (
              <SaveLocationControl
                latitude={lat}
                longitude={lng}
                addressLine={addressLine}
                plusCode={plusCode}
              />
            ) : null}
            <ReportEntryButton
              target={{
                targetEntityType: 'map_point',
                latitude: lat,
                longitude: lng,
                contextLabel: `Map point (${coordinates})`,
              }}
              label="Report here"
              className={REPORT_BUTTON_CLASS}
            />
          </div>

          {!isAuthenticated ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 transition-colors hover:text-sky-700"
              onClick={() => openAuthModal('login')}
            >
              <span className="grid h-3.5 w-3.5 place-items-center">
                <BookmarkIcon />
              </span>
              Sign in to save this location
            </button>
          ) : null}
        </div>

        <MetadataList>
          <MetadataRow label="Address" stacked muted={!addressLine}>
            {addressLine ?? (reverse.loading ? 'Loading address…' : 'Address unavailable')}
          </MetadataRow>
          <MetadataRow label="Coordinates" mono>
            {coordinates}
          </MetadataRow>
          {plusCode ? (
            <MetadataRow label="Plus Code" mono>
              {plusCode}
            </MetadataRow>
          ) : null}
        </MetadataList>
      </article>

      {showShare ? (
        <div className="mt-3">
          <ShareCard
            target={{
              kind: 'point',
              lat,
              lng,
              ...(zoom !== undefined ? { zoom } : {}),
              addressLine,
              plusCode,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Blue uppercase accent label, matching the POI card's muted label typography. */
const locationLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600';

function MapPointBadge() {
  return (
    <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-100">
      Map point
    </span>
  );
}

/**
 * "Save location" control for the inspected map point. Rendered only for
 * signed-in users (guests get the subtle sign-in row below the actions). Saves
 * via /me/saved-places with entityType='map_point'. Saved state resets when the
 * inspected coordinates change.
 */
function SaveLocationControl({
  latitude,
  longitude,
  addressLine,
  plusCode,
}: {
  readonly latitude: number;
  readonly longitude: number;
  readonly addressLine: string | null;
  readonly plusCode: string | null;
}) {
  const { saveMapPoint } = useSavedPlaces();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset saved/error state whenever a new point is inspected.
  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [latitude, longitude]);

  const onSave = async () => {
    if (busy || saved) return;
    setBusy(true);
    setError(null);
    try {
      await saveMapPoint({
        latitude,
        longitude,
        ...(addressLine ? { addressLine } : {}),
        ...(plusCode ? { plusCode } : {}),
      });
      setSaved(true);
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
          saved
            ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
            : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
        }`}
        disabled={busy || saved}
        aria-pressed={saved}
        onClick={() => void onSave()}
      >
        <span className="grid h-4 w-4 place-items-center">
          {saved ? <CheckIcon /> : <BookmarkIcon />}
        </span>
        {saved ? 'Saved' : busy ? 'Saving…' : 'Save location'}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function BookmarkIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 3.5A1.5 1.5 0 0 1 5.5 2h5A1.5 1.5 0 0 1 12 3.5V14l-4-2.8L4 14V3.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}
