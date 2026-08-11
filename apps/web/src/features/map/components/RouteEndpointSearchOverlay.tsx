import { useMemo } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';

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
  const t = useMapUiText();
  const activeEndpoint = field === 'from' ? route.from : route.to;
  const debouncedQuery = useDebouncedValue(activeEndpoint.label, 300);
  const searchQuery = usePublicSearch(debouncedQuery);

  const headerTitle =
    field === 'from'
      ? t('စတင်ရာ ရှာရန်', 'Search from')
      : t('သွားမည့်နေရာ ရှာရန်', 'Search to');

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
    return t('အမည်ရိုက်ပါ၊ သို့မဟုတ် မြေပုံမှ ရွေးပါ။', 'Type a name or pick on the map.');
  }, [showResults, t]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-map-card border border-map-primary/15 bg-map-primary-soft/45 ring-1 ring-map-primary/10"
      role="dialog"
      aria-label={headerTitle}
    >
      <div className="flex items-center justify-between gap-2 border-b border-map-primary/10 bg-white/85 px-3 py-2">
        <p className="text-xs font-semibold text-map-primary">{headerTitle}</p>
        <button
          type="button"
          className="rounded-full px-2 py-1 text-xs font-medium text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
          onClick={() => route.setActiveInput(null)}
        >
          {t('ပိတ်ရန်', 'Close')}
        </button>
      </div>

      <div className="space-y-2 p-3">
        <OverlayActionButton onClick={handleChooseOnMap}>
          {t('မြေပုံမှ ရွေးရန်', 'Choose on map')}
        </OverlayActionButton>

        {showResults ? (
          <div className="overflow-hidden rounded-map-card border border-map-border bg-map-surface shadow-map-card">
            {searchQuery.isLoading ? (
              <OverlayMessage
                title={t('ရှာဖွေနေသည်…', 'Searching…')}
                body={t('မြေပုံဒေတာကို စစ်ဆေးနေသည်။', 'Checking map data.')}
              />
            ) : null}
            {searchQuery.isError ? (
              <OverlayMessage
                tone="error"
                title={t('ရလဒ်များ မရပါ', 'Results unavailable')}
                body={t('ချိတ်ဆက်မှုကို စစ်ဆေးပါ။', 'Check your connection.')}
              />
            ) : null}
            {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 ? (
              <OverlayMessage
                title={t('ရလဒ်မတွေ့ပါ', 'No results found')}
                body={t('အခြားအမည်ဖြင့် ရှာပါ။', 'Try another name.')}
              />
            ) : null}
            {!searchQuery.isLoading && !searchQuery.isError && results.length > 0 ? (
              <ul
                className="max-h-52 divide-y divide-map-border/65 overflow-y-auto"
                role="listbox"
                aria-label={t(
                  `${field === 'from' ? 'စတင်ရာ' : 'သွားမည့်နေရာ'} ရှာဖွေမှုရလဒ်များ`,
                  `${field === 'from' ? 'From' : 'To'} search results`,
                )}
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
          <p className="px-1 text-xs leading-4 text-map-muted">{emptyHint}</p>
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
  const rawDistance = formatSearchResultDistance(result, referenceCoordinates);
  const distance =
    languageMode === 'en'
      ? rawDistance
      : rawDistance
          ?.replace(' km away', ' ကီလိုမီတာ အကွာ')
          .replace(' m away', ' မီတာ အကွာ') ?? null;
  const secondary =
    area && category && area !== category
      ? `${category} · ${area}`
      : (area ?? category ?? null);

  return (
    <li>
      <button
        type="button"
        role="option"
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-map-primary-soft/70"
        onClick={onSelect}
      >
        <SearchTypeBadge type={result.type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-map-ink">{title}</span>
          {secondary ? (
            <span className="mt-0.5 block truncate text-xs text-map-muted">{secondary}</span>
          ) : null}
          {distance ? (
            <span className="mt-0.5 block text-xs text-map-muted/75">{distance}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function SearchTypeBadge({ type }: { readonly type: PublicSearchResult['type'] }) {
  const meta =
    type === 'street' || type === 'street_group'
      ? { badge: 'St', className: 'bg-orange-50 text-orange-700' }
      : type === 'admin_area'
        ? { badge: 'V', className: 'bg-violet-50 text-violet-800' }
        : { badge: 'P', className: 'bg-emerald-50 text-emerald-700' };

  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${meta.className}`}
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
      className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary"
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
    <div className={`px-3 py-3 text-sm ${tone === 'error' ? 'text-red-700' : 'text-map-muted'}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-map-muted">{body}</p>
    </div>
  );
}
