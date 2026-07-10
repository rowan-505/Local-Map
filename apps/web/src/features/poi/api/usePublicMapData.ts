import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PublicSearchApiLang } from './publicSearchLang';
import type {
  PublicSearchCategory,
  PublicSearchTransportMode,
  PublicSearchTransportType,
} from './publicSearchConstants.js';
import {
  PUBLIC_SEARCH_PAGE_LIMIT,
  PUBLIC_SEARCH_SESSION_RESULT_CAP,
} from './publicSearchConstants.js';
import {
  fetchPublicCategories,
  fetchPublicMapPlaces,
  fetchPublicPlace,
  fetchPublicPlaces,
  fetchPublicSearchPage,
  fetchSearchResultOverlayGeometry,
  searchResultOverlayQueryKey,
  searchResultOverlayZoomBucket,
  shouldRunPublicSearch,
  type PublicPlacesParams,
  type PublicMapPlacesParams,
  type PublicSearchResult,
} from './publicMapApi';
import {
  formatPublicSearchGeoKey,
  publicSearchGeoBiasFromKey,
  type SearchCenter,
} from './publicSearchGeoBias';
import {
  publicSearchRetryDelay,
  shouldRetryPublicSearch,
} from './publicSearchRetry';
import { isPointLikeHighlight } from '@/features/map/lib/maplibre/searchHighlightOnMap';

export type { SearchCenter };

export function usePublicCategories() {
  return useQuery({
    queryKey: ['public-categories'],
    queryFn: fetchPublicCategories,
  });
}

export function usePublicPlaces(params: Omit<PublicPlacesParams, 'lang'>) {
  return useQuery({
    queryKey: ['public-places', params],
    queryFn: () => fetchPublicPlaces(params),
  });
}

export function usePublicMapPlaces(params: PublicMapPlacesParams | null) {
  return useInfiniteQuery({
    queryKey: ['public-map-places', params],
    queryFn: ({ signal, pageParam }) => {
      if (params === null) {
        throw new Error('Missing public map viewport');
      }
      return fetchPublicMapPlaces({ ...params, offset: pageParam }, signal);
    },
    enabled: params !== null,
    initialPageParam: params?.offset ?? 0,
    getNextPageParam: (lastPage) =>
      lastPage.metadata.has_more
        ? lastPage.metadata.offset + lastPage.metadata.limit
        : undefined,
  });
}

export function usePublicPlace(publicId: string | null) {
  return useQuery({
    queryKey: ['public-place', publicId],
    queryFn: () => fetchPublicPlace(publicId ?? ''),
    enabled: publicId !== null,
  });
}

export type PublicSearchQueryKeyInput = {
  readonly q: string;
  readonly lang: PublicSearchApiLang;
  readonly category: PublicSearchCategory;
  readonly transportType: PublicSearchTransportType;
  readonly transportMode: PublicSearchTransportMode;
  /** Rounded map-center bias captured when the search session starts (`lat,lng` or null). */
  readonly geoKey: string | null;
};

export function publicSearchQueryKey(input: PublicSearchQueryKeyInput) {
  return [
    'public-search',
    {
      q: input.q.trim(),
      lang: input.lang,
      category: input.category,
      transportType: input.transportType,
      transportMode: input.transportMode,
      geoKey: input.geoKey,
    },
  ] as const;
}

export type InfinitePublicSearchParams = {
  readonly q: string;
  readonly lang: PublicSearchApiLang;
  readonly category: PublicSearchCategory;
  readonly transportType: PublicSearchTransportType;
  readonly transportMode: PublicSearchTransportMode;
  readonly geoBias?: SearchCenter | null;
};

/**
 * Cursor-paginated public search (20 per page) for the main map sidebar.
 * Query key includes normalized query, language, filters, and geo bias snapshot.
 */
export function useInfinitePublicSearch(params: InfinitePublicSearchParams) {
  const trimmedQuery = params.q.trim();
  const geoKey = formatPublicSearchGeoKey(params.geoBias);
  const requestGeoBias = publicSearchGeoBiasFromKey(geoKey);

  return useInfiniteQuery({
    queryKey: publicSearchQueryKey({
      q: trimmedQuery,
      lang: params.lang,
      category: params.category,
      transportType: params.transportType,
      transportMode: params.transportMode,
      geoKey,
    }),
    queryFn: ({ pageParam, signal }) =>
      fetchPublicSearchPage(
        {
          q: trimmedQuery,
          lang: params.lang,
          category: params.category,
          transportType: params.transportType,
          mode: params.transportMode,
          limit: PUBLIC_SEARCH_PAGE_LIMIT,
          cursor: pageParam,
          ...(requestGeoBias ?? {}),
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((count, page) => count + page.items.length, 0);
      if (loaded >= PUBLIC_SEARCH_SESSION_RESULT_CAP) return undefined;
      if (!lastPage.hasMore || !lastPage.nextCursor) return undefined;
      return lastPage.nextCursor;
    },
    enabled: shouldRunPublicSearch(trimmedQuery),
    retry: shouldRetryPublicSearch,
    retryDelay: publicSearchRetryDelay,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    maxPages: Math.ceil(PUBLIC_SEARCH_SESSION_RESULT_CAP / PUBLIC_SEARCH_PAGE_LIMIT),
  });
}

/**
 * Single-page public search (first 20 results). Used by lightweight overlays.
 */
export function usePublicSearch(q: string, getCenter?: () => SearchCenter | undefined) {
  const trimmedQuery = q.trim();

  return useQuery({
    queryKey: ['public-search', 'single', trimmedQuery],
    queryFn: ({ signal }) =>
      fetchPublicSearchPage(
        {
          q: trimmedQuery,
          limit: PUBLIC_SEARCH_PAGE_LIMIT,
          ...(getCenter?.() ?? {}),
        },
        signal,
      ).then((page) => page.items),
    enabled: shouldRunPublicSearch(trimmedQuery),
  });
}

/**
 * Cached overlay geometry for the selected search result (areas, streets, routes).
 * Point-like results are skipped. React Query cancels stale in-flight requests.
 */
export function useSearchResultOverlayGeometry(
  result: PublicSearchResult | null,
  zoom: number,
) {
  const entityType = result?.entityType;
  const entityId = result?.entityId;
  const zoomBucket = searchResultOverlayZoomBucket(zoom);
  const enabled =
    result !== null && !!entityType && !!entityId && !isPointLikeHighlight(result);

  return useQuery({
    queryKey:
      entityType && entityId
        ? searchResultOverlayQueryKey(entityType, entityId, zoomBucket)
        : ['search-result-overlay', 'disabled'],
    queryFn: ({ signal }) =>
      fetchSearchResultOverlayGeometry(entityType!, entityId!, zoomBucket, signal),
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
