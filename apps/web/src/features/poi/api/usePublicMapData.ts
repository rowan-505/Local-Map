import { useQuery, useQueries } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import {
  fetchPublicCategories,
  fetchPublicMapGeoJson,
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

export function usePublicPlaces(params: Omit<PublicPlacesParams, 'lang'>) {
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

/** Labels + geometries for `/public/map/geo/*` — features carry `name_mm` / `name_en` for MapLibre. */
export function usePublicMapGeoLabelQueries() {
  return useQueries({
    queries: [
      {
        queryKey: ['public-map-geo', 'streets'],
        queryFn: () => fetchPublicMapGeoJson('streets'),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'admin-areas'],
        queryFn: () => fetchPublicMapGeoJson('admin-areas'),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'bus-stops'],
        queryFn: () => fetchPublicMapGeoJson('bus-stops'),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'bus-routes'],
        queryFn: () => fetchPublicMapGeoJson('bus-routes'),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
    ],
  });
}
