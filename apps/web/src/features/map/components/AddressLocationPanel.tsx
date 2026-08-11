import { useState } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
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

/** Neutral report button styling so it matches Save in the compact action row. */
const REPORT_BUTTON_CLASS =
  'flex min-h-10 w-full items-center justify-center gap-2 rounded-map-control border border-map-border bg-map-surface px-2.5 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

const SAVE_BUTTON_CLASS =
  'flex min-h-10 w-full items-center justify-center gap-2 rounded-map-control border border-map-border bg-map-surface px-2.5 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

export function AddressLocationPanel({
  location,
  zoom,
  onUseAsRouteStart,
  onUseAsRouteDestination,
}: AddressLocationPanelProps) {
  const t = useMapUiText();
  const reverse = useReverseAddress(location?.coordinates ?? null);
  const { isAuthenticated, openAuthModal } = useAuth();
  const [showShare, setShowShare] = useState(false);

  if (!location) {
    return (
      <section className="p-3" aria-label={t('မြေပုံတည်နေရာ စစ်ဆေးရန်', 'Inspect map location')}>
        <article className={sidebarCard}>
          <div className="px-4 py-4 text-center">
            <p className="text-sm font-medium leading-5 text-map-muted">
              {t('မြေပုံပေါ်တွင် နှိပ်ပါ', 'Click the map')}
            </p>
          </div>
        </article>
      </section>
    );
  }

  const [lng, lat] = location.coordinates;
  const coordinates = formatCoordinates(lng, lat);
  const routePoint: RoutePoint = {
    label: t(`ရွေးထားသောတည်နေရာ (${coordinates})`, `Clicked location (${coordinates})`),
    coordinates: location.coordinates,
  };

  // Prefer the live reverse-geocode result once it arrives (background refresh),
  // otherwise fall back to any stored snapshot (e.g. from a resolved share link)
  // so shared data shows immediately without waiting for the network.
  const addressLine = reverse.data?.address_line ?? location.addressLine ?? null;
  const plusCode = reverse.data?.plus_code ?? location.plusCode ?? null;

  return (
    <section className="p-3" aria-label={t('မြေပုံတည်နေရာ စစ်ဆေးရန်', 'Inspect map location')}>
      <article className={sidebarCard}>
        <div className="px-4 pb-3.5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs font-medium text-map-muted">
              {t('ရွေးထားသောနေရာ', 'Selected point')}
            </p>
            <MapPointBadge />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <ActionButton primary title={t('လမ်းကြောင်းစတင်ရာ', 'Route start')} onClick={() => onUseAsRouteStart(routePoint)}>
              {t('မှ', 'From')}
            </ActionButton>
            <ActionButton
              primary
              title={t('သွားမည့်နေရာ', 'Route destination')}
              onClick={() => onUseAsRouteDestination(routePoint)}
            >
              {t('သို့', 'To')}
            </ActionButton>
            <ActionButton title={t('တည်နေရာမျှဝေရန်', 'Share location')} onClick={() => setShowShare((open) => !open)}>
              {t('မျှဝေ', 'Share')}
            </ActionButton>
            <ActionButton title={t('ကိုဩဒိနိတ်ကူးယူရန်', 'Copy coordinates')} onClick={() => copyText(coordinates)}>
              {t('ကူးယူ', 'Copy')}
            </ActionButton>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {isAuthenticated ? (
              <SaveLocationControl
                key={`${lat}:${lng}`}
                latitude={lat}
                longitude={lng}
                addressLine={addressLine}
                plusCode={plusCode}
              />
            ) : (
              <button
                type="button"
                className={SAVE_BUTTON_CLASS}
                onClick={() => openAuthModal('login')}
              >
                <span className="grid h-3.5 w-3.5 place-items-center">
                  <BookmarkIcon />
                </span>
                {t('သိမ်း', 'Save')}
              </button>
            )}
            <ReportEntryButton
              target={{
                targetEntityType: 'map_point',
                latitude: lat,
                longitude: lng,
                contextLabel: `Map point (${coordinates})`,
              }}
              label={t('တိုင်ကြား', 'Report')}
              className={REPORT_BUTTON_CLASS}
            />
          </div>
        </div>

        <MetadataList>
          <MetadataRow label={t('လိပ်စာ', 'Address')} stacked muted={!addressLine}>
            <span className="line-clamp-2 text-sm leading-5">
              {addressLine ??
                (reverse.loading
                  ? t('လိပ်စာ ဖွင့်နေသည်…', 'Loading address…')
                  : t('လိပ်စာ မရရှိနိုင်ပါ', 'Address unavailable'))}
            </span>
          </MetadataRow>
          <MetadataRow label={t('တည်နေရာ', 'Coords')} mono>
            {coordinates}
          </MetadataRow>
          {plusCode ? (
            <MetadataRow label="Plus code" mono>
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

function MapPointBadge() {
  const t = useMapUiText();
  return (
    <span className="shrink-0 rounded-full bg-map-primary-soft px-2 py-0.5 text-xs font-semibold text-map-primary ring-1 ring-map-primary/15">
      {t('မြေပုံ', 'Map')}
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
  const t = useMapUiText();
  const { saveMapPoint } = useSavedPlaces();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(t('သိမ်း၍မရပါ။', 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className={`flex min-h-10 w-full items-center justify-center gap-2 rounded-map-control border px-2.5 py-2 text-xs font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
          saved
            ? 'border-map-primary/25 bg-map-primary-soft text-map-primary hover:bg-blue-100'
            : 'border-map-border bg-map-surface text-map-ink hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary'
        }`}
        disabled={busy || saved}
        aria-pressed={saved}
        onClick={() => void onSave()}
      >
        <span className="grid h-4 w-4 place-items-center">
          {saved ? <CheckIcon /> : <BookmarkIcon />}
        </span>
        {saved
          ? t('သိမ်းပြီး', 'Saved')
          : busy
            ? t('သိမ်းနေသည်…', 'Saving…')
            : t('သိမ်း', 'Save')}
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
