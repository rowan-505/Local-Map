/** Scrollable list of visible POIs — click selects the same id the map uses. */
import { memo } from 'react';
import type { Poi } from '@/types';
import { poiCategoryLabel } from '../categoryLabel';

export type PoiListProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string) => void;
};

function PoiListInner({ pois, selectedPoiId, onSelectPoiId }: PoiListProps) {
  if (pois.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-neutral-500">
        <p className="font-medium text-neutral-600">No places to show yet</p>
        <p className="mt-2 leading-relaxed">
          Load POIs from normalized Kyauktan OSM with <code className="rounded bg-neutral-100 px-1">npm run pois:refresh</code>
          , or widen category filters if everything is hidden.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100" role="listbox" aria-label="Visible places">
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        return (
          <li key={poi.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              className={`w-full px-2 py-2.5 text-left transition-colors ${
                selected
                  ? 'bg-sky-50 text-neutral-900'
                  : 'text-neutral-800 hover:bg-neutral-50'
              } `}
              onClick={() => onSelectPoiId(poi.id)}
            >
              <span className="block text-sm font-medium leading-tight">{poi.name}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {poiCategoryLabel(poi.category)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const PoiList = memo(PoiListInner);
