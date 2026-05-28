import { memo } from 'react';
import type { ReactNode } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';
import { poiCategoryLabel } from '../categoryLabel';

export type RoutePlacePayload = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
  readonly placeId?: string;
};

export type PlaceDetailPanelProps = {
  readonly selectedPoi: Poi | undefined;
  readonly detailLoading?: boolean;
  readonly detailError?: Error | null;
  readonly selectedSearchResult?: PublicSearchResult | null;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
};

function PlaceDetailPanelInner({
  selectedPoi,
  detailLoading = false,
  detailError = null,
  selectedSearchResult = null,
  onBack,
  onRoutePlace,
}: PlaceDetailPanelProps) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const detail = buildPlaceDetail({
    poi: selectedPoi,
    searchResult: selectedSearchResult,
    languageMode,
  });

  if (detailLoading && !detail) {
    return (
      <section className="p-4" aria-label="Selected place details">
        <DetailTopBar onBack={onBack} />
        <StateCard title="Loading details..." body="Getting the selected place information." />
      </section>
    );
  }

  if (detailError && !detail) {
    return (
      <section className="p-4" aria-label="Selected place details">
        <DetailTopBar onBack={onBack} />
        <StateCard title="Could not load details." body="Return to search and try again." tone="error" />
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="p-4" aria-label="Selected place details">
        <DetailTopBar onBack={onBack} />
        <StateCard title="Select a place" body="Choose a result from the map or sidebar list." />
      </section>
    );
  }

  const coordinatesText = detail.coordinates
    ? formatCoordinates(detail.coordinates[0], detail.coordinates[1])
    : null;

  return (
    <section className="space-y-3 p-3.5" aria-label="Selected place details">
      <DetailTopBar onBack={onBack} />

      <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-neutral-500">{detail.category}</p>
            <h2 className="text-xl font-semibold leading-7 text-neutral-950">{detail.title}</h2>
            {detail.area ? (
              <p className="mt-1 truncate text-xs text-neutral-500">{detail.area}</p>
            ) : null}
          </div>
          {detail.verified ? (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
              Verified
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <PrimaryActionButton
            disabled={!detail.coordinates}
            onClick={() => {
              if (detail.coordinates) {
                onRoutePlace('from', {
                  label: detail.title,
                  coordinates: detail.coordinates,
                  placeId: detail.placeId,
                });
              }
            }}
          >
            From
          </PrimaryActionButton>
          <PrimaryActionButton
            disabled={!detail.coordinates}
            onClick={() => {
              if (detail.coordinates) {
                onRoutePlace('to', {
                  label: detail.title,
                  coordinates: detail.coordinates,
                  placeId: detail.placeId,
                });
              }
            }}
          >
            To
          </PrimaryActionButton>
          <PrimaryActionButton onClick={() => sharePlace(detail)}>Share</PrimaryActionButton>
          <PrimaryActionButton
            disabled={!coordinatesText}
            onClick={() => {
              if (coordinatesText) copyText(coordinatesText);
            }}
          >
            Coords
          </PrimaryActionButton>
        </div>
      </div>

      <InfoSection title="Location">
        <InfoRow label="Area" value={detail.area ?? 'Kyauktan Township'} />
        <InfoRow label="Type" value={detail.category} />
      </InfoSection>

      <InfoSection title="Coordinates">
        <InfoRow label="Lat, lng" value={coordinatesText ?? 'No coordinate available'} mono />
      </InfoSection>

      <InfoSection title="Nearby / Address">
        <InfoRow label="Address" value={detail.address ?? 'Address intelligence coming soon'} />
        <InfoRow label="Nearby" value="Nearby places coming soon" />
      </InfoSection>

      <InfoSection title="Data status">
        <InfoRow
          label="Status"
          value={detail.verified ? 'Verified place data' : 'Community data, pending verification'}
        />
      </InfoSection>
    </section>
  );
}

function DetailTopBar({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-950"
        aria-label="Back to search results"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Place detail
        </p>
        <p className="text-xs text-neutral-500">Search and nearby places remain one tap away.</p>
      </div>
    </div>
  );
}

function PrimaryActionButton({
  children,
  disabled = false,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-xl border border-neutral-200 bg-white px-2 py-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
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
      <span
        className={`text-right text-xs leading-5 text-neutral-800 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StateCard({
  title,
  body,
  tone = 'neutral',
}: {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'neutral' | 'error';
}) {
  return (
    <div
      className={`mt-3 rounded-2xl border p-4 text-sm ${
        tone === 'error'
          ? 'border-red-100 bg-red-50 text-red-700'
          : 'border-neutral-100 bg-white text-neutral-600'
      }`}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5">{body}</p>
    </div>
  );
}

type PlaceDetail = {
  readonly title: string;
  readonly category: string;
  readonly area?: string;
  readonly address?: string;
  readonly coordinates: readonly [number, number] | null;
  readonly placeId?: string;
  readonly verified: boolean;
};

function buildPlaceDetail({
  poi,
  searchResult,
  languageMode,
}: {
  readonly poi: Poi | undefined;
  readonly searchResult: PublicSearchResult | null;
  readonly languageMode: PlaceLanguageMode;
}): PlaceDetail | null {
  if (poi) {
    return {
      title: getLocalizedName(poi, languageMode),
      category: poiCategoryLabel(poi.category, poi.categoryName, poi.categoryCode),
      area: poi.address,
      address: poi.address,
      coordinates: [poi.longitude, poi.latitude],
      placeId: poi.publicId ?? poi.id,
      verified: poi.isVerified === true,
    };
  }

  if (!searchResult) return null;

  const typeLabel = searchResultTypeLabel(searchResult.type);
  const placeId =
    searchResult.type === 'place'
      ? (searchResult.publicId ?? searchResult.id)
      : undefined;

  return {
    title: getLocalizedName(searchResult, languageMode),
    category: searchResult.categoryName ?? searchResult.categoryCode ?? typeLabel,
    area: searchResult.subtitle,
    address: searchResult.subtitle,
    coordinates: getSearchResultCenter(searchResult),
    placeId,
    verified: false,
  };
}

function getSearchResultCenter(result: PublicSearchResult): readonly [number, number] | null {
  if (result.cameraTarget?.type === 'point') return result.cameraTarget.center;
  if (result.center) return result.center;
  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return [result.lng, result.lat];
  }
  if (result.cameraTarget?.type === 'bounds' && result.cameraTarget.bbox) {
    return centerFromBbox(result.cameraTarget.bbox);
  }
  if (result.bbox) return centerFromBbox(result.bbox);
  return null;
}

function centerFromBbox(
  bbox: readonly [number, number, number, number],
): readonly [number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function sharePlace(detail: PlaceDetail): void {
  const url = createMapUrl(detail);
  void navigator.clipboard?.writeText(url);
}

function createMapUrl(detail: PlaceDetail): string {
  const params = new URLSearchParams({ q: detail.title });
  if (detail.coordinates) {
    params.set('lng', String(detail.coordinates[0]));
    params.set('lat', String(detail.coordinates[1]));
  }

  if (typeof window === 'undefined') {
    return `/?${params.toString()}`;
  }

  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function searchResultTypeLabel(type: PublicSearchResult['type']): string {
  if (type === 'street') return 'Street';
  if (type === 'admin_area') return 'Village';
  return 'Place';
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 3.5 5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const PlaceDetailPanel = memo(PlaceDetailPanelInner);
