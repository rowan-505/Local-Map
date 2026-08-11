import { useState } from 'react';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
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
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();
  const { items, loading, error } = useSavedPlaces();

  if (!isAuthenticated) {
    return (
      <section className="p-4">
        <div className="rounded-map-card border border-dashed border-map-primary/25 bg-map-primary-soft/55 p-5 text-center shadow-map-card">
          <h2 className="text-sm font-semibold text-map-ink">{t('နေရာများကို သိမ်းထားပါ', 'Save your places')}</h2>
          <p className="mt-2 text-sm leading-5 text-map-muted">
            {t(
              'နေရာသိမ်းရန် အကောင့်ဝင်ပါ။',
              'Sign in to save places.',
            )}
          </p>
          <button
            type="button"
            className="mt-3 rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:bg-map-primary-hover"
            onClick={() => openAuthModal('login')}
          >
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="p-4">
        <p className="text-sm text-map-muted">
          {t('သိမ်းထားသောနေရာများကို ဖွင့်နေသည်…', 'Loading your saved places…')}
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="p-4">
        <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {t('သိမ်းထားသောနေရာများ မရပါ။', 'Saved places unavailable.')}
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="p-4">
        <div className="rounded-map-card border border-dashed border-map-primary/25 bg-map-primary-soft/55 p-5 shadow-map-card">
          <h2 className="text-sm font-semibold text-map-ink">{t('သိမ်းထားသောနေရာ မရှိသေးပါ', 'No saved places yet')}</h2>
          <p className="mt-2 text-sm leading-5 text-map-muted">
            {t(
              'နေရာတစ်ခုဖွင့်ပြီး “သိမ်းရန်” နှိပ်ပါ။',
              'Open a place and select Save.',
            )}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2 p-3.5" aria-label={t('သိမ်းထားသောနေရာများ', 'Saved places')}>
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
  const t = useMapUiText();
  const languageMode = useMapUiStore((state) => state.languageMode);
  const { removeSaved } = useSavedPlaces();
  const [busy, setBusy] = useState(false);

  const isMapPoint = item.entity_type === 'map_point';
  const title = isMapPoint
    ? item.custom_name ?? t('သိမ်းထားသောတည်နေရာ', 'Saved location')
    : item.display_name ?? t('အမည်မရှိသောနေရာ', 'Unnamed place');
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
    <div className="flex items-start justify-between gap-3 rounded-map-card border border-map-border bg-map-surface p-3.5 shadow-map-card">
      <button
        type="button"
        className={`min-w-0 flex-1 text-left ${canFly ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={onFly}
        disabled={!canFly}
      >
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-map-ink">{title}</p>
          {isMapPoint ? (
            <span className="shrink-0 rounded-full bg-map-primary-soft px-1.5 py-0.5 text-xs font-semibold text-map-primary ring-1 ring-map-primary/15">
              {t('မြေပုံအမှတ်', 'Map point')}
            </span>
          ) : null}
        </div>
        {isMapPoint ? (
          <>
            {item.address_line ? (
              <p className="mt-0.5 truncate text-xs text-map-muted">{item.address_line}</p>
            ) : null}
            {item.plus_code ? (
              <p className="mt-0.5 font-mono text-xs text-map-muted/75">{item.plus_code}</p>
            ) : null}
            {typeof item.latitude === 'number' && typeof item.longitude === 'number' ? (
              <p className="mt-0.5 font-mono text-xs text-map-muted/75">
                {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
              </p>
            ) : null}
          </>
        ) : item.category ? (
          <p className="mt-0.5 truncate text-xs text-map-muted">{item.category.name}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-map-muted/75">
          {formatSavedDate(item.created_at, languageMode)}
        </p>
      </button>
      <button
        type="button"
        className="shrink-0 rounded-xl border border-map-border bg-map-surface px-2.5 py-1.5 text-xs font-semibold text-map-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        disabled={busy}
        onClick={() => void onRemove()}
      >
        {busy ? '…' : t('ဖယ်ရှားရန်', 'Remove')}
      </button>
    </div>
  );
}

function formatSavedDate(value: string, languageMode: 'my' | 'en' | 'both'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = date.toLocaleDateString(languageMode === 'en' ? 'en-US' : 'my-MM', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return languageMode === 'en' ? `Saved ${formatted}` : `${formatted} တွင် သိမ်းထားသည်`;
}
