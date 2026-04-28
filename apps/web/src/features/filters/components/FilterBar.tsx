/** Category toggles + plain text search; parent owns state and applies `filterPois` on OSM POIs. */
import { memo } from 'react';
import { POI_CATEGORY_META } from '@/data/categoryMeta';
import type { PoiCategoryId } from '@/types';

type Props = {
  readonly excludedCategoryIds: readonly PoiCategoryId[];
  readonly onToggleCategory: (id: PoiCategoryId) => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
};

function FilterBarInner({
  excludedCategoryIds,
  onToggleCategory,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  const excluded = new Set(excludedCategoryIds);

  return (
    <header
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-white px-3 py-2"
      role="banner"
    >
      <label className="flex min-w-[10rem] max-w-xs flex-1 items-center gap-2">
        <span className="sr-only">Search places</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search places…"
          className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-sky-400 focus:outline-none"
          autoComplete="off"
        />
      </label>
      <span className="text-sm font-medium text-neutral-700">Categories</span>
      <div className="flex flex-wrap items-center gap-2">
        {POI_CATEGORY_META.map(({ id, label }) => {
          const visible = !excluded.has(id);
          return (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
            >
              <input
                type="checkbox"
                className="rounded border-neutral-300"
                checked={visible}
                onChange={() => onToggleCategory(id)}
              />
              {label}
            </label>
          );
        })}
      </div>
    </header>
  );
}

/** Skips re-renders when filter/search props are unchanged (e.g. map selection only). */
export const FilterBar = memo(FilterBarInner);
