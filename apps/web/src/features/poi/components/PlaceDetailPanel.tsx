import { memo, useState } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { useReverseAddress } from '@/features/map/api/useReverseAddress';
import { SaveButton } from '@/features/saved-places/components/SaveButton';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import { ShareCard, type ShareCardTarget } from '@/features/share/components/ShareCard';
import { ActionButton, MetadataList, MetadataRow } from '@/components/ui/sidebarUi';
import { mutedLabel, sidebarCard } from '@/components/ui/sidebarTokens';
import type { ReportTarget } from '@/features/reports/api/reportsApi';
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

/** Neutral, full-width report button styling so it matches SaveButton in the action row. */
const REPORT_BUTTON_CLASS =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50';

function PlaceDetailPanelInner({
  selectedPoi,
  detailLoading = false,
  detailError = null,
  selectedSearchResult = null,
  onBack,
  onRoutePlace,
}: PlaceDetailPanelProps) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const [showShare, setShowShare] = useState(false);
  const detail = buildPlaceDetail({
    poi: selectedPoi,
    searchResult: selectedSearchResult,
    languageMode,
  });

  // Fallback only when this single detail is open and the API didn't supply an address line.
  const needsReverse = Boolean(detail && !detail.addressLine && detail.coordinates);
  const reverse = useReverseAddress(needsReverse ? detail!.coordinates : null);

  if (detailLoading && !detail) {
    return (
      <StateView
        onBack={onBack}
        title="Loading details…"
        body="Getting the selected place information."
      />
    );
  }

  if (detailError && !detail) {
    return (
      <StateView
        onBack={onBack}
        title="Could not load details."
        body="Return to search and try again."
        tone="error"
      />
    );
  }

  if (!detail) {
    return (
      <StateView
        onBack={onBack}
        title="Select a place"
        body="Choose a result from the map or sidebar list."
      />
    );
  }

  const coordinatesText = detail.coordinates
    ? formatCoordinates(detail.coordinates[0], detail.coordinates[1])
    : null;

  const addressLine = detail.addressLine ?? reverse.data?.address_line ?? null;
  const plusCode = detail.plusCode ?? reverse.data?.plus_code ?? null;
  const reportTarget = buildReportTarget(selectedPoi, detail);
  const shareTarget = buildShareTarget(detail, addressLine, plusCode);

  return (
    <section className="p-3" aria-label="Selected place details">
      <article className={sidebarCard}>
        <div className="px-4 pb-3.5 pt-3">
          <div className="mb-2 flex items-center gap-2">
            <BackButton onBack={onBack} />
            <span className={mutedLabel}>Place</span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 wrap-break-word text-base font-semibold leading-6 text-neutral-900">
              {detail.title}
            </h2>
            {detail.verified ? <VerifiedBadge /> : null}
          </div>
          {detail.area ? (
            <p className="mt-0.5 truncate text-xs text-neutral-500">{detail.area}</p>
          ) : null}

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <ActionButton
              primary
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
            </ActionButton>
            <ActionButton
              primary
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
            </ActionButton>
            <ActionButton
              disabled={!shareTarget}
              onClick={() => setShowShare((open) => !open)}
            >
              Share
            </ActionButton>
            <ActionButton
              disabled={!coordinatesText}
              onClick={() => {
                if (coordinatesText) copyText(coordinatesText);
              }}
            >
              Coords
            </ActionButton>
          </div>

          <div
            className={`mt-1.5 grid gap-1.5 ${reportTarget ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            <SaveButton placeApiId={selectedPoi?.apiId} />
            {reportTarget ? (
              <ReportEntryButton
                target={reportTarget}
                label="Report"
                className={REPORT_BUTTON_CLASS}
              />
            ) : null}
          </div>
        </div>

        <MetadataList>
          <MetadataRow label="Area">{detail.area ?? 'Kyauktan Township'}</MetadataRow>
          <MetadataRow label="Type">{detail.category}</MetadataRow>
          <MetadataRow label="Coordinates" mono>
            {coordinatesText ?? 'No coordinate available'}
          </MetadataRow>
          {addressLine ? (
            <MetadataRow label="Address" stacked>
              {addressLine}
            </MetadataRow>
          ) : reverse.loading ? (
            <MetadataRow label="Address" stacked muted>
              Loading address…
            </MetadataRow>
          ) : null}
          {plusCode ? (
            <MetadataRow label="Plus Code" mono>
              {plusCode}
            </MetadataRow>
          ) : null}
          <MetadataRow label="Status">
            {detail.verified
              ? 'Verified place data'
              : 'Community data, pending verification'}
          </MetadataRow>
        </MetadataList>
      </article>

      {showShare && shareTarget ? (
        <div className="mt-3">
          <ShareCard target={shareTarget} />
        </div>
      ) : null}
    </section>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  return (
    <button
      type="button"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
      aria-label="Back to search results"
      onClick={onBack}
    >
      <BackIcon />
    </button>
  );
}

function VerifiedBadge() {
  return (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
      Verified
    </span>
  );
}

function StateView({
  onBack,
  title,
  body,
  tone = 'neutral',
}: {
  readonly onBack: () => void;
  readonly title: string;
  readonly body: string;
  readonly tone?: 'neutral' | 'error';
}) {
  return (
    <section className="p-3" aria-label="Selected place details">
      <article className={sidebarCard}>
        <div className="px-4 pb-4 pt-3">
          <div className="mb-2 flex items-center gap-2">
            <BackButton onBack={onBack} />
            <span className={mutedLabel}>Place</span>
          </div>
          <p
            className={`text-sm font-medium ${
              tone === 'error' ? 'text-red-700' : 'text-neutral-800'
            }`}
          >
            {title}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">{body}</p>
        </div>
      </article>
    </section>
  );
}

type PlaceDetail = {
  readonly title: string;
  readonly category: string;
  readonly area?: string;
  readonly address?: string;
  readonly addressLine?: string;
  readonly plusCode?: string | null;
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
      addressLine: poi.addressLine,
      plusCode: poi.plusCode ?? null,
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

/**
 * Builds the report target for the detail card. Prefers a 'place' target (with
 * the core place id) when this is a real POI; otherwise falls back to a
 * 'map_point' target using the available coordinate. Returns null when there is
 * nothing locatable to report.
 */
function buildReportTarget(poi: Poi | undefined, detail: PlaceDetail): ReportTarget | null {
  const latitude = detail.coordinates ? detail.coordinates[1] : undefined;
  const longitude = detail.coordinates ? detail.coordinates[0] : undefined;

  const placeApiId = poi?.apiId ? Number(poi.apiId) : null;
  if (placeApiId !== null && Number.isFinite(placeApiId)) {
    return {
      targetEntityType: 'place',
      targetEntityId: placeApiId,
      ...(poi?.publicId ? { targetPublicId: poi.publicId } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      contextLabel: detail.title,
    };
  }

  if (latitude !== undefined && longitude !== undefined) {
    return {
      targetEntityType: 'map_point',
      latitude,
      longitude,
      contextLabel: detail.title,
    };
  }

  return null;
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

/**
 * Builds the share target for the detail card. Real places (with a public id)
 * share as a 'place'; everything else with a coordinate (streets, admin areas,
 * search hits) falls back to a 'point' share. Returns null when nothing is
 * locatable.
 */
function buildShareTarget(
  detail: PlaceDetail,
  addressLine: string | null,
  plusCode: string | null,
): ShareCardTarget | null {
  if (detail.placeId) {
    return {
      kind: 'place',
      placePublicId: detail.placeId,
      name: detail.title,
      addressLine,
      plusCode,
    };
  }

  if (detail.coordinates) {
    return {
      kind: 'point',
      lat: detail.coordinates[1],
      lng: detail.coordinates[0],
      addressLine,
      plusCode,
    };
  }

  return null;
}

function searchResultTypeLabel(type: PublicSearchResult['type']): string {
  if (type === 'street' || type === 'street_group') return 'Street';
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
