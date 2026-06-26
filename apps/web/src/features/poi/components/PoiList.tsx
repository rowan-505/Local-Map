/** Scrollable list of visible POIs — click selects the same id the map uses. */
import { memo } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { ResultRow } from '@/components/ui/sidebarUi';
import { resultTitleClass } from '@/components/ui/sidebarTokens';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';
import { poiCategoryLabel } from '../categoryLabel';

export type PoiListProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string) => void;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
};

function PoiListInner({
  pois,
  selectedPoiId,
  onSelectPoiId,
  isLoading = false,
  error = null,
}: PoiListProps) {
  const languageMode = useMapUiStore((s) => s.languageMode);

  if (isLoading) {
    return (
      <div className="px-4 py-5 text-center text-xs text-neutral-500">
        <span className="mx-auto mb-2 block h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-500" />
        Loading places…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-5 text-center text-xs leading-5 text-red-600">
        <p className="font-medium">Could not load places.</p>
        <p className="mt-0.5 text-red-500">Check the connection and try again.</p>
      </div>
    );
  }

  if (pois.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-xs text-neutral-500">
        <p className="font-medium text-neutral-700">No places found</p>
        <p className="mt-0.5">Try a different category.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100" role="listbox" aria-label="Visible places">
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        const title = getLocalizedName(poi, languageMode);
        const categoryLabel = poiCategoryLabel(
          poi.category,
          poi.categoryName,
          poi.categoryCode,
        );

        return (
          <li key={poi.id}>
            <ResultRow
              selected={selected}
              align="center"
              onClick={() => onSelectPoiId(poi.id)}
              leading={
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold ${
                    selected ? 'bg-neutral-200 text-neutral-700' : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {categoryInitial(categoryLabel)}
                </span>
              }
              title={<span className={resultTitleClass(languageMode === 'both')}>{title}</span>}
              subtitle={
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                  <span className="truncate">{categoryLabel}</span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-neutral-300" />
                  <span className="shrink-0 text-neutral-400">Nearby</span>
                </span>
              }
              trailing={
                selected ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export const PoiList = memo(PoiListInner);

function categoryInitial(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return 'P';
  return trimmed.slice(0, 1).toUpperCase();
}
