import { memo, useState } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { useReverseAddress } from '@/features/map/api/useReverseAddress';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import { ShareCard, type ShareCardTarget } from '@/features/share/components/ShareCard';
import { ActionButton, MetadataList, MetadataRow } from '@/components/ui/sidebarUi';
import { mutedLabel, sidebarCard } from '@/components/ui/sidebarTokens';
import type { ReportTarget } from '@/features/reports/api/reportsApi';
import type { RoutePlacePayload } from '@/features/poi/components/PlaceDetailPanel';
import { TransportStopRoutesSection } from '@/features/transport/components/TransportStopRoutesSection';
import { TransportStopNextStopsSection } from '@/features/transport/components/TransportStopNextStopsSection';
import {
  transportStopEntityLabel,
  transportStopTypeLabel,
} from '@/features/transport/transportStopLabels';
import type { TransportMapSelection } from '@/features/transport/transportMapSelection';
import { resolveTransportStopDetailPanelState } from '@/features/transport/transportStopDetailPanelState';
import { transportStopDetailPanelBanner } from '@/features/transport/transportStopDetailPanelCopy';
import { isRealTransportDisplayName } from '@/features/map/lib/maplibre/transportDisplayName';
import type { TransportStopDetail } from '@/types';
import type { LanguageMode } from '@local-map/localized-name';
import { getLocalizedName } from '@local-map/localized-name';

export type TransportStopDetailPanelProps = {
  readonly selection: TransportMapSelection | null;
  /** API-backed detail — tile preview stays on `selection.preview` for degraded states only. */
  readonly selectedStop: TransportStopDetail | undefined;
  readonly detailLoading?: boolean;
  readonly detailFetched?: boolean;
  readonly detailError?: Error | null;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
  readonly onRetry?: () => void;
};

const REPORT_BUTTON_CLASS =
  'flex w-full items-center justify-center gap-2 rounded-map-control border border-map-border bg-map-surface px-3 py-2.5 text-sm font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

function TransportStopDetailPanelInner({
  selection,
  selectedStop,
  detailLoading = false,
  detailFetched = false,
  detailError = null,
  onBack,
  onRoutePlace,
  onRetry,
}: TransportStopDetailPanelProps) {
  const panelState = resolveTransportStopDetailPanelState({
    selection,
    apiDetail: selectedStop,
    loading: detailLoading,
    fetched: detailFetched,
    error: detailError,
  });

  if (panelState.kind === 'idle') {
    return (
      <section className="p-3" aria-label="Selected transport stop details">
        <article className={sidebarCard}>
          <div className="px-4 pb-4 pt-3">
            <div className="mb-2 flex items-center gap-2">
              <BackButton onBack={onBack} />
              <span className={mutedLabel}>Transit</span>
            </div>
            <p className="text-sm font-medium text-map-ink">Select a stop</p>
            <p className="mt-1 text-xs leading-5 text-map-muted">
              Choose a stop on the map.
            </p>
          </div>
        </article>
      </section>
    );
  }

  if (panelState.kind === 'loaded') {
    return (
      <LoadedTransportStopDetail
        selection={panelState.selection}
        detail={panelState.detail}
        onBack={onBack}
        onRoutePlace={onRoutePlace}
      />
    );
  }

  const detail =
    panelState.kind === 'loading' ? panelState.selection.preview : panelState.preview;

  return (
    <PreviewTransportStopDetail
      selection={panelState.selection}
      detail={detail}
      panelState={panelState}
      onBack={onBack}
      onRoutePlace={onRoutePlace}
      onRetry={onRetry}
    />
  );
}

function PreviewTransportStopDetail({
  selection,
  detail,
  panelState,
  onBack,
  onRoutePlace,
  onRetry,
}: {
  readonly selection: TransportMapSelection;
  readonly detail: TransportStopDetail;
  readonly panelState: Exclude<
    ReturnType<typeof resolveTransportStopDetailPanelState>,
    { kind: 'idle' | 'loaded' }
  >;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
  readonly onRetry?: () => void;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const [showShare, setShowShare] = useState(false);
  const typeLabel = transportStopTypeLabel(selection, detail.stopType, detail.mode);
  const title = localizedStopTitle(detail, languageMode, typeLabel);
  const coordinates = selection.coordinates;
  const shareTarget = buildShareTarget(coordinates, title, null, null);

  return (
    <section className="p-3" aria-label="Selected transport stop details">
      <TransportStopDetailCard
        selection={selection}
        detail={detail}
        panelState={panelState}
        onBack={onBack}
        onRoutePlace={onRoutePlace}
        onRetry={onRetry}
        onToggleShare={() => setShowShare((open) => !open)}
      />
      {showShare && shareTarget ? (
        <div className="mt-3">
          <ShareCard target={shareTarget} />
        </div>
      ) : null}
    </section>
  );
}

function LoadedTransportStopDetail({
  selection,
  detail,
  onBack,
  onRoutePlace,
}: {
  readonly selection: TransportMapSelection;
  readonly detail: TransportStopDetail;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const [showShare, setShowShare] = useState(false);
  const coordinates: readonly [number, number] = [detail.longitude, detail.latitude];
  const routesServingThisStop = detail.routesServingThisStop ?? [];
  const nextStopsPreview = detail.nextStopsPreview ?? [];

  const needsReverse = !detail.addressLine;
  const reverse = useReverseAddress(needsReverse ? coordinates : null);

  const typeLabel = transportStopTypeLabel(selection, detail.stopType, detail.mode);
  const title = localizedStopTitle(detail, languageMode, typeLabel);
  const addressLine = detail.addressLine ?? reverse.data?.address_line ?? null;
  const plusCode = detail.plusCode ?? reverse.data?.plus_code ?? null;
  const reportTarget = buildReportTarget(selection, detail, title, coordinates);
  const shareTarget = buildShareTarget(coordinates, title, addressLine, plusCode);

  return (
    <section className="p-3" aria-label="Selected transport stop details">
      <TransportStopDetailCard
        selection={selection}
        detail={detail}
        panelState={{ kind: 'loaded', selection, detail }}
        onBack={onBack}
        onRoutePlace={onRoutePlace}
        showVerifiedBadge={detail.isVerified}
        addressLine={addressLine}
        plusCode={plusCode}
        addressLoading={reverse.loading}
        reportTarget={reportTarget}
        onToggleShare={() => setShowShare((open) => !open)}
      />

      <div className="mt-3">
        <TransportStopRoutesSection routes={routesServingThisStop} languageMode={languageMode} />
      </div>

      <div className="mt-3">
        <TransportStopNextStopsSection
          currentStopName={title}
          previews={nextStopsPreview}
          languageMode={languageMode}
        />
      </div>

      {showShare && shareTarget ? (
        <div className="mt-3">
          <ShareCard target={shareTarget} />
        </div>
      ) : null}
    </section>
  );
}

type TransportStopDetailCardProps = {
  readonly selection: TransportMapSelection;
  readonly detail: TransportStopDetail;
  readonly panelState: Exclude<
    ReturnType<typeof resolveTransportStopDetailPanelState>,
    { kind: 'idle' }
  >;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
  readonly onRetry?: () => void;
  readonly showVerifiedBadge?: boolean;
  readonly addressLine?: string | null;
  readonly plusCode?: string | null;
  readonly addressLoading?: boolean;
  readonly reportTarget?: ReportTarget;
  readonly onToggleShare?: () => void;
};

function TransportStopDetailCard({
  selection,
  detail,
  panelState,
  onBack,
  onRoutePlace,
  onRetry,
  showVerifiedBadge = false,
  addressLine = null,
  plusCode = null,
  addressLoading = false,
  reportTarget: reportTargetOverride,
  onToggleShare,
}: TransportStopDetailCardProps) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const coordinates: readonly [number, number] =
    panelState.kind === 'loaded'
      ? [detail.longitude, detail.latitude]
      : selection.coordinates;
  const typeLabel = transportStopTypeLabel(selection, detail.stopType, detail.mode);
  const entityLabel = transportStopEntityLabel(selection, detail.stopType, detail.mode);
  const title = localizedStopTitle(detail, languageMode, typeLabel);
  const coordinatesText = formatCoordinates(coordinates[0], coordinates[1]);
  const modeLabel = transportModeLabel(detail.mode);
  const area = detail.adminAreaName ?? null;
  const isLoading = panelState.kind === 'loading';
  const isLoaded = panelState.kind === 'loaded';
  const banner = transportStopDetailPanelBanner(panelState);

  const reportTarget =
    reportTargetOverride ?? buildReportTarget(selection, detail, title, coordinates);
  const shareTarget = buildShareTarget(coordinates, title, addressLine, plusCode);

  return (
    <article className={sidebarCard}>
      <div className="px-4 pb-3.5 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <BackButton onBack={onBack} />
          <span className={mutedLabel}>{entityLabel}</span>
        </div>

        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 wrap-break-word text-sm font-semibold leading-5 text-map-ink">
            {title}
          </h2>
          {showVerifiedBadge ? <VerifiedBadge /> : null}
        </div>

        {area && isLoaded ? (
          <p className="mt-0.5 truncate text-xs text-map-muted">{area}</p>
        ) : null}

        {banner ? (
          <div
            className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 ${
              banner.tone === 'error' ? 'text-red-700' : 'text-map-muted'
            }`}
          >
            <span>{banner.message}</span>
            {banner.showRetry && onRetry ? (
              <button
                type="button"
                className="font-medium text-map-primary underline-offset-2 hover:underline"
                onClick={onRetry}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <ActionButton
            primary
            onClick={() => {
              onRoutePlace('from', { label: title, coordinates });
            }}
          >
            From
          </ActionButton>
          <ActionButton
            primary
            onClick={() => {
              onRoutePlace('to', { label: title, coordinates });
            }}
          >
            To
          </ActionButton>
          <ActionButton
            disabled={!shareTarget}
            onClick={() => onToggleShare?.()}
          >
            Share
          </ActionButton>
          <ActionButton
            onClick={() => {
              copyText(coordinatesText);
            }}
          >
            Coords
          </ActionButton>
        </div>

        <div className="mt-1.5 grid grid-cols-1 gap-1.5">
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
        <MetadataRow label="Type">{typeLabel}</MetadataRow>
        {modeLabel ? <MetadataRow label="Mode">{modeLabel}</MetadataRow> : null}
        {area && isLoaded ? <MetadataRow label="Area">{area}</MetadataRow> : null}
        <MetadataRow label="Coordinates" mono>
          {coordinatesText}
        </MetadataRow>

        {isLoading ? (
          <>
            <MetadataRow label="Address" stacked muted>
              <LoadingSkeletonLine />
            </MetadataRow>
            <MetadataRow label="Status" muted>
              <LoadingSkeletonLine className="w-28" />
            </MetadataRow>
          </>
        ) : null}

        {isLoaded && addressLine ? (
          <MetadataRow label="Address" stacked>
            {addressLine}
          </MetadataRow>
        ) : null}
        {isLoaded && !addressLine && addressLoading ? (
          <MetadataRow label="Address" stacked muted>
            Loading address…
          </MetadataRow>
        ) : null}
        {isLoaded && plusCode ? (
          <MetadataRow label="Plus Code" mono>
            {plusCode}
          </MetadataRow>
        ) : null}
        {isLoaded ? (
          <MetadataRow label="Status">{transportStatusText(detail)}</MetadataRow>
        ) : null}
      </MetadataList>
    </article>
  );
}

function LoadingSkeletonLine({ className = 'w-40' }: { readonly className?: string }) {
  return (
    <span
      className={`inline-block h-3 animate-pulse rounded bg-neutral-200 ${className}`}
      aria-hidden="true"
    />
  );
}

function localizedStopTitle(
  detail: TransportStopDetail,
  languageMode: LanguageMode,
  typeLabel: string,
): string {
  const localized = getLocalizedName(
    {
      name_mm: detail.nameMm,
      name_en: detail.nameEn,
      display_name: detail.displayName,
      primary_name: detail.primaryName,
      name: detail.name,
    },
    languageMode,
  );
  if (isRealTransportDisplayName(localized) && !isCoordinateFallbackName(localized)) {
    return localized;
  }
  return typeLabel;
}

function isCoordinateFallbackName(value: string): boolean {
  return /^stop:[\d.-]+:[\d.-]+$/i.test(value.trim());
}

function transportModeLabel(mode: string): string | null {
  const normalized = mode.trim().toLowerCase();
  switch (normalized) {
    case 'bus':
      return 'Bus';
    case 'rail':
    case 'train':
      return 'Train';
    case 'ferry':
    case 'water':
      return 'Ferry';
    case 'air':
      return 'Air';
    case 'tram':
      return 'Tram';
    case 'metro':
    case 'subway':
      return 'Metro';
    case '':
      return null;
    default:
      return null;
  }
}

function transportStatusText(detail: TransportStopDetail): string {
  if (detail.isVerified) {
    return 'Verified stop data';
  }
  if (detail.statusLabel === 'Reviewed') {
    return 'Reviewed stop data';
  }
  return 'Community data, pending verification';
}

function buildReportTarget(
  selection: TransportMapSelection,
  detail: TransportStopDetail,
  title: string,
  coordinates: readonly [number, number],
): ReportTarget {
  const latitude = coordinates[1];
  const longitude = coordinates[0];

  if (selection.kind === 'stop') {
    const stopEntityId = parsePositiveInt(detail.id);
    if (stopEntityId !== null) {
      return {
        targetEntityType: 'bus_stop',
        targetEntityId: stopEntityId,
        ...(isUuid(detail.publicId) ? { targetPublicId: detail.publicId } : {}),
        latitude,
        longitude,
        contextLabel: title,
      };
    }
  }

  return {
    targetEntityType: 'map_point',
    latitude,
    longitude,
    contextLabel: title,
  };
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function buildShareTarget(
  coordinates: readonly [number, number],
  title: string,
  addressLine: string | null,
  plusCode: string | null,
): ShareCardTarget {
  return {
    kind: 'point',
    lat: coordinates[1],
    lng: coordinates[0],
    addressLine: addressLine ?? title,
    plusCode,
  };
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  return (
    <button
      type="button"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
      aria-label="Back to search results"
      onClick={onBack}
    >
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 3.5 5.5 8l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function VerifiedBadge() {
  return (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
      Verified
    </span>
  );
}

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

export const TransportStopDetailPanel = memo(TransportStopDetailPanelInner);
