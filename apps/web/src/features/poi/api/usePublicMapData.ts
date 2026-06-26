import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchPublicCategories,
  fetchPublicMapPlaces,
  fetchPublicPlace,
  fetchPublicPlaces,
  fetchPublicSearch,
  shouldRunPublicSearch,
  type PublicPlacesParams,
  type PublicMapPlacesParams,
  type PublicSearchParams,
} from './publicMapApi';

/** Captured lazily when a request starts (not part of the query key). */
export type SearchCenter = Pick<PublicSearchParams, 'lat' | 'lng'>;

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

/**
 * Public search query.
 *
 * The map center is intentionally NOT part of the query key: it is read lazily
 * via `getCenter()` at the moment the request starts, so panning/zooming (and the
 * `flyTo` from clicking a result) never re-key or refetch the search. Stale-response
 * protection and request cancellation are handled by React Query (key = query only,
 * `signal` aborts the previous in-flight request).
 */
export function usePublicSearch(q: string, getCenter?: () => SearchCenter | undefined) {
  const trimmedQuery = q.trim();

  return useQuery({
    queryKey: ['public-search', trimmedQuery],
    queryFn: ({ signal }) =>
      fetchPublicSearch({ q: trimmedQuery, ...(getCenter?.() ?? {}) }, signal),
    enabled: shouldRunPublicSearch(trimmedQuery),
  });
}
