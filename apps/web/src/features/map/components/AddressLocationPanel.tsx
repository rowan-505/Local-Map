import { useEffect, useState, type ReactNode } from 'react';
import type { MapClickedLocation } from '@/features/map/types';
import { useReverseAddress } from '@/features/map/api/useReverseAddress';
import { useAuth } from '@/features/auth/state/useAuth';
import { useSavedPlaces } from '@/features/saved-places/state/useSavedPlaces';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import type { RoutePoint } from '@/features/routing/lib/routePoint';

type AddressLocationPanelProps = {
  readonly location: MapClickedLocation | null;
  readonly onUseAsRouteStart: (point: RoutePoint) => void;
  readonly onUseAsRouteDestination: (point: RoutePoint) => void;
};

export function AddressLocationPanel({
  location,
  onUseAsRouteStart,
  onUseAsRouteDestination,
}: AddressLocationPanelProps) {
  const reverse = useReverseAddress(location?.coordinates ?? null);

  if (!location) {
    return (
      <section className="p-3.5" aria-label="Inspect map location">
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Location
          </p>
          <h2 className="mt-3 text-lg font-semibold text-neutral-950">Click anywhere on the map</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Click anywhere on the map to inspect a location.
          </p>
        </div>
      </section>
    );
  }

  const [lng, lat] = location.coordinates;
  const coordinates = formatCoordinates(lng, lat);
  const routePoint: RoutePoint = {
    label: `Clicked location (${coordinates})`,
    coordinates: location.coordinates,
  };

  return (
    <section className="space-y-3 p-3.5" aria-label="Inspect map location">
      <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              Location
            </p>
            <h2 className="mt-1 text-lg font-semibold text-neutral-950">Inspect location</h2>
          </div>
          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">
            Map point
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton icon={<CopyIcon />} label="Copy coordinates" onClick={() => copyText(coordinates)}>
            Copy
          </ActionButton>
          <ActionButton icon={<ShareIcon />} label="Copy share link" onClick={() => copyText(createShareLink(location))}>
            Share
          </ActionButton>
          <ActionButton icon={<StartIcon />} label="Route start" onClick={() => onUseAsRouteStart(routePoint)}>
            Start
          </ActionButton>
          <ActionButton icon={<DestinationIcon />} label="Route destination" onClick={() => onUseAsRouteDestination(routePoint)}>
            To
          </ActionButton>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SaveLocationControl
            latitude={lat}
            longitude={lng}
            addressLine={reverse.data?.address_line ?? null}
            plusCode={reverse.data?.plus_code ?? null}
          />
          <ReportEntryButton
            target={{
              targetEntityType: 'map_point',
              latitude: lat,
              longitude: lng,
              contextLabel: `Map point (${coordinates})`,
            }}
            label="Report here"
          />
        </div>
      </div>

      <InfoSection title="Address">
        {reverse.loading ? (
          <p className="text-sm leading-6 text-neutral-400">Loading address…</p>
        ) : reverse.error ? (
          <p className="text-sm leading-6 text-neutral-500">Address unavailable</p>
        ) : (
          <p className="text-sm leading-6 text-neutral-800">
            {reverse.data?.address_line ?? 'Address unavailable'}
          </p>
        )}
      </InfoSection>

      {!reverse.loading && !reverse.error && reverse.data?.plus_code ? (
        <InfoSection title="Plus Code">
          <p className="font-mono text-sm leading-6 text-neutral-800">{reverse.data.plus_code}</p>
        </InfoSection>
      ) : null}

      <InfoSection title="Coordinates">
        <InfoRow label="Latitude" value={lat.toFixed(6)} mono />
        <InfoRow label="Longitude" value={lng.toFixed(6)} mono />
      </InfoSection>
    </section>
  );
}

/**
 * "Save location" control for the inspected map point. Only visible to signed-in
 * users (guests get a subtle prompt that opens the drawer auth panel). Saves via
 * /me/saved-places with entityType='map_point'. Saved state resets when the
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
  const { isAuthenticated, openAuthModal } = useAuth();
  const { saveMapPoint } = useSavedPlaces();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset saved/error state whenever a new point is inspected.
  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [latitude, longitude]);

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        className="mt-3 text-xs font-semibold text-sky-600 transition-colors hover:text-sky-700"
        onClick={() => openAuthModal('login')}
      >
        Sign in to save this location
      </button>
    );
  }

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
    <div className="mt-3">
      <button
        type="button"
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
          saved
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
            : 'bg-sky-600 text-white hover:bg-sky-700'
        }`}
        disabled={busy || saved}
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

function InfoSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-xs text-neutral-500">{label}</span>
      <span className={`text-right text-xs leading-5 text-neutral-800 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  label,
  onClick,
}: {
  readonly children: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
      aria-label={label}
      onClick={onClick}
    >
      <span className="grid h-4 w-4 place-items-center text-neutral-500">{icon}</span>
      {children}
    </button>
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

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 5.5h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 10.5h-1v-7h7v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.2 5.2 10 3M6.2 10.8 10 13M5.5 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM14.5 2.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM14.5 13.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StartIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 14V2M8 2 4.5 5.5M8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DestinationIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 14s4-3.4 4-7a4 4 0 0 0-8 0c0 3.6 4 7 4 7Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 8.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function createShareLink(location: MapClickedLocation): string {
  const [lng, lat] = location.coordinates;
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
  });

  if (typeof window === 'undefined') return `/?${params.toString()}`;
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}
