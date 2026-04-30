import { memo } from 'react';
import type { PoiCategory, PoiCategoryId } from '@/types';

type Props = {
  readonly categories: readonly PoiCategory[];
  readonly selectedCategoryId: PoiCategoryId | null;
  readonly onSelectCategory: (id: PoiCategoryId | null) => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
  readonly categoriesLoading?: boolean;
  readonly categoriesError?: boolean;
};

function FilterBarInner({
  categories,
  selectedCategoryId,
  onSelectCategory,
  searchQuery,
  onSearchQueryChange,
  categoriesLoading = false,
  categoriesError = false,
}: Props) {
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
        <button
          type="button"
          className={`rounded border px-2 py-1 text-xs ${
            selectedCategoryId === null
              ? 'border-sky-300 bg-sky-50 text-sky-800'
              : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
          }`}
          onClick={() => onSelectCategory(null)}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            type="button"
            key={category.id}
            className={`rounded border px-2 py-1 text-xs ${
              selectedCategoryId === category.id
                ? 'border-sky-300 bg-sky-50 text-sky-800'
                : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
            }`}
            onClick={() => onSelectCategory(category.id)}
          >
            {category.name}
          </button>
        ))}
        {categoriesLoading ? (
          <span className="text-xs text-neutral-500">Loading categories…</span>
        ) : null}
        {categoriesError ? (
          <span className="text-xs text-red-600">Could not load categories</span>
        ) : null}
      </div>
    </header>
  );
}

/** Skips re-renders when filter/search props are unchanged (e.g. map selection only). */
export const FilterBar = memo(FilterBarInner);
