import { useQuery, useQueries } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
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
  const lang = useMapUiStore((s) => s.languageMode);

  return useQuery({
    queryKey: ['public-places', params, lang],
    queryFn: () => fetchPublicPlaces({ ...params, lang }),
  });
}

export function usePublicPlace(publicId: string | null) {
  const lang = useMapUiStore((s) => s.languageMode);

  return useQuery({
    queryKey: ['public-place', publicId, lang],
    queryFn: () => fetchPublicPlace(publicId ?? '', lang),
    enabled: publicId !== null,
  });
}

export function usePublicSearch(q: string) {
  const lang = useMapUiStore((s) => s.languageMode);
  const trimmedQuery = q.trim();

  return useQuery({
    queryKey: ['public-search', trimmedQuery, lang],
    queryFn: () => fetchPublicSearch(trimmedQuery, lang),
    enabled: trimmedQuery.length > 0,
  });
}

/** Labels + geometries for `/public/map/geo/*` — each feature.Properties.name matches API `lang`. */
export function usePublicMapGeoLabelQueries() {
  const lang = useMapUiStore((s) => s.languageMode);

  return useQueries({
    queries: [
      {
        queryKey: ['public-map-geo', 'streets', lang],
        queryFn: () => fetchPublicMapGeoJson('streets', lang),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'admin-areas', lang],
        queryFn: () => fetchPublicMapGeoJson('admin-areas', lang),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'bus-stops', lang],
        queryFn: () => fetchPublicMapGeoJson('bus-stops', lang),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
      {
        queryKey: ['public-map-geo', 'bus-routes', lang],
        queryFn: () => fetchPublicMapGeoJson('bus-routes', lang),
        placeholderData: (previousData: FeatureCollection | undefined) => previousData,
      },
    ],
  });
}
