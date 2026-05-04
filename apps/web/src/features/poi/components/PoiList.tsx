/** Scrollable list of visible POIs — click selects the same id the map uses. */
import { memo } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
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
      <div className="px-4 py-8 text-center text-xs text-neutral-500">
        Loading places…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 text-center text-xs text-red-600">
        Could not load places. Check the API URL and try again.
      </div>
    );
  }

  if (pois.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-neutral-500">
        <p className="font-medium text-neutral-600">No places found</p>
        <p className="mt-2 leading-relaxed">Try a different search or category.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1 p-2" role="listbox" aria-label="Visible places">
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        const title = getLocalizedName(poi, languageMode);
        const titleClass =
          languageMode === 'both'
            ? 'block whitespace-pre-line break-words text-sm font-semibold leading-tight'
            : 'block truncate text-sm font-semibold leading-tight';
        return (
          <li key={poi.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              className={`w-full rounded-2xl px-3 py-3 text-left transition-all ${
                selected
                  ? 'bg-sky-50 text-neutral-950 shadow-sm ring-1 ring-sky-100'
                  : 'text-neutral-800 hover:bg-neutral-50'
              } `}
              onClick={() => onSelectPoiId(poi.id)}
            >
              <span className="flex items-start gap-3">
                <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                  selected ? 'bg-sky-500' : 'bg-emerald-500'
                }`} />
                <span className="min-w-0">
                  <span className={titleClass}>{title}</span>
                  <span className="mt-1 block truncate text-xs text-neutral-500">
                    {poiCategoryLabel(poi.category, poi.categoryName, poi.categoryCode)}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const PoiList = memo(PoiListInner);
