import { memo, useEffect, useRef, useState } from 'react';
import type {
  PlaceLanguageMode,
  PublicSearchResult,
} from '@/features/poi/api/publicMapApi';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PoiCategory, PoiCategoryCode } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';

type Props = {
  readonly categories: readonly PoiCategory[];
  readonly selectedCategoryCode: PoiCategoryCode | null;
  readonly onSelectCategory: (code: PoiCategoryCode | null) => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
  readonly searchResults: readonly PublicSearchResult[];
  readonly selectedSearchResultId: string | null;
  readonly onSelectSearchResult: (result: PublicSearchResult) => void;
  readonly onClearSearch: () => void;
  readonly selectedLanguageMode: PlaceLanguageMode;
  readonly onSelectLanguageMode: (mode: PlaceLanguageMode) => void;
  readonly searchLoading?: boolean;
  readonly searchError?: boolean;
  readonly categoriesLoading?: boolean;
  readonly categoriesError?: boolean;
};

function FilterBarInner({
  categories,
  selectedCategoryCode,
  onSelectCategory,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  selectedSearchResultId,
  onSelectSearchResult,
  onClearSearch,
  selectedLanguageMode,
  onSelectLanguageMode,
  searchLoading = false,
  searchError = false,
  categoriesLoading = false,
  categoriesError = false,
}: Props) {
  const languageMode = useMapUiStore((s) => s.languageMode);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const showDropdown = dropdownOpen && searchQuery.trim().length > 0;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const handleSelectSearchResult = (result: PublicSearchResult) => {
    onSelectSearchResult(result);
    setDropdownOpen(false);
  };

  return (
    <header
      className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2"
      role="banner"
    >
      <div ref={searchBoxRef} className="relative">
        <span className="sr-only">Search places</span>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
          Search
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => {
            onSearchQueryChange(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search places or streets…"
          className="h-12 w-full rounded-2xl border border-white/80 bg-white/95 py-2 pl-16 pr-20 text-sm text-neutral-900 shadow-lg shadow-neutral-900/10 outline-none backdrop-blur placeholder:text-neutral-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
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
            onClick={() => {
              onClearSearch();
              setDropdownOpen(false);
            }}
          >
            x
          </button>
        ) : null}

        {showDropdown ? (
          <div className="absolute left-0 top-full z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-neutral-200/80 bg-white py-2 text-sm shadow-xl shadow-neutral-900/15">
            {searchLoading ? (
              <div className="px-4 py-4 text-xs text-neutral-500">Searching…</div>
            ) : null}
            {searchError ? (
              <div className="px-4 py-4 text-xs text-red-600">Could not load search results.</div>
            ) : null}
            {!searchLoading && !searchError && searchResults.length === 0 ? (
              <div className="px-4 py-4 text-xs text-neutral-500">No places or streets found.</div>
            ) : null}
            {!searchLoading && !searchError
              ? searchResults.map((result) => {
                  const selected = result.id === selectedSearchResultId;
                  const title = getLocalizedName(result, languageMode);
                  const titleClass =
                    languageMode === 'both'
                      ? 'block whitespace-pre-line break-words text-sm font-semibold'
                      : 'block truncate text-sm font-semibold';
                  return (
                    <button
                      type="button"
                      key={`${result.type}:${result.id}`}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                        selected
                          ? 'bg-sky-50 text-sky-950'
                          : 'text-neutral-800 hover:bg-neutral-50'
                      }`}
                      onClick={() => handleSelectSearchResult(result)}
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        result.type === 'street'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {result.type === 'street' ? 'St' : 'P'}
                      </span>
                      <span className="min-w-0">
                        <span className={titleClass}>{title}</span>
                        <span className="block truncate text-xs text-neutral-500">
                          {result.subtitle ??
                            result.categoryName ??
                            result.categoryCode ??
                            (result.type === 'street' ? 'Street' : 'Place')}
                        </span>
                      </span>
                    </button>
                  );
                })
              : null}
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-lg shadow-neutral-900/10 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedCategoryCode === null
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'bg-transparent text-neutral-700 hover:bg-neutral-100'
            }`}
            onClick={() => onSelectCategory(null)}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategoryCode === category.code
                  ? 'bg-neutral-900 text-white shadow-sm'
                  : 'bg-transparent text-neutral-700 hover:bg-neutral-100'
              }`}
              onClick={() => onSelectCategory(category.code)}
            >
              {category.name}
            </button>
          ))}
          {categoriesLoading ? (
            <span className="shrink-0 px-3 py-1.5 text-xs text-neutral-500">Loading categories…</span>
          ) : null}
          {categoriesError ? (
            <span className="shrink-0 px-3 py-1.5 text-xs text-red-600">Could not load categories</span>
          ) : null}
        </div>
        <div className="flex shrink-0 rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-lg shadow-neutral-900/10 backdrop-blur">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.mode}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedLanguageMode === option.mode
                  ? 'bg-neutral-900 text-white shadow-sm'
                  : 'bg-transparent text-neutral-700 hover:bg-neutral-100'
              }`}
              onClick={() => onSelectLanguageMode(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

const LANGUAGE_OPTIONS: readonly {
  readonly mode: PlaceLanguageMode;
  readonly label: string;
}[] = [
  { mode: 'my', label: 'မြန်မာ' },
  { mode: 'en', label: 'English' },
  { mode: 'both', label: 'Both' },
];

/** Skips re-renders when filter/search props are unchanged (e.g. map selection only). */
export const FilterBar = memo(FilterBarInner);
