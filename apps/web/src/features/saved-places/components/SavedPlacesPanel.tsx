import { useState } from 'react';
import { useAuth } from '@/features/auth/state/useAuth';
import { useSavedPlaces } from '../state/useSavedPlaces';
import type { SavedPlace } from '../api/savedPlacesApi';

export type SavedLocationSelection = {
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string;
};

type SavedPlacesPanelProps = {
  /** Fly the map to a saved map point when its row is clicked. */
  readonly onSelectLocation?: (selection: SavedLocationSelection) => void;
};

/** Sidebar panel listing the signed-in user's saved places and map points. */
export function SavedPlacesPanel({ onSelectLocation }: SavedPlacesPanelProps) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { items, loading, error } = useSavedPlaces();

  if (!isAuthenticated) {
    return (
      <section className="p-4">
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5 text-center">
          <h2 className="text-base font-semibold text-neutral-950">Save your places</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Sign in to bookmark places and locations and find them here later.
          </p>
          <button
            type="button"
            className="mt-3 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            onClick={() => openAuthModal('login')}
          >
            Sign in
          </button>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="p-4">
        <p className="text-sm text-neutral-500">Loading your saved places…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="p-4">
        <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          Could not load saved places. Try again later.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="p-4">
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5">
          <h2 className="text-base font-semibold text-neutral-950">No saved places yet</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Open a place and tap “Save place”, or click the map and tap “Save location”.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2 p-3.5" aria-label="Saved places">
      {items.map((item) => (
        <SavedPlaceRow key={item.id} item={item} onSelectLocation={onSelectLocation} />
      ))}
    </section>
  );
}

function SavedPlaceRow({
  item,
  onSelectLocation,
}: {
  readonly item: SavedPlace;
  readonly onSelectLocation?: (selection: SavedLocationSelection) => void;
}) {
  const { removeSaved } = useSavedPlaces();
  const [busy, setBusy] = useState(false);

  const isMapPoint = item.entity_type === 'map_point';
  const title = isMapPoint
    ? item.custom_name ?? 'Saved location'
    : item.display_name ?? 'Unnamed place';
  const canFly =
    isMapPoint &&
    typeof item.latitude === 'number' &&
    typeof item.longitude === 'number' &&
    onSelectLocation !== undefined;

  const onRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeSaved(item.id);
    } finally {
      setBusy(false);
    }
  };

  const onFly = () => {
    if (!canFly) return;
    onSelectLocation?.({
      latitude: item.latitude as number,
      longitude: item.longitude as number,
      label: title,
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-neutral-100 bg-white p-3.5 shadow-sm shadow-neutral-950/3">
      <button
        type="button"
        className={`min-w-0 flex-1 text-left ${canFly ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={onFly}
        disabled={!canFly}
      >
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-950">{title}</p>
          {isMapPoint ? (
            <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-100">
              Map point
            </span>
          ) : null}
        </div>
        {isMapPoint ? (
          <>
            {item.address_line ? (
              <p className="mt-0.5 truncate text-xs text-neutral-500">{item.address_line}</p>
            ) : null}
            {item.plus_code ? (
              <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{item.plus_code}</p>
            ) : null}
            {typeof item.latitude === 'number' && typeof item.longitude === 'number' ? (
              <p className="mt-0.5 font-mono text-[11px] text-neutral-400">
                {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
              </p>
            ) : null}
          </>
        ) : item.category ? (
          <p className="mt-0.5 truncate text-xs text-neutral-500">{item.category.name}</p>
        ) : null}
        <p className="mt-0.5 text-[11px] text-neutral-400">{formatSavedDate(item.created_at)}</p>
      </button>
      <button
        type="button"
        className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        disabled={busy}
        onClick={() => void onRemove()}
      >
        {busy ? '…' : 'Remove'}
      </button>
    </div>
  );
}

function formatSavedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `Saved ${date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}
