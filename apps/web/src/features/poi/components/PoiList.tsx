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
      <div className="px-4 py-7 text-center text-xs text-neutral-500">
        <span className="mx-auto mb-3 block h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-sky-500" />
        Loading places...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-7 text-center text-xs leading-5 text-red-600">
        <p className="font-medium">Could not load places.</p>
        <p className="mt-1 text-red-500">Check the connection and try again.</p>
      </div>
    );
  }

  if (pois.length === 0) {
    return (
      <div className="px-4 py-7 text-center text-xs text-neutral-500">
        <p className="font-medium text-neutral-600">No places found</p>
        <p className="mt-1 leading-relaxed">Try a different category.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100" role="listbox" aria-label="Visible places">
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        const title = getLocalizedName(poi, languageMode);
        const titleClass =
          languageMode === 'both'
            ? 'block whitespace-pre-line break-words text-sm font-semibold leading-tight'
            : 'block truncate text-sm font-semibold leading-tight';
        const categoryLabel = poiCategoryLabel(
          poi.category,
          poi.categoryName,
          poi.categoryCode,
        );

        return (
          <li key={poi.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              className={`w-full px-3.5 py-2.5 text-left transition-colors ${
                selected
                  ? 'bg-sky-50 text-neutral-950'
                  : 'text-neutral-800 hover:bg-neutral-50'
              } `}
              onClick={() => onSelectPoiId(poi.id)}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`h-8 w-8 shrink-0 rounded-xl ${
                    selected ? 'bg-sky-100 text-sky-700' : 'bg-emerald-50 text-emerald-700'
                  } grid place-items-center text-xs font-semibold`}
                >
                  {categoryInitial(categoryLabel)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={titleClass}>{title}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                    <span className="truncate">{categoryLabel}</span>
                    <span className="h-1 w-1 shrink-0 rounded-full bg-neutral-300" />
                    <span className="shrink-0 text-neutral-400">Nearby</span>
                  </span>
                </span>
                {selected ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
                ) : null}
              </span>
            </button>
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
