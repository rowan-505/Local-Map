import { memo, useEffect, useRef } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PublicSearchResult } from '@/features/poi/api/publicMapApi';
import {
  getVisiblePublicSearchCategoryFilterChips,
  PUBLIC_SEARCH_TRANSPORT_MODE_FILTER_CHIPS,
  PUBLIC_SEARCH_TRANSPORT_TYPE_FILTER_CHIPS,
  type PublicSearchCategory,
  type PublicSearchTransportMode,
  type PublicSearchTransportType,
} from '@/features/poi/api/publicSearchConstants';
import { PoiList } from '@/features/poi/components/PoiList';
import { Chip, ChipRow, ResultRow, SidebarSectionTitle } from '@/components/ui/sidebarUi';
import { resultTitleClass, sidebarCard } from '@/components/ui/sidebarTokens';
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
  readonly searchCategory: PublicSearchCategory;
  readonly onSearchCategoryChange: (category: PublicSearchCategory) => void;
  readonly searchTransportType: PublicSearchTransportType;
  readonly onSearchTransportTypeChange: (transportType: PublicSearchTransportType) => void;
  readonly searchTransportMode: PublicSearchTransportMode;
  readonly onSearchTransportModeChange: (mode: PublicSearchTransportMode) => void;
  readonly searchResults: readonly PublicSearchResult[];
  readonly selectedSearchResultId: string | null;
  readonly selectedSearchResult?: PublicSearchResult | null;
  readonly selectedResultLoading?: boolean;
  readonly onSelectSearchResult: (result: PublicSearchResult) => void;
  readonly onClearSelectedSearchResult?: () => void;
  readonly onViewSelectedResultDetails?: () => void;
  readonly onClearSearch: () => void;
  readonly referenceCoordinates?: readonly [number, number] | null;
  readonly pois: readonly Poi[];
  readonly placesCount?: number;
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string | null) => void;
  readonly hasMorePlaces?: boolean;
  readonly onLoadMorePlaces?: () => void;
  readonly searchLoading?: boolean;
  readonly searchLoadingMore?: boolean;
  readonly searchError?: boolean;
  readonly searchFetchMoreError?: boolean;
  readonly hasMoreSearch?: boolean;
  readonly searchReachedCap?: boolean;
  readonly onLoadMoreSearch?: () => void;
  readonly onRetrySearch?: () => void;
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
  searchCategory,
  onSearchCategoryChange,
  searchTransportType,
  onSearchTransportTypeChange,
  searchTransportMode,
  onSearchTransportModeChange,
  searchResults,
  selectedSearchResultId,
  selectedSearchResult = null,
  selectedResultLoading = false,
  onSelectSearchResult,
  onClearSelectedSearchResult,
  onViewSelectedResultDetails,
  onClearSearch,
  referenceCoordinates = null,
  pois,
  placesCount,
  selectedPoiId,
  onSelectPoiId,
  hasMorePlaces = false,
  onLoadMorePlaces,
  searchLoading = false,
  searchLoadingMore = false,
  searchError = false,
  searchFetchMoreError = false,
  hasMoreSearch = false,
  searchReachedCap = false,
  onLoadMoreSearch,
  onRetrySearch,
  categoriesLoading = false,
  categoriesError = false,
  placesLoading = false,
  placesLoadingMore = false,
  placesError = null,
  placesLoadMoreError = null,
}: SearchPanelProps) {
  const showSearchResults = searchQuery.trim().length > 0;
  const categoryFilterChips = getVisiblePublicSearchCategoryFilterChips();
  const showTransportFilters = searchCategory === 'transport';

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
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search places, streets, bus routes..."
            className="h-12 w-full rounded-[18px] border border-neutral-200 bg-white py-2 pl-11 pr-16 text-sm text-neutral-900 shadow-sm shadow-neutral-950/5 outline-none transition placeholder:text-neutral-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-500/15"
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
        <div className="space-y-2">
          <ChipRow label="Filter results by type">
            {categoryFilterChips.map((chip) => (
              <Chip
                key={chip.id}
                selected={searchCategory === chip.id}
                onClick={() => onSearchCategoryChange(chip.id)}
              >
                {chip.label}
              </Chip>
            ))}
          </ChipRow>
          {showTransportFilters ? (
            <div className="space-y-1.5 rounded-xl border border-neutral-100 bg-neutral-50/70 px-2 py-2">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                Transport filters
              </p>
              <ChipRow label="Transport subtype">
                {PUBLIC_SEARCH_TRANSPORT_TYPE_FILTER_CHIPS.map((chip) => (
                  <Chip
                    key={chip.id}
                    selected={searchTransportType === chip.id}
                    onClick={() => onSearchTransportTypeChange(chip.id)}
                  >
                    {chip.label}
                  </Chip>
                ))}
              </ChipRow>
              <ChipRow label="Transport mode">
                {PUBLIC_SEARCH_TRANSPORT_MODE_FILTER_CHIPS.map((chip) => (
                  <Chip
                    key={chip.id}
                    selected={searchTransportMode === chip.id}
                    onClick={() => onSearchTransportModeChange(chip.id)}
                  >
                    {chip.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          ) : null}
          <SearchResults
            results={searchResults}
            selectedSearchResultId={selectedSearchResultId}
            onSelectSearchResult={onSelectSearchResult}
            referenceCoordinates={referenceCoordinates}
            searchLoading={searchLoading}
            searchLoadingMore={searchLoadingMore}
            searchError={searchError}
            searchFetchMoreError={searchFetchMoreError}
            hasMoreSearch={hasMoreSearch}
            searchReachedCap={searchReachedCap}
            onLoadMoreSearch={onLoadMoreSearch}
            onRetrySearch={onRetrySearch}
          />
        </div>
      ) : (
        <SearchEmptyState />
      )}

      <div className="space-y-2">
        <SidebarSectionTitle trailing={categoriesLoading ? 'Loading…' : undefined}>
          Categories
        </SidebarSectionTitle>
        <ChipRow label="Filter places by category">
          <Chip selected={selectedCategoryCode === null} onClick={() => onSelectCategory(null)}>
            All
          </Chip>
          {categories.map((category) => (
            <Chip
              key={category.id}
              selected={selectedCategoryCode === category.code}
              onClick={() => onSelectCategory(category.code)}
            >
              {category.name}
            </Chip>
          ))}
        </ChipRow>
        {categoriesError ? (
          <p className="mt-2 text-xs text-red-600">Could not load categories.</p>
        ) : null}
      </div>

      <div className={sidebarCard}>
        <div className="border-b border-neutral-100 px-3.5 py-2">
          <SidebarSectionTitle
            trailing={placesLoading ? 'Loading…' : `${placesCount ?? pois.length} shown`}
          >
            Visible places
          </SidebarSectionTitle>
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

      {selectedSearchResult ? (
        <div className="sticky bottom-0 z-10 -mx-3.5 -mb-3.5 mt-1 border-t border-neutral-200 bg-white/95 px-3.5 pb-3.5 pt-2.5 backdrop-blur">
          <SelectedResultCard
            result={selectedSearchResult}
            referenceCoordinates={referenceCoordinates}
            loading={selectedResultLoading}
            onClear={onClearSelectedSearchResult}
            onViewDetails={onViewSelectedResultDetails}
          />
        </div>
      ) : null}
    </section>
  );
}

function SearchEmptyState() {
  return (
    <p className="px-1 text-xs leading-5 text-neutral-500">
      Search places, streets, and bus routes. Results stay in the sidebar so the map stays
      visible.
    </p>
  );
}

/** Compact card for the currently selected result; keeps the list visible below. */
function SelectedResultCard({
  result,
  referenceCoordinates,
  loading = false,
  onClear,
  onViewDetails,
}: {
  readonly result: PublicSearchResult;
  readonly referenceCoordinates?: readonly [number, number] | null;
  readonly loading?: boolean;
  readonly onClear?: () => void;
  readonly onViewDetails?: () => void;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const entityType = (result.entityType ?? result.type) as SearchResultType;
  const title = getLocalizedName(result, languageMode);
  const titleClass =
    languageMode === 'both'
      ? 'block whitespace-pre-line break-words text-sm font-semibold text-neutral-950'
      : 'block truncate text-sm font-semibold text-neutral-950';
  const subtitle =
    entityType === 'coordinate'
      ? 'Coordinate location'
      : searchResultSubtitle(result, entityType, referenceCoordinates ?? null);
  // Reverse admin line (township · district · region) for pin-type results.
  const reverseLine = reverseAdminLine(result);
  const canViewDetails = entityType === 'place' && typeof onViewDetails === 'function';

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3 shadow-sm shadow-sky-950/3">
      <div className="flex items-start gap-2.5">
        <SearchResultBadge type={entityType} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
            Selected
          </span>
          <span className={titleClass}>{title}</span>
          <span className="block truncate text-xs text-neutral-600">{subtitle}</span>
          {reverseLine ? (
            <span className="block truncate text-xs text-neutral-500">{reverseLine}</span>
          ) : null}
          <SearchResultBadges result={result} entityType={entityType} />
          {loading ? (
            <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-700">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
              Loading shape…
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {canViewDetails ? (
          <button
            type="button"
            className="h-9 flex-1 basis-24 rounded-xl border border-sky-300 bg-sky-600 px-3 text-sm font-medium text-white transition-colors hover:bg-sky-500"
            onClick={onViewDetails}
          >
            View details
          </button>
        ) : null}
        <button
          type="button"
          className="h-9 flex-1 basis-24 cursor-not-allowed rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-400"
          title="Directions coming soon"
          aria-disabled="true"
          disabled
        >
          Directions
        </button>
        {onClear ? (
          <button
            type="button"
            className="h-9 flex-1 basis-20 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
            onClick={onClear}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SearchResults({
  results,
  selectedSearchResultId,
  onSelectSearchResult,
  referenceCoordinates,
  searchLoading,
  searchLoadingMore,
  searchError,
  searchFetchMoreError,
  hasMoreSearch,
  searchReachedCap,
  onLoadMoreSearch,
  onRetrySearch,
}: {
  readonly results: readonly PublicSearchResult[];
  readonly selectedSearchResultId: string | null;
  readonly onSelectSearchResult: (result: PublicSearchResult) => void;
  readonly referenceCoordinates?: readonly [number, number] | null;
  readonly searchLoading: boolean;
  readonly searchLoadingMore: boolean;
  readonly searchError: boolean;
  readonly searchFetchMoreError: boolean;
  readonly hasMoreSearch: boolean;
  readonly searchReachedCap: boolean;
  readonly onLoadMoreSearch?: () => void;
  readonly onRetrySearch?: () => void;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const hasResults = results.length > 0;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const initialLoading = searchLoading && !hasResults;
  const canLoadMore = hasMoreSearch && !searchReachedCap && !searchLoadingMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canLoadMore || !onLoadMoreSearch) return;

    const root = sentinel.closest('.overflow-y-auto');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreSearch();
        }
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '120px 0px',
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMoreSearch, results.length]);

  return (
    <div className={sidebarCard}>
      <div className="border-b border-neutral-100 px-3.5 py-2">
        <SidebarSectionTitle>Search results</SidebarSectionTitle>
      </div>
      {initialLoading ? (
        <SearchStateMessage title="Searching..." body="Looking across available map data." />
      ) : null}
      {searchError ? (
        <div className="px-3.5 py-3">
          <SearchStateMessage
            tone="error"
            title="Could not load search results."
            body="Check the connection and try again."
          />
          {onRetrySearch ? (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-sky-700 hover:text-sky-800"
              onClick={onRetrySearch}
            >
              Retry search
            </button>
          ) : null}
        </div>
      ) : null}
      {!initialLoading && !searchError && !hasResults ? (
        <SearchStateMessage title="No results found." body="Try another place, street, or route name." />
      ) : null}
      {!searchError && hasResults ? (
        <ul className="divide-y divide-neutral-100" role="listbox" aria-label="Search results">
          {results.map((result) => {
            const selected = result.id === selectedSearchResultId;
            const entityType = (result.entityType ?? result.type) as SearchResultType;
            const title = getLocalizedName(result, languageMode);

            const referenceRequired =
              entityType === 'plus_code' && result.plusCode?.referenceRequired === true;
            const subtitle = referenceRequired
              ? 'Short Plus Code needs map area or current location.'
              : searchResultSubtitle(result, entityType, referenceCoordinates ?? null);

            return (
              <li key={`${result.type}:${result.id}`}>
                <ResultRow
                  selected={selected}
                  onClick={() => onSelectSearchResult(result)}
                  leading={<SearchResultBadge type={entityType} />}
                  title={
                    <span className={resultTitleClass(languageMode === 'both')}>{title}</span>
                  }
                  subtitle={
                    <>
                      <span
                        className={`block truncate text-xs ${
                          referenceRequired ? 'text-amber-700' : 'text-neutral-500'
                        }`}
                      >
                        {subtitle}
                      </span>
                      <SearchResultBadges result={result} entityType={entityType} />
                    </>
                  }
                />
              </li>
            );
          })}
          <li aria-hidden="true">
            <div ref={sentinelRef} className="h-1" />
          </li>
        </ul>
      ) : null}
      {searchLoadingMore ? (
        <SearchStateMessage title="Loading more results..." body="Fetching the next page." />
      ) : null}
      {searchFetchMoreError ? (
        <div className="border-t border-neutral-100 px-3.5 py-3">
          <SearchStateMessage
            tone="error"
            title="Could not load more results."
            body="Scroll again or tap retry."
          />
          {onLoadMoreSearch ? (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-sky-700 hover:text-sky-800"
              onClick={onLoadMoreSearch}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!searchLoading &&
      !searchError &&
      hasResults &&
      !hasMoreSearch &&
      !searchLoadingMore &&
      !searchFetchMoreError ? (
        <p className="border-t border-neutral-100 px-3.5 py-2.5 text-xs text-neutral-500">
          {searchReachedCap
            ? 'Showing the maximum results for this search.'
            : 'No more relevant results.'}
        </p>
      ) : null}
    </div>
  );
}

/** Subtitle: "<type> · <admin area / category> · <distance>". */
function searchResultSubtitle(
  result: PublicSearchResult,
  entityType: SearchResultType,
  reference: readonly [number, number] | null,
): string {
  const typeLabel = searchResultTypeLabel(entityType);
  const area =
    trimmedOrNull(result.adminAreaNameEn) ??
    trimmedOrNull(result.adminAreaNameMy) ??
    trimmedOrNull(result.categoryName) ??
    trimmedOrNull(result.categoryCode) ??
    trimmedOrNull(result.subtitle);
  const distance = formatSearchDistance(result, reference);
  const parts = [typeLabel];
  if (area && area !== typeLabel) parts.push(area);
  if (distance) parts.push(distance);
  return parts.join(' · ');
}

/** "Township · District · Region" from a result's reverse address, or null. */
function reverseAdminLine(result: PublicSearchResult): string | null {
  const reverse = result.reverseAddress;
  if (!reverse) return null;
  const line = [reverse.township, reverse.district, reverse.regionState]
    .map((value) => trimmedOrNull(value))
    .filter((value): value is string => value !== null)
    .join(' · ');
  return line.length > 0 ? line : null;
}

/** Small inline badges: verified, approximate boundary. */
function SearchResultBadges({
  result,
  entityType,
}: {
  readonly result: PublicSearchResult;
  readonly entityType: SearchResultType;
}) {
  const verified = result.isVerified === true;
  const approximateBoundary =
    entityType === 'admin_area' &&
    typeof result.boundaryConfidenceScore === 'number' &&
    result.boundaryConfidenceScore < 60;

  if (!verified && !approximateBoundary) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {verified ? (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
          Verified
        </span>
      ) : null}
      {approximateBoundary ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          Approx. boundary
        </span>
      ) : null}
    </span>
  );
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function searchResultCoordinates(result: PublicSearchResult): readonly [number, number] | null {
  if (result.center && result.center.length >= 2) {
    return [result.center[0], result.center[1]];
  }
  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return [result.lng, result.lat];
  }
  if (result.bbox && result.bbox.length >= 4) {
    const [minLng, minLat, maxLng, maxLat] = result.bbox;
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }
  return null;
}

function formatSearchDistance(
  result: PublicSearchResult,
  reference: readonly [number, number] | null,
): string | null {
  if (!reference) return null;
  const coords = searchResultCoordinates(result);
  if (!coords) return null;
  const meters = haversineMeters(reference[1], reference[0], coords[1], coords[0]);
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km away`;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    <div className={`px-3.5 py-3 ${tone === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-neutral-500">{body}</p>
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
    case 'street_group':
      return { badge: 'St', label: 'Street', className: 'bg-orange-50 text-orange-700' };
    case 'admin_area':
      return { badge: 'A', label: 'Area', className: 'bg-violet-50 text-violet-800' };
    case 'address':
      return { badge: 'Ad', label: 'Address', className: 'bg-blue-50 text-blue-700' };
    case 'bus_route':
    case 'bus_route_variant':
    case 'transport_route':
    case 'transport_route_variant':
      return { badge: 'R', label: 'Route', className: 'bg-cyan-50 text-cyan-700' };
    case 'bus_stop':
    case 'transport_stop':
      return { badge: 'S', label: 'Stop', className: 'bg-amber-50 text-amber-700' };
    case 'transport_terminal':
      return { badge: 'T', label: 'Terminal', className: 'bg-amber-50 text-amber-800' };
    case 'building':
      return { badge: 'Bd', label: 'Building', className: 'bg-stone-100 text-stone-700' };
    case 'water_line':
    case 'water_polygon':
      return { badge: 'W', label: 'Water', className: 'bg-sky-50 text-sky-700' };
    case 'landuse':
      return { badge: 'L', label: 'Land use', className: 'bg-lime-50 text-lime-700' };
    case 'plus_code':
      return { badge: '+', label: 'Plus Code', className: 'bg-indigo-50 text-indigo-700' };
    case 'coordinate':
      return { badge: 'GPS', label: 'Coordinate', className: 'bg-slate-100 text-slate-700' };
    case 'place':
    default:
      return { badge: 'P', label: 'Place', className: 'bg-emerald-50 text-emerald-700' };
  }
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
