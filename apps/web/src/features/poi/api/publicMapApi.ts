import type { Poi, PoiCategory } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

type PublicCategoryDto = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameLocal: string | null;
  readonly iconKey: string | null;
  readonly sortOrder: number;
};

type PublicPlaceDto = {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly categoryId: string;
  readonly categoryCode: string | null;
  readonly categoryName: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly importanceScore: number | null;
  readonly isVerified: boolean;
};

export type SearchCameraTarget =
  | {
      readonly type: 'point';
      readonly center: readonly [number, number];
      readonly zoom?: number;
      readonly duration?: number;
    }
  | {
      readonly type: 'bounds';
      readonly bbox?: readonly [number, number, number, number];
      readonly padding?: number;
      readonly duration?: number;
    };

export type PublicSearchResult = {
  readonly id: string;
  readonly publicId?: string;
  readonly type: 'place' | 'street';
  readonly name: string;
  readonly subtitle?: string;
  readonly categoryName?: string | null;
  readonly categoryCode?: string | null;
  readonly lat?: number;
  readonly lng?: number;
  readonly center?: readonly [number, number];
  readonly bbox?: readonly [number, number, number, number];
  readonly cameraTarget?: SearchCameraTarget;
};

type PublicSearchResultDto = {
  readonly id?: string;
  readonly publicId?: string;
  readonly placePublicId?: string;
  readonly type?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly subtitle?: string;
  readonly categoryName?: string | null;
  readonly categoryCode?: string | null;
  readonly lat?: number;
  readonly lng?: number;
  readonly center?: readonly [number, number];
  readonly bbox?: readonly [number, number, number, number];
  readonly cameraTarget?: SearchCameraTarget;
};

type PublicSearchResponseDto =
  | readonly PublicSearchResultDto[]
  | {
      readonly results: readonly PublicSearchResultDto[];
    };

export type PublicPlacesParams = {
  readonly q?: string;
  readonly categoryId?: string;
  readonly limit?: number;
};

function getApiBaseUrl(): string {
  if (typeof API_BASE_URL !== 'string' || API_BASE_URL.trim() === '') {
    throw new Error('Missing VITE_API_BASE_URL');
  }

  return API_BASE_URL.replace(/\/+$/, '');
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchPublicCategories(): Promise<readonly PoiCategory[]> {
  return fetchJson<PublicCategoryDto[]>('/public/categories');
}

export async function fetchPublicPlaces(
  params: PublicPlacesParams = {},
): Promise<readonly Poi[]> {
  const search = new URLSearchParams();

  if (params.q !== undefined && params.q.trim() !== '') {
    search.set('q', params.q.trim());
  }
  if (params.categoryId !== undefined && params.categoryId !== '') {
    search.set('categoryId', params.categoryId);
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }

  const query = search.toString();
  const places = await fetchJson<PublicPlaceDto[]>(
    `/public/places${query.length > 0 ? `?${query}` : ''}`,
  );

  return places.map(publicPlaceToPoi);
}

export async function fetchPublicPlace(publicId: string): Promise<Poi> {
  const place = await fetchJson<PublicPlaceDto>(`/public/places/${encodeURIComponent(publicId)}`);
  return publicPlaceToPoi(place);
}

export async function fetchPublicSearch(q: string): Promise<readonly PublicSearchResult[]> {
  const trimmedQuery = q.trim();
  if (trimmedQuery === '') return [];

  const search = new URLSearchParams({ q: trimmedQuery });
  const response = await fetchJson<PublicSearchResponseDto>(`/public/search?${search.toString()}`);
  const results = hasSearchResults(response) ? response.results : response;

  return results.map(publicSearchResultFromDto).filter((result) => result !== null);
}

function publicPlaceToPoi(place: PublicPlaceDto): Poi {
  const categoryLabel = place.categoryName ?? place.categoryCode ?? 'Place';

  return {
    id: place.publicId,
    apiId: place.id,
    publicId: place.publicId,
    name: place.name,
    category: place.categoryId,
    categoryCode: place.categoryCode,
    categoryName: place.categoryName,
    subcategory: categoryLabel,
    latitude: place.lat,
    longitude: place.lng,
    importanceScore: place.importanceScore,
    isVerified: place.isVerified,
    source: 'api',
    osm_tags: {},
  };
}

function publicSearchResultFromDto(result: PublicSearchResultDto): PublicSearchResult | null {
  if (result.type !== 'place' && result.type !== 'street') return null;

  const name = result.name ?? result.displayName;
  if (typeof name !== 'string' || name.trim() === '') return null;

  const publicId = result.publicId ?? result.placePublicId;
  const id = result.id ?? publicId ?? `${result.type}:${name}`;

  return {
    id,
    publicId,
    type: result.type,
    name,
    subtitle: result.subtitle,
    categoryName: result.categoryName,
    categoryCode: result.categoryCode,
    lat: result.lat,
    lng: result.lng,
    center: result.center,
    bbox: result.bbox,
    cameraTarget: result.cameraTarget,
  };
}

function hasSearchResults(
  response: PublicSearchResponseDto,
): response is { readonly results: readonly PublicSearchResultDto[] } {
  return !Array.isArray(response);
}
