import type { Poi, PoiCategory } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

type PublicCategoryDto = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly name_mm?: string | null;
  readonly nameMm?: string | null;
  readonly nameLocal?: string | null;
  readonly sort_order?: number;
  readonly sortOrder?: number;
};

type PublicPlaceDto = {
  readonly id?: string;
  readonly publicId?: string;
  readonly public_id?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly display_name?: string;
  readonly primary_name?: string;
  readonly categoryId?: string;
  readonly category_id?: string | number;
  readonly categoryCode?: string | null;
  readonly category_code?: string | null;
  readonly categoryName?: string | null;
  readonly category_name?: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly importanceScore?: number | null;
  readonly importance_score?: number | null;
  readonly isVerified?: boolean;
  readonly is_verified?: boolean;
};

export type PlaceLanguageMode = 'my' | 'en' | 'both';

export type PublicMapGeoLayerId = 'streets' | 'admin-areas' | 'bus-stops' | 'bus-routes';

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
  readonly categoryCode?: string;
  readonly limit?: number;
  readonly lang?: PlaceLanguageMode;
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
  const categories = await fetchJson<PublicCategoryDto[]>('/categories');
  return categories.map(publicCategoryToPoiCategory);
}

export async function fetchPublicPlaces(
  params: PublicPlacesParams = {},
): Promise<readonly Poi[]> {
  const search = new URLSearchParams();

  if (params.q !== undefined && params.q.trim() !== '') {
    search.set('q', params.q.trim());
  }
  if (params.categoryCode !== undefined && params.categoryCode !== '') {
    search.set('category', params.categoryCode);
  }
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  if (params.lang !== undefined) {
    search.set('lang', params.lang);
  }

  const query = search.toString();
  const places = await fetchJson<PublicPlaceDto[]>(
    `/public/places${query.length > 0 ? `?${query}` : ''}`,
  );

  return places.map(publicPlaceToPoi);
}

export async function fetchPublicPlace(
  publicId: string,
  lang?: PlaceLanguageMode,
): Promise<Poi> {
  const search = new URLSearchParams();
  if (lang !== undefined) {
    search.set('lang', lang);
  }

  const query = search.toString();
  const place = await fetchJson<PublicPlaceDto>(
    `/public/places/${encodeURIComponent(publicId)}${query.length > 0 ? `?${query}` : ''}`,
  );
  return publicPlaceToPoi(place);
}

export async function fetchPublicSearch(
  q: string,
  lang?: PlaceLanguageMode,
): Promise<readonly PublicSearchResult[]> {
  const trimmedQuery = q.trim();
  if (trimmedQuery === '') return [];

  const search = new URLSearchParams({ q: trimmedQuery });
  if (lang !== undefined) {
    search.set('lang', lang);
  }
  const response = await fetchJson<PublicSearchResponseDto>(`/public/search?${search.toString()}`);
  const results = hasSearchResults(response) ? response.results : response;

  return results.map(publicSearchResultFromDto).filter((result) => result !== null);
}

export async function fetchPublicMapGeoJson(
  layer: PublicMapGeoLayerId,
  lang: PlaceLanguageMode,
): Promise<GeoJSON.FeatureCollection> {
  const search = new URLSearchParams({ lang });
  return fetchJson<GeoJSON.FeatureCollection>(`/public/map/geo/${layer}?${search}`);
}

function publicPlaceToPoi(place: PublicPlaceDto): Poi {
  const name = place.name ?? 'Unnamed place';
  const publicId = place.publicId ?? place.public_id ?? place.id ?? `${name}:${place.lng}:${place.lat}`;
  const categoryId = String(place.categoryId ?? place.category_id ?? place.categoryCode ?? place.category_code ?? 'unknown');
  const categoryCode = place.categoryCode ?? place.category_code ?? null;
  const categoryName = place.categoryName ?? place.category_name ?? null;
  const categoryLabel = categoryName ?? categoryCode ?? 'Place';

  return {
    id: publicId,
    apiId: place.id,
    publicId,
    name,
    category: categoryId,
    categoryCode,
    categoryName,
    subcategory: categoryLabel,
    latitude: place.lat,
    longitude: place.lng,
    importanceScore: place.importanceScore ?? place.importance_score ?? null,
    isVerified: place.isVerified ?? place.is_verified ?? false,
    source: 'api',
    osm_tags: {},
  };
}

function publicCategoryToPoiCategory(category: PublicCategoryDto): PoiCategory {
  const nameMm = category.name_mm ?? category.nameMm ?? category.nameLocal ?? null;

  return {
    id: category.id,
    code: category.code,
    name: category.name,
    nameMm,
    nameLocal: nameMm,
    sortOrder: category.sort_order ?? category.sortOrder ?? 0,
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
