import { memo, useEffect, useRef } from 'react';
import { mapUiText, useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';
import { shouldAutoLoadMorePublicSearch } from '@/features/poi/api/publicSearchRetry';
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

/** Keep the main sidebar concise without changing API pagination or ranking. */
const SEARCH_PANEL_VISIBLE_RESULT_LIMIT = 10;

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
  /** Current map zoom for “in this area” copy (presentation only). */
  readonly mapZoom?: number | null;
  readonly pois: readonly Poi[];
  readonly placesCount?: number;
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string | null) => void;
  readonly hasMorePlaces?: boolean;
  readonly onLoadMorePlaces?: () => void;
  readonly searchLoading?: boolean;
  readonly searchLoadingMore?: boolean;
  readonly searchError?: boolean;
  readonly searchUnavailable?: boolean;
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
  mapZoom = null,
  pois,
  placesCount,
  selectedPoiId,
  onSelectPoiId,
  hasMorePlaces = false,
  onLoadMorePlaces,
  searchLoading = false,
  searchLoadingMore = false,
  searchError = false,
  searchUnavailable = false,
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
  const t = useMapUiText();
  const languageMode = useMapUiStore((state) => state.languageMode);
  const showSearchResults = searchQuery.trim().length > 0;
  const categoryFilterChips = getVisiblePublicSearchCategoryFilterChips();
  const showTransportFilters = searchCategory === 'transport';
  const orderedCategories = orderBrowseCategories(categories);
  const placesShown = placesCount ?? pois.length;
  const zoomTooLow = typeof mapZoom === 'number' && mapZoom < 12;

  return (
    <section className="space-y-4 p-4 text-sm" aria-label={t('နေရာရှာဖွေရန်', 'Search places')}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-map-muted">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={t('နေရာ သို့မဟုတ် လမ်း ရှာရန်', 'Search the map')}
          className="h-12 w-full rounded-map-control border border-map-border bg-map-surface py-2 pl-11 pr-16 text-sm text-map-ink shadow-map-control transition-colors placeholder:text-map-muted focus:border-map-primary"
          autoComplete="off"
          aria-label={t('မြေပုံ ရှာရန်', 'Search the map')}
        />
        {searchLoading ? (
          <span className="absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-map-border border-t-map-primary" />
        ) : null}
        {searchQuery.length > 0 ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-sm leading-none text-map-muted transition-colors fine-hover:bg-map-bg fine-hover:text-map-ink"
            aria-label={t('ရှာဖွေမှုကို ရှင်းရန်', 'Clear search')}
            onClick={onClearSearch}
          >
            <ClearIcon />
          </button>
        ) : null}
      </div>

      {showSearchResults ? (
        <div className="space-y-3">
          <ChipRow label={t('ရလဒ်အမျိုးအစား စစ်ထုတ်ရန်', 'Filter results by type')}>
            {categoryFilterChips.map((chip) => (
              <Chip
                key={chip.id}
                selected={searchCategory === chip.id}
                onClick={() => onSearchCategoryChange(chip.id)}
              >
                {searchFilterLabel(chip.id, languageMode, chip.label)}
              </Chip>
            ))}
          </ChipRow>
          {showTransportFilters ? (
            <div className="space-y-2 rounded-map-card border border-map-border bg-map-bg px-2 py-2">
              <p className="map-kicker px-1 text-map-muted">
                {t('အများသုံးယာဉ် စစ်ထုတ်ရန်', 'Transport filters')}
              </p>
              <ChipRow label={t('အများသုံးယာဉ်အမျိုးအစား', 'Transport subtype')}>
                {PUBLIC_SEARCH_TRANSPORT_TYPE_FILTER_CHIPS.map((chip) => (
                  <Chip
                    key={chip.id}
                    selected={searchTransportType === chip.id}
                    onClick={() => onSearchTransportTypeChange(chip.id)}
                  >
                    {transportTypeLabel(chip.id, languageMode, chip.label)}
                  </Chip>
                ))}
              </ChipRow>
              <ChipRow label={t('သွားလာမှုပုံစံ', 'Transport mode')}>
                {PUBLIC_SEARCH_TRANSPORT_MODE_FILTER_CHIPS.map((chip) => (
                  <Chip
                    key={chip.id}
                    selected={searchTransportMode === chip.id}
                    onClick={() => onSearchTransportModeChange(chip.id)}
                  >
                    {transportModeLabel(chip.id, languageMode, chip.label)}
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
            searchUnavailable={searchUnavailable}
            searchFetchMoreError={searchFetchMoreError}
            hasMoreSearch={hasMoreSearch}
            searchReachedCap={searchReachedCap}
            onLoadMoreSearch={onLoadMoreSearch}
            onRetrySearch={onRetrySearch}
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <SidebarSectionTitle trailing={categoriesLoading ? t('ဖွင့်နေသည်…', 'Loading…') : undefined}>
              {t('အမျိုးအစားများ', 'Categories')}
            </SidebarSectionTitle>
            <ChipRow label={t('နေရာအမျိုးအစား စစ်ထုတ်ရန်', 'Filter places by category')}>
              <Chip selected={selectedCategoryCode === null} onClick={() => onSelectCategory(null)}>
                {t('အားလုံး', 'All')}
              </Chip>
              {orderedCategories.map((category) => (
                <Chip
                  key={category.id}
                  selected={selectedCategoryCode === category.code}
                  onClick={() => onSelectCategory(category.code)}
                >
                  {categoryDisplayName(category, languageMode)}
                </Chip>
              ))}
            </ChipRow>
            {categoriesError ? (
              <p className="mt-2 text-xs text-map-error">
                {t('အမျိုးအစားများ မရပါ။', 'Categories unavailable.')}
              </p>
            ) : null}
          </div>

          <div className={sidebarCard}>
            <div className="border-b border-map-border px-3.5 py-2.5">
              <SidebarSectionTitle
                trailing={
                  placesLoading
                    ? t('ဖွင့်နေသည်…', 'Loading…')
                    : zoomTooLow
                      ? undefined
                      : t(`${placesShown} နေရာ`, `${placesShown} places`)
                }
              >
                {t('အနီးအနား', 'Nearby')}
              </SidebarSectionTitle>
            </div>
            {zoomTooLow ? (
              <p className="px-3.5 py-4 text-sm leading-6 text-map-muted">
                {t('အနီးအနားကြည့်ရန် ချဲ့ပါ။', 'Zoom in to browse nearby.')}
              </p>
            ) : (
              <>
                <PoiList
                  pois={pois}
                  selectedPoiId={selectedPoiId}
                  onSelectPoiId={onSelectPoiId}
                  isLoading={placesLoading}
                  error={placesError}
                />
                {!placesLoading && !placesError && hasMorePlaces ? (
                  <div className="border-t border-map-border p-2.5">
                    <button
                      type="button"
                      className="flex h-11 w-full items-center justify-center rounded-map-control border border-map-border bg-map-surface px-3 text-sm font-semibold text-map-ink transition-colors fine-hover:bg-map-bg disabled:cursor-wait disabled:opacity-60 lg:h-10"
                      onClick={onLoadMorePlaces}
                      disabled={placesLoadingMore}
                    >
                      {placesLoadingMore
                        ? t('ထပ်မံဖွင့်နေသည်…', 'Loading more...')
                        : t('ထပ်ကြည့်ရန်', 'Load more')}
                    </button>
                    {placesLoadMoreError ? (
                      <p className="mt-2 text-center text-xs text-map-error">
                        {t('ထပ်ဖွင့်၍မရပါ။', 'Could not load more.')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      )}

      {selectedSearchResult ? (
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-1 border-t border-map-border bg-map-surface px-4 pb-4 pt-2.5">
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

const PREFERRED_CATEGORY_ORDER = [
  'food',
  'health',
  'transport',
  'transit',
  'bus',
  'shopping',
  'education',
] as const;

function orderBrowseCategories(categories: readonly PoiCategory[]): readonly PoiCategory[] {
  const preferred: PoiCategory[] = [];
  const rest: PoiCategory[] = [];
  const preferredSet = new Set<string>(PREFERRED_CATEGORY_ORDER);

  for (const category of categories) {
    const code = category.code.toLowerCase();
    if (preferredSet.has(code) || PREFERRED_CATEGORY_ORDER.some((p) => code.includes(p))) {
      preferred.push(category);
    } else {
      rest.push(category);
    }
  }

  preferred.sort((a, b) => {
    const ai = PREFERRED_CATEGORY_ORDER.findIndex((p) => a.code.toLowerCase().includes(p));
    const bi = PREFERRED_CATEGORY_ORDER.findIndex((p) => b.code.toLowerCase().includes(p));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return [...preferred, ...rest];
}

function categoryDisplayName(category: PoiCategory, languageMode: PlaceLanguageMode): string {
  const code = category.code.toLowerCase();
  if (code.includes('food')) return mapUiText(languageMode, 'စားသောက်ဆိုင်', 'Food');
  if (code.includes('health')) return mapUiText(languageMode, 'ကျန်းမာရေး', 'Health');
  if (code.includes('transport') || code.includes('transit') || code.includes('bus')) {
    return mapUiText(languageMode, 'အများသုံးယာဉ်', 'Transport');
  }
  if (code.includes('shop')) return mapUiText(languageMode, 'ဈေးဝယ်ရန်', 'Shopping');
  if (code.includes('educat') || code.includes('school')) {
    return mapUiText(languageMode, 'ပညာရေး', 'Education');
  }
  return category.name;
}

function searchFilterLabel(
  id: PublicSearchCategory,
  languageMode: PlaceLanguageMode,
  fallback: string,
): string {
  const labels: Partial<Record<PublicSearchCategory, string>> = {
    all: 'အားလုံး',
    places: 'နေရာများ',
    areas: 'ဧရိယာများ',
    roads: 'လမ်းများ',
    transport: 'အများသုံးယာဉ်',
    addresses: 'လိပ်စာများ',
  };
  return mapUiText(languageMode, labels[id] ?? fallback, fallback);
}

function transportTypeLabel(
  id: PublicSearchTransportType,
  languageMode: PlaceLanguageMode,
  fallback: string,
): string {
  const labels: Record<PublicSearchTransportType, string> = {
    all: 'အားလုံး',
    stops: 'မှတ်တိုင်များ',
    stations: 'ဘူတာများ',
    terminals: 'ဂိတ်များ',
    routes: 'လမ်းကြောင်းများ',
  };
  return mapUiText(languageMode, labels[id], fallback);
}

function transportModeLabel(
  id: PublicSearchTransportMode,
  languageMode: PlaceLanguageMode,
  fallback: string,
): string {
  const labels: Record<PublicSearchTransportMode, string> = {
    all: 'အားလုံး',
    bus: 'ဘတ်စ်',
    train: 'ရထား',
    express: 'အဝေးပြေး',
    ferry: 'ကူးတို့',
    flight: 'လေယာဉ်',
    other: 'အခြား',
  };
  return mapUiText(languageMode, labels[id], fallback);
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
  const t = useMapUiText();
  const entityType = (result.entityType ?? result.type) as SearchResultType;
  const title = getLocalizedName(result, languageMode);
  const titleClass =
    languageMode === 'both'
      ? 'block whitespace-pre-line break-words text-sm font-semibold text-map-ink'
      : 'block truncate text-sm font-semibold text-map-ink';
  const subtitle =
    entityType === 'coordinate'
      ? t('ကိုဩဒိနိတ်', 'Coordinates')
      : searchResultSubtitle(result, entityType, referenceCoordinates ?? null, languageMode);
  // Reverse admin line (township · district · region) for pin-type results.
  const reverseLine = reverseAdminLine(result);
  const canViewDetails = entityType === 'place' && typeof onViewDetails === 'function';

  return (
    <div className="rounded-map-card border border-map-primary/20 bg-map-primary-soft p-3">
      <div className="flex items-start gap-2.5">
        <SearchResultBadge type={entityType} />
        <span className="min-w-0 flex-1">
          <span className="map-kicker block text-map-primary">
            {t('ရွေးထားသည်', 'Selected')}
          </span>
          <span className={titleClass}>{title}</span>
          <span className="block truncate text-xs text-map-muted">{subtitle}</span>
          {reverseLine ? (
            <span className="block truncate text-xs text-map-muted">{reverseLine}</span>
          ) : null}
          <SearchResultBadges result={result} entityType={entityType} />
          {loading ? (
            <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-map-primary">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-map-primary/20 border-t-map-primary" />
              {t('နယ်နိမိတ် ဖွင့်နေသည်…', 'Loading boundary…')}
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {canViewDetails ? (
          <button
            type="button"
            className="h-11 flex-1 basis-24 rounded-map-control border border-map-primary bg-map-primary px-3 text-sm font-semibold text-white shadow-map-control transition-colors fine-hover:bg-map-primary-hover lg:h-10"
            onClick={onViewDetails}
          >
            {t('အသေးစိတ်ကြည့်ရန်', 'View details')}
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            className="h-11 flex-1 basis-20 rounded-map-control border border-map-border bg-map-surface px-3 text-sm font-semibold text-map-ink transition-colors fine-hover:bg-map-bg lg:h-10"
            onClick={onClear}
          >
            {t('ရှင်းရန်', 'Clear')}
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
  searchUnavailable,
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
  readonly searchUnavailable: boolean;
  readonly searchFetchMoreError: boolean;
  readonly hasMoreSearch: boolean;
  readonly searchReachedCap: boolean;
  readonly onLoadMoreSearch?: () => void;
  readonly onRetrySearch?: () => void;
}) {
  const languageMode = useMapUiStore((s) => s.languageMode);
  const t = useMapUiText();
  const hasResults = results.length > 0;
  const visibleResults = results.slice(0, SEARCH_PANEL_VISIBLE_RESULT_LIMIT);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const initialLoading = searchLoading && !hasResults;
  const canLoadMore =
    results.length < SEARCH_PANEL_VISIBLE_RESULT_LIMIT &&
    shouldAutoLoadMorePublicSearch({
      hasMoreSearch,
      searchReachedCap,
      searchLoadingMore,
      searchFetchMoreError,
    });

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
      <div className="border-b border-map-border/70 px-3.5 py-2">
        <SidebarSectionTitle>{t('ရှာဖွေမှုရလဒ်များ', 'Search results')}</SidebarSectionTitle>
      </div>
      {initialLoading ? (
        <SearchResultSkeleton />
      ) : null}
      {searchError ? (
        <div className="px-3.5 py-3">
          <SearchStateMessage
            tone="error"
            title={t('ရလဒ်များ မရပါ။', 'Results unavailable.')}
            body={
              searchUnavailable
                ? t(
                    'ရှာဖွေမှု အချိန်ကြာနေသည်။ ခဏနေ ပြန်ကြိုးစားပါ။',
                    'Search took too long. Please retry.',
                  )
                : t('ချိတ်ဆက်မှုကို စစ်ဆေးပါ။', 'Check your connection.')
            }
          />
          {onRetrySearch ? (
            <button
              type="button"
              className="mt-2 inline-flex min-h-10 items-center rounded-map-control px-2 text-sm font-semibold text-map-primary fine-hover:bg-map-primary-soft fine-hover:text-map-primary-hover"
              onClick={onRetrySearch}
            >
              {t('ပြန်ရှာရန်', 'Retry search')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!initialLoading && !searchError && !hasResults ? (
        <SearchStateMessage
          title={t('ရလဒ်မတွေ့ပါ။', 'No results found.')}
          body={t('အခြားအမည်ဖြင့် ရှာပါ။', 'Try another name.')}
        />
      ) : null}
      {!searchError && hasResults ? (
        <ul
          className="divide-y divide-map-border/65"
          role="listbox"
          aria-label={t('ရှာဖွေမှုရလဒ်များ', 'Search results')}
        >
          {visibleResults.map((result) => {
            const selected = result.id === selectedSearchResultId;
            const entityType = (result.entityType ?? result.type) as SearchResultType;
            const title = getLocalizedName(result, languageMode);

            const referenceRequired =
              entityType === 'plus_code' && result.plusCode?.referenceRequired === true;
            const subtitle = referenceRequired
              ? t(
                  'Plus Code အတိုအတွက် တည်နေရာလိုသည်။',
                  'Short Plus Code needs a location.',
                )
              : searchResultSubtitle(result, entityType, referenceCoordinates ?? null, languageMode);

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
                          referenceRequired ? 'text-amber-700' : 'text-map-muted'
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
        <SearchStateMessage
          title={t('ရလဒ်များ ထပ်ဖွင့်နေသည်…', 'Loading more results...')}
          body={t('နောက်ထပ်ရလဒ်များ ရယူနေသည်။', 'Fetching more results.')}
        />
      ) : null}
      {searchFetchMoreError ? (
        <div className="border-t border-map-border/70 px-3.5 py-3">
          <SearchStateMessage
            tone="error"
            title={t('ထပ်ဖွင့်၍မရပါ။', 'Could not load more.')}
            body={t('ပြန်ကြိုးစားပါ။', 'Try again.')}
          />
          {onLoadMoreSearch ? (
            <button
              type="button"
              className="mt-2 inline-flex min-h-10 items-center rounded-map-control px-2 text-sm font-semibold text-map-primary fine-hover:bg-map-primary-soft fine-hover:text-map-primary-hover"
              onClick={onLoadMoreSearch}
            >
              {t('ပြန်ကြိုးစားရန်', 'Retry')}
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
        <p className="border-t border-map-border/70 px-3.5 py-2.5 text-xs text-map-muted">
          {searchReachedCap
            ? t('ရလဒ်အားလုံး ပြထားသည်။', 'All results shown.')
            : t('ရလဒ်ကုန်ပါပြီ။', 'End of results.')}
        </p>
      ) : null}
    </div>
  );
}

/** Stable three-row placeholder: immediate feedback without layout shifts. */
function SearchResultSkeleton() {
  const t = useMapUiText();
  return (
    <div
      className="divide-y divide-map-border/65"
      role="status"
      aria-label={t('ရှာဖွေနေသည်', 'Searching')}
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-3.5 py-3" aria-hidden="true">
          <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-map-border/60" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-map-border/70" />
            <span className="block h-3 w-1/2 animate-pulse rounded bg-map-border/45" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Subtitle: "<type> · <admin area / category> · <distance>". */
function searchResultSubtitle(
  result: PublicSearchResult,
  entityType: SearchResultType,
  reference: readonly [number, number] | null,
  languageMode: PlaceLanguageMode,
): string {
  const typeLabel = searchResultTypeLabel(result, entityType, languageMode);
  const area =
    trimmedOrNull(result.adminAreaNameEn) ??
    trimmedOrNull(result.adminAreaNameMy) ??
    trimmedOrNull(result.categoryName) ??
    trimmedOrNull(result.categoryCode) ??
    trimmedOrNull(result.subtitle);
  const distance = formatSearchDistance(result, reference, languageMode);
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
  const t = useMapUiText();
  const verified = result.isVerified === true;
  const approximateBoundary =
    entityType === 'admin_area' &&
    typeof result.boundaryConfidenceScore === 'number' &&
    result.boundaryConfidenceScore < 60;

  if (!verified && !approximateBoundary) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {verified ? (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
          {t('အတည်ပြုပြီး', 'Verified')}
        </span>
      ) : null}
      {approximateBoundary ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
          {t('ခန့်မှန်းနယ်နိမိတ်', 'Approx. boundary')}
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
  languageMode: PlaceLanguageMode,
): string | null {
  if (!reference) return null;
  const coords = searchResultCoordinates(result);
  if (!coords) return null;
  const meters = haversineMeters(reference[1], reference[0], coords[1], coords[0]);
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) {
    return mapUiText(languageMode, `${Math.round(meters)} မီတာ အကွာ`, `${Math.round(meters)} m away`);
  }
  const kilometers = (meters / 1000).toFixed(meters >= 10_000 ? 0 : 1);
  return mapUiText(languageMode, `${kilometers} ကီလိုမီတာ အကွာ`, `${kilometers} km away`);
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
    <div className={`px-3.5 py-3 ${tone === 'error' ? 'text-red-700' : 'text-map-ink/80'}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-map-muted">{body}</p>
    </div>
  );
}

function SearchResultBadge({ type }: { readonly type: SearchResultType }) {
  const meta = searchResultTypeMeta(type);

  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${meta.className}`}
    >
      {meta.badge}
    </span>
  );
}

function searchResultTypeLabel(
  result: PublicSearchResult,
  type: SearchResultType,
  languageMode: PlaceLanguageMode,
): string {
  const mode = result.mode?.trim().toLowerCase();
  const isBus = mode === 'bus' || type === 'bus_route' || type === 'bus_stop';

  if (
    type === 'transport_route' ||
    type === 'transport_route_variant' ||
    type === 'bus_route' ||
    type === 'bus_route_variant'
  ) {
    return isBus
      ? mapUiText(languageMode, 'ဘတ်စ် လမ်းကြောင်း', 'Bus route')
      : mapUiText(languageMode, 'အများသုံးယာဉ် လမ်းကြောင်း', 'Transport route');
  }

  if (type === 'transport_stop' || type === 'bus_stop') {
    return isBus
      ? mapUiText(languageMode, 'ဘတ်စ်မှတ်တိုင်', 'Bus stop')
      : mapUiText(languageMode, 'အများသုံးယာဉ် မှတ်တိုင်', 'Transport stop');
  }

  if (type === 'transport_terminal') {
    return mode === 'bus'
      ? mapUiText(languageMode, 'ဘတ်စ်ဂိတ်', 'Bus terminal')
      : mapUiText(languageMode, 'အများသုံးယာဉ်ဂိတ်', 'Transport terminal');
  }

  if (type === 'admin_area' || type === 'settlement') {
    return mapUiText(languageMode, 'မြို့နယ် / ဧရိယာ', 'Township / Area');
  }

  const meta = searchResultTypeMeta(type);
  return mapUiText(languageMode, meta.labelMy, meta.label);
}

function searchResultTypeMeta(type: SearchResultType): {
  readonly badge: string;
  readonly label: string;
  readonly labelMy: string;
  readonly className: string;
} {
  switch (type) {
    case 'street':
    case 'street_group':
      return { badge: 'St', label: 'Street', labelMy: 'လမ်း', className: 'bg-orange-50 text-orange-700' };
    case 'admin_area':
      return { badge: 'A', label: 'Area', labelMy: 'ဧရိယာ', className: 'bg-violet-50 text-violet-800' };
    case 'settlement':
      return { badge: 'Set', label: 'Settlement', labelMy: 'အခြေချရာ', className: 'bg-teal-50 text-teal-800' };
    case 'address':
      return { badge: 'Ad', label: 'Address', labelMy: 'လိပ်စာ', className: 'bg-blue-50 text-blue-700' };
    case 'bus_route':
    case 'bus_route_variant':
    case 'transport_route':
    case 'transport_route_variant':
      return { badge: 'R', label: 'Route', labelMy: 'လမ်းကြောင်း', className: 'bg-cyan-50 text-cyan-700' };
    case 'bus_stop':
    case 'transport_stop':
      return { badge: 'S', label: 'Stop', labelMy: 'မှတ်တိုင်', className: 'bg-amber-50 text-amber-700' };
    case 'transport_terminal':
      return { badge: 'T', label: 'Terminal', labelMy: 'ဂိတ်', className: 'bg-amber-50 text-amber-800' };
    case 'building':
      return { badge: 'Bd', label: 'Building', labelMy: 'အဆောက်အအုံ', className: 'bg-stone-100 text-stone-700' };
    case 'water_line':
    case 'water_polygon':
      return { badge: 'W', label: 'Water', labelMy: 'ရေ', className: 'bg-sky-50 text-sky-700' };
    case 'land_area':
    case 'landuse':
      return { badge: 'L', label: 'Land use', labelMy: 'မြေအသုံးပြုမှု', className: 'bg-lime-50 text-lime-700' };
    case 'plus_code':
      return { badge: '+', label: 'Plus Code', labelMy: 'Plus Code', className: 'bg-indigo-50 text-indigo-700' };
    case 'coordinate':
      return { badge: 'GPS', label: 'Coordinate', labelMy: 'ကိုဩဒိနိတ်', className: 'bg-slate-100 text-slate-700' };
    case 'place':
    default:
      return { badge: 'P', label: 'Place', labelMy: 'နေရာ', className: 'bg-emerald-50 text-emerald-700' };
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
