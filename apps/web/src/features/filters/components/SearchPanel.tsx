import { memo } from 'react';
import type { ReactNode } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PublicSearchResult } from '@/features/poi/api/publicMapApi';
import { PoiList } from '@/features/poi/components/PoiList';
import type { Poi, PoiCategory, PoiCategoryCode } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';

type SearchResultType =
  | PublicSearchResult['type']
  | 'address'
  | 'bus_route'
  | 'bus_stop'
  | 'coordinate';

type SearchPanelProps = {
  readonly categories: readonly PoiCategory[];
  readonly selectedCategoryCode: PoiCategoryCode | null;
  readonly onSelectCategory: (code: PoiCategoryCode | null) => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
  readonly searchResults: readonly PublicSearchResult[];
  readonly selectedSearchResultId: string | null;
  readonly onSelectSearchResult: (result: PublicSearchResult) => void;
  readonly onClearSearch: () => void;
  readonly pois: readonly Poi[];
  readonly placesCount?: number;
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string | null) => void;
  readonly hasMorePlaces?: boolean;
  readonly onLoadMorePlaces?: () => void;
  readonly searchLoading?: boolean;
  readonly searchError?: boolean;
  readonly categoriesLoading?: boolean;
  readonly categoriesError?: boolean;
  readonly placesLoading?: boolean;
  readonly placesLoadingMore?: boolean;
  readonly placesError?: Error | null;
  readonly placesLoadMoreError?: Error | null;
};

function SearchPanelInner({
  categories,
  selectedCategoryCode,
  onSelectCategory,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  selectedSearchResultId,
  onSelectSearchResult,
  onClearSearch,
  pois,
  placesCount,
  selectedPoiId,
  onSelectPoiId,
  hasMorePlaces = false,
  onLoadMorePlaces,
  searchLoading = false,
  searchError = false,
  categoriesLoading = false,
  categoriesError = false,
  placesLoading = false,
  placesLoadingMore = false,
  placesError = null,
  placesLoadMoreError = null,
}: SearchPanelProps) {
  const showSearchResults = searchQuery.trim().length > 0;

  return (
    <section className="space-y-3 p-3.5" aria-label="Search places">
      <div className="space-y-2">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Find on map
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search places, streets, bus routes..."
            className="h-11 w-full rounded-2xl border border-neutral-200 bg-white py-2 pl-11 pr-16 text-sm text-neutral-900 shadow-sm shadow-neutral-950/3 outline-none placeholder:text-neutral-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
            autoComplete="off"
          />
          {searchLoading ? (
            <span className="absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-neutral-200 border-t-sky-500" />
          ) : null}
          {searchQuery.length > 0 ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-sm leading-none text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              aria-label="Clear search"
              onClick={onClearSearch}
            >
              <ClearIcon />
            </button>
          ) : null}
        </div>
      </div>

      {showSearchResults ? (
        <SearchResults
          results={searchResults}
          selectedSearchResultId={selectedSearchResultId}
          onSelectSearchResult={onSelectSearchResult}
          searchLoading={searchLoading}
          searchError={searchError}
        />
      ) : (
        <SearchEmptyState />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">
            Categories
          </h2>
          {categoriesLoading ? (
            <span className="text-xs text-neutral-500">Loading...</span>
          ) : null}
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip
            selected={selectedCategoryCode === null}
            onClick={() => onSelectCategory(null)}
          >
            All
          </CategoryChip>
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              selected={selectedCategoryCode === category.code}
              onClick={() => onSelectCategory(category.code)}
            >
              {category.name}
            </CategoryChip>
          ))}
        </div>
        {categoriesError ? (
          <p className="mt-2 text-xs text-red-600">Could not load categories.</p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm shadow-neutral-950/3">
        <div className="flex items-center justify-between border-b border-neutral-100 px-3.5 py-2.5">
          <div>
            <h2 className="text-sm font-semibold leading-5 text-neutral-950">Visible places</h2>
            <p className="text-xs text-neutral-500">
              {placesLoading ? 'Loading...' : `${placesCount ?? pois.length} shown`}
            </p>
          </div>
        </div>
        <PoiList
          pois={pois}
          selectedPoiId={selectedPoiId}
          onSelectPoiId={onSelectPoiId}
          isLoading={placesLoading}
          error={placesError}
        />
        {!placesLoading && !placesError && hasMorePlaces ? (
          <div className="border-t border-neutral-100 p-2.5">
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-wait disabled:opacity-60"
              onClick={onLoadMorePlaces}
              disabled={placesLoadingMore}
            >
              {placesLoadingMore ? 'Loading more...' : 'Load more in this area'}
            </button>
            {placesLoadMoreError ? (
              <p className="mt-2 text-center text-xs text-red-600">
                Could not load more places. Try again.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SearchEmptyState() {
  return (
    <div className="rounded-2xl bg-sky-50 px-3.5 py-3 text-sm leading-6 text-sky-950 ring-1 ring-sky-100">
      <p className="font-medium">Search places, streets, bus routes…</p>
      <p className="mt-1 text-xs leading-5 text-sky-800">
        Results stay in the sidebar so the map remains visible.
      </p>
    </div>
  );
}

function SearchResults({
  results,
  selectedSearchResultId,
  onSelectSearchResult,
  searchLoading,
  searchError,
}: {
  readonly results: readonly PublicSearchResult[];
  readonly selectedSearchResultId: string | null;
  readonly onSelectSearchResult: (result: PublicSearchResult) => void;
  readonly searchLoading: boolean;
  readonly searchError: boolean;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const hasResults = results.length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm shadow-neutral-950/3">
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <h2 className="text-sm font-semibold leading-5 text-neutral-950">Search results</h2>
      </div>
      {searchLoading ? (
        <SearchStateMessage title="Searching..." body="Looking across available map data." />
      ) : null}
      {searchError ? (
        <SearchStateMessage
          tone="error"
          title="Could not load search results."
          body="Check the connection and try again."
        />
      ) : null}
      {!searchLoading && !searchError && !hasResults ? (
        <SearchStateMessage title="No results found." body="Try another place, street, or route name." />
      ) : null}
      {!searchLoading && !searchError && hasResults ? (
        <ul className="divide-y divide-neutral-100" role="listbox" aria-label="Search results">
          {results.map((result) => {
            const selected = result.id === selectedSearchResultId;
            const title = getLocalizedName(result, languageMode);
            const titleClass =
              languageMode === 'both'
                ? 'block whitespace-pre-line break-words text-sm font-semibold'
                : 'block truncate text-sm font-semibold';

            return (
              <li key={`${result.type}:${result.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                    selected ? 'bg-sky-50 text-sky-950' : 'text-neutral-800 hover:bg-neutral-50'
                  }`}
                  onClick={() => onSelectSearchResult(result)}
                >
                  <SearchResultBadge type={result.type} />
                  <span className="min-w-0">
                    <span className={titleClass}>{title}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      {result.subtitle ??
                        result.categoryName ??
                        result.categoryCode ??
                        searchResultTypeLabel(result.type)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SearchStateMessage({
  title,
  body,
  tone = 'neutral',
}: {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'neutral' | 'error';
}) {
  return (
    <div
      className={`px-3.5 py-4 text-sm ${
        tone === 'error' ? 'text-red-700' : 'text-neutral-600'
      }`}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{body}</p>
    </div>
  );
}

function SearchResultBadge({ type }: { readonly type: SearchResultType }) {
  const meta = searchResultTypeMeta(type);

  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${meta.className}`}
    >
      {meta.badge}
    </span>
  );
}

function searchResultTypeLabel(type: SearchResultType): string {
  return searchResultTypeMeta(type).label;
}

function searchResultTypeMeta(type: SearchResultType): {
  readonly badge: string;
  readonly label: string;
  readonly className: string;
} {
  switch (type) {
    case 'street':
      return { badge: 'St', label: 'Street', className: 'bg-orange-50 text-orange-700' };
    case 'admin_area':
      return { badge: 'V', label: 'Village', className: 'bg-violet-50 text-violet-800' };
    case 'address':
      return { badge: 'A', label: 'Address', className: 'bg-blue-50 text-blue-700' };
    case 'bus_route':
      return { badge: 'R', label: 'Bus route', className: 'bg-cyan-50 text-cyan-700' };
    case 'bus_stop':
      return { badge: 'B', label: 'Bus stop', className: 'bg-amber-50 text-amber-700' };
    case 'coordinate':
      return { badge: 'GPS', label: 'Coordinate', className: 'bg-slate-100 text-slate-700' };
    case 'place':
    default:
      return { badge: 'P', label: 'Place', className: 'bg-emerald-50 text-emerald-700' };
  }
}

function CategoryChip({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        selected
          ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const SearchPanel = memo(SearchPanelInner);

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM13.8 13.8 18 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4.5 4.5 7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
