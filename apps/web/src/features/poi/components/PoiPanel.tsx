/** Sidebar: scrollable list + detail strip (desktop-first). */
import { memo } from 'react';
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
};

function PoiPanelInner({
  pois,
  selectedPoi,
  onSelectPoiId,
  isLoading = false,
  error = null,
  detailLoading = false,
  detailError = null,
}: PoiPanelProps) {
  const selectedPoiId = selectedPoi?.id ?? null;

  return (
    <aside
      className="flex w-80 min-h-0 shrink-0 flex-col border-l border-neutral-200 bg-white"
      aria-label="Places list and details"
    >
      <div className="shrink-0 border-b border-neutral-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-neutral-800">Places</h2>
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

      <div className="shrink-0 border-t border-neutral-200 bg-neutral-50/80 px-3 py-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Details
        </h3>
        <PoiDetail poi={selectedPoi} isLoading={detailLoading} error={detailError} />
      </div>
    </aside>
  );
}

export const PoiPanel = memo(PoiPanelInner);
