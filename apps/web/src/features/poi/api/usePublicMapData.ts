import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchPublicCategories,
  fetchPublicMapPlaces,
  fetchPublicPlace,
  fetchPublicPlaces,
  fetchPublicSearch,
  type PublicPlacesParams,
  type PublicMapPlacesParams,
} from './publicMapApi';

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

export function usePublicSearch(q: string) {
  const trimmedQuery = q.trim();

  return useQuery({
    queryKey: ['public-search', trimmedQuery],
    queryFn: () => fetchPublicSearch(trimmedQuery),
    enabled: trimmedQuery.length > 0,
  });
}
