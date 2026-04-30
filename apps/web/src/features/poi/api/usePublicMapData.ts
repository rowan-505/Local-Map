import { useQuery } from '@tanstack/react-query';
import {
  fetchPublicCategories,
  fetchPublicPlace,
  fetchPublicPlaces,
  fetchPublicSearch,
  type PublicPlacesParams,
} from './publicMapApi';

export function usePublicCategories() {
  return useQuery({
    queryKey: ['public-categories'],
    queryFn: fetchPublicCategories,
  });
}

export function usePublicPlaces(params: PublicPlacesParams) {
  return useQuery({
    queryKey: ['public-places', params],
    queryFn: () => fetchPublicPlaces(params),
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
