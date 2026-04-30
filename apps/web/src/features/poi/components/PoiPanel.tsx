/** Sidebar: scrollable list + detail strip (desktop-first). */
import { memo } from 'react';
import type { ReactNode } from 'react';
import type { PublicSearchResult } from '@/features/poi/api/publicMapApi';
import type { Poi } from '@/types';
import { PoiDetail } from './PoiDetail';
import { PoiList } from './PoiList';

export type PoiPanelProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoi: Poi | undefined;
  readonly onSelectPoiId: (id: string | null) => void;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
  readonly detailLoading?: boolean;
  readonly detailError?: Error | null;
  readonly selectedSearchResult?: PublicSearchResult | null;
  readonly onZoomToSearchResult?: (result: PublicSearchResult) => void;
};

function PoiPanelInner({
  pois,
  selectedPoi,
  onSelectPoiId,
  isLoading = false,
  error = null,
  detailLoading = false,
  detailError = null,
  selectedSearchResult = null,
  onZoomToSearchResult,
}: PoiPanelProps) {
  const selectedPoiId = selectedPoi?.id ?? null;
  const selectedStreet =
    selectedSearchResult?.type === 'street' ? selectedSearchResult : null;

  return (
    <aside
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex max-h-[44vh] min-h-0 flex-col overflow-hidden rounded-3xl border border-white/80 bg-white/95 shadow-2xl shadow-neutral-900/20 backdrop-blur sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:max-h-none sm:w-80"
      aria-label="Places list and details"
    >
      <div className="shrink-0 border-b border-neutral-100 px-4 py-3">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-200 sm:hidden" />
        <h2 className="text-base font-semibold text-neutral-900">Places</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          {isLoading ? 'Loading…' : `${pois.length} shown`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PoiList
          pois={pois}
          selectedPoiId={selectedPoiId}
          onSelectPoiId={onSelectPoiId}
          isLoading={isLoading}
          error={error}
        />
      </div>

      <div className="sticky bottom-0 shrink-0 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-[0_-12px_24px_rgba(15,23,42,0.06)]">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Details
        </h3>
        {selectedStreet ? (
          <StreetDetail
            result={selectedStreet}
            onZoomToSearchResult={onZoomToSearchResult}
          />
        ) : (
          <PoiDetail poi={selectedPoi} isLoading={detailLoading} error={detailError} />
        )}
      </div>
    </aside>
  );
}

function StreetDetail({
  result,
  onZoomToSearchResult,
}: {
  readonly result: PublicSearchResult;
  readonly onZoomToSearchResult?: (result: PublicSearchResult) => void;
}) {
  const center = getStreetCenter(result);
  const coordinates = center ? formatCoordinates(center[0], center[1]) : null;
  const hasBounds = result.cameraTarget?.type === 'bounds' && result.cameraTarget.bbox;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl bg-orange-50 p-3 ring-1 ring-orange-100">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-orange-600">
          Street
        </p>
        <h3 className="text-base font-semibold leading-snug text-neutral-950">
          {result.name}
        </h3>
        <p className="mt-1 text-xs text-neutral-600">{result.subtitle ?? 'Street'}</p>
        {coordinates ? (
          <p className="mt-2 font-mono text-xs text-neutral-600">{coordinates}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DetailActionButton
          disabled={!coordinates}
          onClick={() => {
            if (coordinates) copyText(coordinates);
          }}
        >
          Copy center
        </DetailActionButton>
        <DetailActionButton
          disabled={!hasBounds}
          onClick={() => onZoomToSearchResult?.(result)}
        >
          Full street
        </DetailActionButton>
        <DetailActionButton
          className="col-span-2"
          onClick={() => shareDetail(result.name, coordinates ?? 'Street selected from search')}
        >
          Share
        </DetailActionButton>
      </div>
    </div>
  );
}

function getStreetCenter(result: PublicSearchResult): readonly [number, number] | null {
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

function shareDetail(title: string, text: string): void {
  if (navigator.share) {
    void navigator.share({ title, text });
    return;
  }

  void navigator.clipboard?.writeText(`${title}\n${text}`);
}

function DetailActionButton({
  children,
  className = '',
  disabled = false,
  onClick,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const PoiPanel = memo(PoiPanelInner);
