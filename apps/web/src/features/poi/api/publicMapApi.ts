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
  readonly myanmar_name?: string | null;
  readonly english_name?: string | null;
  readonly name_mm?: string | null;
  readonly name_en?: string | null;
  readonly displayName?: string;
  readonly display_name?: string | null;
  readonly primary_name?: string | null;
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
  // Detail-only enrichment (GET /public/places/:id); absent on list/viewport rows.
  readonly address_line?: string | null;
  readonly plus_code?: string | null;
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

/** Entity kinds returned by unified search; mirrors the API allowlist (+ `plus_code`). */
export type SearchEntityType =
  | 'place'
  | 'address'
  | 'bus_stop'
  | 'admin_area'
  | 'street'
  | 'street_group'
  | 'bus_route'
  | 'bus_route_variant'
  | 'building'
  | 'water_line'
  | 'water_polygon'
  | 'landuse'
  | 'plus_code'
  | 'coordinate';

/** Entity types that have a fetchable geometry endpoint (everything except `plus_code`). */
const GEOMETRY_SEARCH_ENTITY_TYPES: ReadonlySet<SearchEntityType> = new Set([
  'place',
  'address',
  'bus_stop',
  'admin_area',
  'street',
  'street_group',
  'bus_route',
  'bus_route_variant',
  'building',
  'water_line',
  'water_polygon',
  'landuse',
]);

const KNOWN_SEARCH_ENTITY_TYPES: ReadonlySet<SearchEntityType> = new Set([
  ...GEOMETRY_SEARCH_ENTITY_TYPES,
  // plus_code and coordinate carry an inline center pin (no geometry endpoint).
  'plus_code',
  'coordinate',
]);

/** Reverse-address fields returned alongside a `plus_code` result. */
export type SearchResultReverseAddress = {
  readonly nearbyName: string | null;
  readonly nearbyType: string | null;
  readonly nearbyDistanceM: number | null;
  readonly township: string | null;
  readonly district: string | null;
  readonly regionState: string | null;
  readonly country: string | null;
  readonly confidence: string | null;
};

/** Plus Code specifics present when `type === 'plus_code'`. */
export type PlusCodeSearchInfo = {
  readonly code: string;
  /** Short code needs a lat/lng reference; the client should retry with map center. */
  readonly referenceRequired: boolean;
  /** Decoded point falls outside the Myanmar service area. */
  readonly outsideServiceArea: boolean;
  readonly reason?: string;
};

export type PublicSearchResult = {
  readonly id: string;
  readonly publicId?: string;
  /** Internal/public entity id used to fetch geometry on click. */
  readonly entityId?: string;
  readonly entityType: SearchEntityType;
  /** @deprecated Use `entityType`; kept for backward compatibility. */
  readonly type: SearchEntityType;
  readonly myanmar_name?: string | null;
  readonly english_name?: string | null;
  readonly name_mm?: string | null;
  readonly name_en?: string | null;
  readonly display_name?: string | null;
  readonly displayName?: string | null;
  readonly primary_name?: string | null;
  readonly canonical_name?: string | null;
  readonly subtitle?: string;
  readonly categoryName?: string | null;
  readonly categoryCode?: string | null;
  readonly adminAreaNameMy?: string | null;
  readonly adminAreaNameEn?: string | null;
  readonly lat?: number;
  readonly lng?: number;
  readonly center?: readonly [number, number];
  readonly bbox?: readonly [number, number, number, number];
  readonly geometryType?: string | null;
  readonly hasGeometry?: boolean;
  /** Relative API path to fetch full geometry, derived when not provided by API. */
  readonly geometryEndpoint?: string;
  readonly isVerified?: boolean;
  readonly confidenceScore?: number | null;
  readonly boundaryConfidenceScore?: number | null;
  readonly score?: number;
  readonly plusCode?: PlusCodeSearchInfo;
  readonly reverseAddress?: SearchResultReverseAddress;
  readonly cameraTarget?: SearchCameraTarget;
};

type ReverseAddressDto = {
  readonly nearbyName?: string | null;
  readonly nearbyType?: string | null;
  readonly nearbyDistanceM?: number | null;
  readonly township?: string | null;
  readonly district?: string | null;
  readonly regionState?: string | null;
  readonly country?: string | null;
  readonly confidence?: string | null;
};

type PublicSearchResultDto = {
  readonly id?: string;
  readonly publicId?: string;
  readonly placePublicId?: string;
  readonly entityId?: string | number;
  readonly entityType?: string;
  readonly type?: string;
  readonly myanmar_name?: string | null;
  readonly english_name?: string | null;
  readonly name_mm?: string | null;
  readonly name_en?: string | null;
  readonly primaryNameMy?: string | null;
  readonly primaryNameEn?: string | null;
  readonly matchedName?: string | null;
  readonly display_name?: string | null;
  readonly displayName?: string | null;
  readonly primary_name?: string | null;
  readonly canonical_name?: string | null;
  readonly subtitle?: string | null;
  readonly categoryName?: string | null;
  readonly categoryCode?: string | null;
  readonly adminAreaNameMy?: string | null;
  readonly adminAreaNameEn?: string | null;
  readonly lat?: number;
  readonly lng?: number;
  readonly center?: readonly [number, number] | null;
  readonly bbox?: readonly [number, number, number, number] | null;
  readonly geometryType?: string | null;
  readonly hasGeometry?: boolean;
  readonly geometryEndpoint?: string;
  readonly isVerified?: boolean;
  readonly confidenceScore?: number | null;
  readonly boundaryConfidenceScore?: number | null;
  readonly score?: number;
  // Plus Code fields (type === 'plus_code')
  readonly plus_code?: string | null;
  readonly referenceRequired?: boolean;
  readonly outsideServiceArea?: boolean;
  readonly reason?: string;
  readonly reverse?: ReverseAddressDto | null;
  readonly cameraTarget?: SearchCameraTarget;
};

type PublicSearchResponseDto =
  | readonly PublicSearchResultDto[]
  | {
      readonly results: readonly PublicSearchResultDto[];
    };

/** Full GeoJSON geometry for a selected search result (GET .../geometry). */
export type SearchResultGeometry = {
  readonly entityType: SearchEntityType;
  readonly entityId: string;
  readonly geometryType: string | null;
  readonly bbox: readonly [number, number, number, number];
  readonly feature: GeoJSON.Feature;
};

export type PublicSearchParams = {
  readonly q: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly lang?: PlaceLanguageMode | string;
  readonly types?: readonly SearchEntityType[] | readonly string[];
  readonly limit?: number;
};

export type PublicPlacesParams = {
  readonly q?: string;
  readonly categoryCode?: string;
  readonly limit?: number;
};

export type PublicMapPlacesParams = {
  readonly bbox: readonly [number, number, number, number];
  readonly zoom: number;
  readonly categoryCode?: string;
  readonly limit?: number;
  readonly offset?: number;
};

export type PublicMapPlacesMetadata = {
  readonly count: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
  readonly bbox: readonly [number, number, number, number];
  readonly zoom: number;
  readonly density_debug?: {
    readonly zoom: number;
    readonly bbox: readonly [number, number, number, number];
    readonly threshold_used: number | null;
    readonly returned_count: number;
  };
};

export type PublicMapPlacesResult = {
  readonly places: readonly Poi[];
  readonly metadata: PublicMapPlacesMetadata;
};

type PublicMapPlacesFeatureCollectionDto = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  PublicPlaceDto
> & {
  readonly metadata: PublicMapPlacesMetadata;
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

  const query = search.toString();
  const places = await fetchJson<PublicPlaceDto[]>(
    `/public/places${query.length > 0 ? `?${query}` : ''}`,
  );

  return places.map(publicPlaceToPoi);
}

export async function fetchPublicMapPlaces(
  params: PublicMapPlacesParams,
  signal?: AbortSignal,
): Promise<PublicMapPlacesResult> {
  const limit = params.limit ?? publicMapPlacesLimitForZoom(params.zoom);
  const search = new URLSearchParams({
    bbox: params.bbox.map((value) => value.toFixed(6)).join(','),
    zoom: String(Number(params.zoom.toFixed(2))),
    limit: String(limit),
    offset: String(params.offset ?? 0),
  });

  if (params.categoryCode !== undefined && params.categoryCode !== '') {
    search.set('category', params.categoryCode);
  }

  const collection = await fetchJson<PublicMapPlacesFeatureCollectionDto>(
    `/public/map/places?${search.toString()}`,
    { signal },
  );

  return {
    places: collection.features.map((feature) =>
      publicPlaceToPoi({
        ...feature.properties,
        lng: feature.properties.lng ?? feature.geometry.coordinates[0],
        lat: feature.properties.lat ?? feature.geometry.coordinates[1],
      }),
    ),
    metadata: collection.metadata,
  };
}

export async function fetchPublicPlace(publicId: string): Promise<Poi> {
  const place = await fetchJson<PublicPlaceDto>(
    `/public/places/${encodeURIComponent(publicId)}`,
  );
  return publicPlaceToPoi(place);
}

/**
 * Public unified search. Accepts a bare query string (backward compatible) or a
 * params object adding optional reference coordinates (for short Plus Codes),
 * language preference, entity-type filter, and limit.
 */
/** Shortest free-text query that hits the backend. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

const PLUS_CODE_HINT_RE = /\+/;
const COORDINATE_HINT_RE = /^-?\d{1,3}(?:\.\d+)?[,;\s]+-?\d{1,3}(?:\.\d+)?$/;

/**
 * Client-side guard so trivial queries never hit the backend.
 * - length >= 2 → always allowed (backend does prefix/code search).
 * - length 0–1 → only allowed if it looks like a Plus Code or coordinate
 *   (in practice always >= 2 chars, so single characters never call the API).
 */
export function shouldRunPublicSearch(raw: string): boolean {
  const q = raw.trim();
  if (q.length === 0) return false;
  if (q.length >= MIN_SEARCH_QUERY_LENGTH) return true;
  return PLUS_CODE_HINT_RE.test(q) || COORDINATE_HINT_RE.test(q);
}

export async function fetchPublicSearch(
  input: string | PublicSearchParams,
  signal?: AbortSignal,
): Promise<readonly PublicSearchResult[]> {
  const params: PublicSearchParams = typeof input === 'string' ? { q: input } : input;
  const trimmedQuery = params.q.trim();
  if (trimmedQuery === '') return [];

  const search = new URLSearchParams({ q: trimmedQuery });
  if (typeof params.lat === 'number' && Number.isFinite(params.lat)) {
    search.set('lat', String(params.lat));
  }
  if (typeof params.lng === 'number' && Number.isFinite(params.lng)) {
    search.set('lng', String(params.lng));
  }
  if (typeof params.lang === 'string' && params.lang.trim() !== '') {
    search.set('lang', params.lang.trim());
  }
  if (params.types && params.types.length > 0) {
    search.set('types', params.types.join(','));
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }

  const response = await fetchJson<PublicSearchResponseDto>(
    `/public/search?${search.toString()}`,
    { signal },
  );
  const results = hasSearchResults(response) ? response.results : response;

  return results.map(publicSearchResultFromDto).filter((result) => result !== null);
}

/** Path to the geometry endpoint for a selected result, or null if unsupported. */
export function searchResultGeometryEndpoint(
  entityType: SearchEntityType,
  entityId: string,
): string | null {
  if (!GEOMETRY_SEARCH_ENTITY_TYPES.has(entityType)) return null;
  const id = entityId.trim();
  if (id === '') return null;
  return `/public/search/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/geometry`;
}

/**
 * Fetch full GeoJSON geometry for a selected search result (after click).
 * `plus_code` results have no geometry endpoint and return null.
 */
export async function fetchSearchResultGeometry(
  entityType: SearchEntityType,
  entityId: string,
  zoom?: number,
  signal?: AbortSignal,
): Promise<SearchResultGeometry | null> {
  const endpoint = searchResultGeometryEndpoint(entityType, entityId);
  if (endpoint === null) return null;

  const search = new URLSearchParams();
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    search.set('zoom', String(Number(zoom.toFixed(2))));
  }
  const query = search.toString();
  return fetchJson<SearchResultGeometry>(
    `${endpoint}${query.length > 0 ? `?${query}` : ''}`,
    signal ? { signal } : undefined,
  );
}

export async function fetchPublicMapGeoJson(
  layer: PublicMapGeoLayerId,
): Promise<GeoJSON.FeatureCollection> {
  return fetchJson<GeoJSON.FeatureCollection>(`/public/map/geo/${layer}`);
}

export type ReverseAddressConfidence =
  | 'exact_nearby'
  | 'street_nearby'
  | 'area_based'
  | 'unknown';

export type ReverseAddressResult = {
  readonly address_line: string;
  readonly plus_code: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly confidence: ReverseAddressConfidence;
};

const REVERSE_ADDRESS_CONFIDENCES: readonly ReverseAddressConfidence[] = [
  'exact_nearby',
  'street_nearby',
  'area_based',
  'unknown',
];

function normalizeReverseConfidence(value: unknown): ReverseAddressConfidence {
  return typeof value === 'string' &&
    (REVERSE_ADDRESS_CONFIDENCES as readonly string[]).includes(value)
    ? (value as ReverseAddressConfidence)
    : 'unknown';
}

/**
 * Reverse geocode a single point via GET /search/reverse.
 * Throws on network/HTTP failure (catch at the call site); response fields are
 * defensively normalized so the shape is always valid.
 */
export async function getReverseAddress(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseAddressResult> {
  const search = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  const dto = await fetchJson<Partial<ReverseAddressResult>>(
    `/search/reverse?${search.toString()}`,
    signal ? { signal } : undefined,
  );

  return {
    address_line: typeof dto.address_line === 'string' ? dto.address_line : 'Myanmar',
    plus_code: typeof dto.plus_code === 'string' ? dto.plus_code : null,
    lat: typeof dto.lat === 'number' ? dto.lat : lat,
    lng: typeof dto.lng === 'number' ? dto.lng : lng,
    confidence: normalizeReverseConfidence(dto.confidence),
  };
}

function trimOpt(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

function publicPlaceToPoi(place: PublicPlaceDto): Poi {
  const mm = trimOpt(place.name_mm ?? place.myanmar_name);
  const en = trimOpt(place.name_en ?? place.english_name);
  const display = trimOpt(place.display_name ?? place.displayName ?? undefined);
  const primary = trimOpt(place.primary_name);

  const fallback =
    mm ??
    en ??
    display ??
    primary ??
    trimOpt(place.name) ??
    `Place:${place.lng}:${place.lat}`;
  const publicId =
    trimOpt(place.publicId ?? place.public_id ?? place.id) ??
    `${fallback}:${place.lng}:${place.lat}`;
  const categoryId = String(
    place.categoryId ?? place.category_id ?? place.categoryCode ?? place.category_code ?? 'unknown',
  );
  const categoryCode = place.categoryCode ?? place.category_code ?? null;
  const categoryName = place.categoryName ?? place.category_name ?? null;
  const categoryLabel = categoryName ?? categoryCode ?? 'Place';

  return {
    id: publicId,
    apiId: place.id,
    publicId,
    name: fallback,
    nameMm: mm,
    nameEn: en,
    displayName: display,
    primaryName: primary,
    myanmarName: mm,
    englishName: en,
    category: categoryId,
    categoryCode,
    categoryName,
    subcategory: categoryLabel,
    latitude: place.lat,
    longitude: place.lng,
    addressLine: trimOpt(place.address_line ?? undefined),
    plusCode: trimOpt(place.plus_code ?? undefined) ?? null,
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

function isKnownSearchEntityType(value: string | undefined): value is SearchEntityType {
  return value !== undefined && KNOWN_SEARCH_ENTITY_TYPES.has(value as SearchEntityType);
}

function reverseAddressFromDto(
  dto: ReverseAddressDto | null | undefined,
): SearchResultReverseAddress | undefined {
  if (!dto) return undefined;
  return {
    nearbyName: trimOpt(dto.nearbyName) ?? null,
    nearbyType: trimOpt(dto.nearbyType) ?? null,
    nearbyDistanceM: typeof dto.nearbyDistanceM === 'number' ? dto.nearbyDistanceM : null,
    township: trimOpt(dto.township) ?? null,
    district: trimOpt(dto.district) ?? null,
    regionState: trimOpt(dto.regionState) ?? null,
    country: trimOpt(dto.country) ?? null,
    confidence: trimOpt(dto.confidence) ?? null,
  };
}

function publicSearchResultFromDto(result: PublicSearchResultDto): PublicSearchResult | null {
  const rawType = result.entityType ?? result.type;
  if (!isKnownSearchEntityType(rawType)) {
    return null;
  }
  const entityType: SearchEntityType = rawType;

  const publicId = trimOpt(result.publicId ?? result.placePublicId);
  const entityId =
    result.entityId !== undefined && result.entityId !== null
      ? String(result.entityId)
      : (publicId ?? trimOpt(result.id));
  const id = trimOpt(result.id) ?? entityId ?? publicId ?? `${entityType}:unknown`;
  const mm = trimOpt(result.name_mm ?? result.myanmar_name ?? result.primaryNameMy);
  const en = trimOpt(result.name_en ?? result.english_name ?? result.primaryNameEn);
  const display = trimOpt(result.display_name ?? result.displayName);

  const hasGeometry =
    typeof result.hasGeometry === 'boolean' ? result.hasGeometry : undefined;
  const geometryEndpoint =
    result.geometryEndpoint ??
    (entityId && hasGeometry !== false
      ? (searchResultGeometryEndpoint(entityType, entityId) ?? undefined)
      : undefined);

  const plusCode =
    entityType === 'plus_code'
      ? {
          code: trimOpt(result.plus_code) ?? id,
          referenceRequired: result.referenceRequired === true,
          outsideServiceArea: result.outsideServiceArea === true,
          reason: trimOpt(result.reason),
        }
      : undefined;

  return {
    id,
    publicId,
    entityId,
    entityType,
    type: entityType,
    myanmar_name: mm ?? null,
    english_name: en ?? null,
    name_mm: mm ?? null,
    name_en: en ?? null,
    display_name: display ?? null,
    displayName: display ?? null,
    primary_name: trimOpt(result.primary_name) ?? null,
    canonical_name: trimOpt(result.canonical_name) ?? null,
    subtitle: trimOpt(result.subtitle ?? result.matchedName),
    categoryName: result.categoryName,
    categoryCode: result.categoryCode,
    adminAreaNameMy: result.adminAreaNameMy ?? null,
    adminAreaNameEn: result.adminAreaNameEn ?? null,
    lat: result.lat,
    lng: result.lng,
    center: result.center ?? undefined,
    bbox: result.bbox ?? undefined,
    geometryType: result.geometryType ?? null,
    hasGeometry,
    geometryEndpoint,
    isVerified: result.isVerified,
    confidenceScore: result.confidenceScore ?? null,
    boundaryConfidenceScore: result.boundaryConfidenceScore ?? null,
    score: result.score,
    plusCode,
    reverseAddress: reverseAddressFromDto(result.reverse),
    cameraTarget: result.cameraTarget,
  };
}

function hasSearchResults(
  response: PublicSearchResponseDto,
): response is { readonly results: readonly PublicSearchResultDto[] } {
  return !Array.isArray(response);
}

function publicMapPlacesLimitForZoom(zoom: number): number {
  // Match the public map density bands used by HomePage and the API importance thresholds.
  if (zoom < 12) return 50;
  if (zoom < 16) return 100;
  return 200;
}
