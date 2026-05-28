import { useMemo } from 'react';

import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import {
  endpointFromSearchResult,
  type RouteEndpoint,
} from '@/features/routing/routeState';
import {
  searchResultAreaLine,
  searchResultCategoryLine,
  searchResultDisplayName,
  formatSearchResultDistance,
} from '@/features/routing/lib/routeSearchDisplay';
import type { RouteInputField } from '@/features/routing/routeState';
import type { UseRouteStateReturn } from '@/features/routing/useRouteState';
import { usePublicSearch } from '@/features/poi/api/usePublicMapData';
import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';

type RouteEndpointSearchOverlayProps = {
  readonly field: RouteInputField;
  readonly route: UseRouteStateReturn;
  readonly languageMode: PlaceLanguageMode;
  /** Map center for optional distance labels — `[lng, lat]`. */
  readonly referenceCoordinates?: readonly [number, number] | null;
};

export function RouteEndpointSearchOverlay({
  field,
  route,
  languageMode,
  referenceCoordinates = null,
}: RouteEndpointSearchOverlayProps) {
  const activeEndpoint = field === 'from' ? route.from : route.to;
  const debouncedQuery = useDebouncedValue(activeEndpoint.label, 300);
  const searchQuery = usePublicSearch(debouncedQuery);

  const headerTitle = field === 'from' ? 'Search from' : 'Search to';

  const applyEndpoint = (endpoint: RouteEndpoint | null) => {
    if (!endpoint) return;
    if (field === 'from') {
      route.setFrom(endpoint);
    } else {
      route.setTo(endpoint);
    }
    route.setActiveInput(null);
  };

  const handleSelectResult = (result: PublicSearchResult) => {
    applyEndpoint(endpointFromSearchResult(result, languageMode));
  };

  const handleChooseOnMap = () => {
    route.setActiveInput(null);
    route.startMapPick(field);
  };

  const trimmedQuery = debouncedQuery.trim();
  const showResults = trimmedQuery.length > 0;
  const results = searchQuery.data ?? [];

  const emptyHint = useMemo(() => {
    if (showResults) return null;
    return 'Type in the field above to search, or choose a point on the map. Coordinates work too (e.g. 16.8661, 96.1951).';
  }, [showResults]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-sky-100 bg-sky-50/40 ring-1 ring-sky-100"
      role="dialog"
      aria-label={headerTitle}
    >
      <div className="flex items-center justify-between gap-2 border-b border-sky-100/80 bg-white/80 px-3 py-2">
        <p className="text-xs font-semibold text-sky-900">{headerTitle}</p>
        <button
          type="button"
          className="rounded-full px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
          onClick={() => route.setActiveInput(null)}
        >
          Close
        </button>
      </div>

      <div className="space-y-2 p-3">
        <OverlayActionButton onClick={handleChooseOnMap}>Choose on map</OverlayActionButton>

        {showResults ? (
          <div className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm shadow-neutral-950/3">
            {searchQuery.isLoading ? (
              <OverlayMessage title="Searching…" body="Looking across available map data." />
            ) : null}
            {searchQuery.isError ? (
              <OverlayMessage
                tone="error"
                title="Could not load results"
                body="Check the connection and try again."
              />
            ) : null}
            {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 ? (
              <OverlayMessage
                title="No results found"
                body="Try another place, street, or area name."
              />
            ) : null}
            {!searchQuery.isLoading && !searchQuery.isError && results.length > 0 ? (
              <ul
                className="max-h-52 divide-y divide-neutral-100 overflow-y-auto"
                role="listbox"
                aria-label={`${field === 'from' ? 'From' : 'To'} search results`}
              >
                {results.map((result) => (
                  <RouteSearchResultRow
                    key={`${result.type}:${result.id}`}
                    result={result}
                    languageMode={languageMode}
                    referenceCoordinates={referenceCoordinates}
                    onSelect={() => handleSelectResult(result)}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : emptyHint ? (
          <p className="px-1 text-[11px] leading-4 text-neutral-500">{emptyHint}</p>
        ) : null}
      </div>
    </div>
  );
}

function RouteSearchResultRow({
  result,
  languageMode,
  referenceCoordinates,
  onSelect,
}: {
  readonly result: PublicSearchResult;
  readonly languageMode: PlaceLanguageMode;
  readonly referenceCoordinates: readonly [number, number] | null;
  readonly onSelect: () => void;
}) {
  const title = searchResultDisplayName(result, languageMode);
  const category = searchResultCategoryLine(result);
  const area = searchResultAreaLine(result);
  const distance = formatSearchResultDistance(result, referenceCoordinates);
  const secondary =
    area && category && area !== category
      ? `${category} · ${area}`
      : (area ?? category ?? null);

  return (
    <li>
      <button
        type="button"
        role="option"
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
        onClick={onSelect}
      >
        <SearchTypeBadge type={result.type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-950">{title}</span>
          {secondary ? (
            <span className="mt-0.5 block truncate text-xs text-neutral-500">{secondary}</span>
          ) : null}
          {distance ? (
            <span className="mt-0.5 block text-[11px] text-neutral-400">{distance}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function SearchTypeBadge({ type }: { readonly type: PublicSearchResult['type'] }) {
  const meta =
    type === 'street'
      ? { badge: 'St', className: 'bg-orange-50 text-orange-700' }
      : type === 'admin_area'
        ? { badge: 'V', className: 'bg-violet-50 text-violet-800' }
        : { badge: 'P', className: 'bg-emerald-50 text-emerald-700' };

  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${meta.className}`}
    >
      {meta.badge}
    </span>
  );
}

function OverlayActionButton({
  children,
  onClick,
}: {
  readonly children: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OverlayMessage({
  title,
  body,
  tone = 'neutral',
}: {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'neutral' | 'error';
}) {
  return (
    <div className={`px-3 py-3 text-sm ${tone === 'error' ? 'text-red-700' : 'text-neutral-600'}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{body}</p>
    </div>
  );
}
