import type { Poi, PoiCategory } from '@/types';
import type {
  PublicSearchCategory,
  PublicSearchTransportMode,
  PublicSearchTransportType,
} from './publicSearchConstants.js';
import { PublicMapApiError } from './publicMapApiError.js';
import type { PublicSearchApiLang } from './publicSearchLang.js';

export { PublicMapApiError };

export type { PublicSearchCategory, PublicSearchTransportMode, PublicSearchTransportType };

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
  | 'transport_stop'
  | 'transport_terminal'
  | 'transport_route'
  | 'transport_route_variant'
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
  'transport_stop',
  'transport_terminal',
  'transport_route',
  'transport_route_variant',
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
  readonly mode?: string | null;
  readonly stopType?: string | null;
  readonly reviewStatus?: string | null;
  readonly verificationStatus?: string | null;
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

type PublicSearchVerificationDto = {
  readonly isVerified?: boolean;
  readonly confidenceScore?: number | null;
  readonly boundaryConfidenceScore?: number | null;
  readonly reviewStatus?: string | null;
  readonly verificationStatus?: string | null;
};

type PublicSearchCategoryDto = {
  readonly code?: string | null;
  readonly name?: string | null;
};

type PublicSearchTransportDto = {
  readonly mode?: string | null;
  readonly stopType?: string | null;
  readonly routeCode?: string | null;
  readonly parentRoutePublicId?: string | null;
  readonly variantCode?: string | null;
  readonly headsign?: string | null;
  readonly directionName?: string | null;
  readonly originName?: string | null;
  readonly destinationName?: string | null;
};

type PublicSearchPlusCodeDto = {
  readonly code?: string;
  readonly referenceRequired?: boolean;
  readonly outsideServiceArea?: boolean;
  readonly reason?: string;
};

type PublicSearchCoordinateDto = {
  readonly outsideServiceArea?: boolean;
};

type PublicSearchResultDto = {
  readonly id?: string;
  readonly publicId?: string;
  readonly placePublicId?: string;
  readonly entityId?: string | number;
  readonly entityType?: string;
  readonly type?: string;
  readonly displayName?: string | null;
  readonly display_name?: string | null;
  readonly subtitle?: string | null;
  readonly lat?: number;
  readonly lng?: number;
  readonly center?: readonly [number, number] | null;
  readonly bbox?: readonly [number, number, number, number] | null;
  readonly geometryType?: string | null;
  readonly hasGeometry?: boolean;
  readonly geometryEndpoint?: string;
  readonly score?: number;
  readonly verification?: PublicSearchVerificationDto;
  readonly category?: PublicSearchCategoryDto | null;
  readonly transport?: PublicSearchTransportDto;
  readonly plusCode?: PublicSearchPlusCodeDto;
  readonly coordinate?: PublicSearchCoordinateDto;
  readonly cameraTarget?: SearchCameraTarget;
  readonly reverse?: ReverseAddressDto | null;
  // Legacy flat fields (older API responses).
  readonly myanmar_name?: string | null;
  readonly english_name?: string | null;
  readonly name_mm?: string | null;
  readonly name_en?: string | null;
  readonly primaryNameMy?: string | null;
  readonly primaryNameEn?: string | null;
  readonly matchedName?: string | null;
  readonly primary_name?: string | null;
  readonly canonical_name?: string | null;
  readonly categoryName?: string | null;
  readonly categoryCode?: string | null;
  readonly adminAreaNameMy?: string | null;
  readonly adminAreaNameEn?: string | null;
  readonly isVerified?: boolean;
  readonly confidenceScore?: number | null;
  readonly boundaryConfidenceScore?: number | null;
  readonly mode?: string | null;
  readonly stopType?: string | null;
  readonly reviewStatus?: string | null;
  readonly verificationStatus?: string | null;
  readonly plus_code?: string | null;
  readonly referenceRequired?: boolean;
  readonly outsideServiceArea?: boolean;
  readonly reason?: string;
};

type PublicSearchAnalyticsDto = {
  readonly eventId?: string;
};

type PublicSearchPageDto = {
  readonly items: readonly PublicSearchResultDto[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly analytics?: PublicSearchAnalyticsDto;
};

export type PublicSearchAnalytics = {
  readonly eventId: string;
};

type PublicSearchResponseDto =
  | readonly PublicSearchResultDto[]
  | PublicSearchPageDto
  | {
      readonly results: readonly PublicSearchResultDto[];
    };

export type PublicSearchPage = {
  readonly items: readonly PublicSearchResult[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly analytics?: PublicSearchAnalytics;
};

/** Full GeoJSON geometry for a selected search result (GET .../geometry). */
export type SearchResultGeometry = {
  readonly entityType: SearchEntityType;
  readonly entityId: string;
  readonly geometryType: string | null;
  readonly bbox: readonly [number, number, number, number];
  readonly feature: GeoJSON.Feature;
};

export type TransportRouteMapPreviewVariant = {
  readonly entityId: string;
  readonly publicId: string | null;
  readonly variantCode: string | null;
  readonly headsign: string | null;
  readonly directionName: string | null;
  readonly isPrimary: boolean;
};

export type TransportRouteMapPreviewStop = {
  readonly publicId: string;
  readonly displayName: string;
  readonly sequence: number;
  readonly lat: number;
  readonly lng: number;
};

/** Lightweight transport route overlay (GET .../map-preview). */
export type TransportRouteMapPreview = {
  readonly entityType: 'transport_route' | 'transport_route_variant';
  readonly entityId: string;
  readonly bbox: readonly [number, number, number, number];
  readonly path: GeoJSON.Feature;
  readonly variants: readonly TransportRouteMapPreviewVariant[];
  readonly importantStops: readonly TransportRouteMapPreviewStop[];
};

export type PublicSearchParams = {
  readonly q: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly lang?: PublicSearchApiLang;
  readonly types?: readonly SearchEntityType[] | readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly category?: PublicSearchCategory;
  readonly transportType?: PublicSearchTransportType;
  readonly mode?: PublicSearchTransportMode;
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

async function parsePublicMapApiError(response: Response): Promise<PublicMapApiError> {
  let message = `API request failed: ${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim() !== '') {
      message = body.message.trim();
    }
  } catch {
    // Keep the status/statusText fallback when the response body is not JSON.
  }
  return new PublicMapApiError(response.status, message);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);

  if (!response.ok) {
    throw await parsePublicMapApiError(response);
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

export async function fetchPublicSearchPage(
  params: PublicSearchParams,
  signal?: AbortSignal,
): Promise<PublicSearchPage> {
  const trimmedQuery = params.q.trim();
  if (trimmedQuery === '') {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const search = new URLSearchParams({ q: trimmedQuery });
  if (typeof params.lat === 'number' && Number.isFinite(params.lat)) {
    search.set('lat', String(params.lat));
  }
  if (typeof params.lng === 'number' && Number.isFinite(params.lng)) {
    search.set('lng', String(params.lng));
  }
  if (params.lang === 'my' || params.lang === 'en' || params.lang === 'und') {
    search.set('lang', params.lang);
  }
  if (params.types && params.types.length > 0) {
    search.set('types', params.types.join(','));
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  if (typeof params.cursor === 'string' && params.cursor.trim() !== '') {
    search.set('cursor', params.cursor.trim());
  }
  if (params.category && params.category !== 'all') {
    search.set('category', params.category);
  }
  if (params.transportType && params.transportType !== 'all') {
    search.set('transportType', params.transportType);
  }
  if (params.mode && params.mode !== 'all') {
    search.set('mode', params.mode);
  }

  const response = await fetchJson<PublicSearchResponseDto>(
    `/public/search?${search.toString()}`,
    { signal },
  );

  if (isPublicSearchPageDto(response)) {
    const items = response.items
      .map(publicSearchResultFromDto)
      .filter((result): result is PublicSearchResult => result !== null);
    const analytics = publicSearchAnalyticsFromDto(response.analytics);
    return {
      items,
      nextCursor: response.nextCursor,
      hasMore: response.hasMore,
      ...(analytics ? { analytics } : {}),
    };
  }

  const legacyItems = hasLegacySearchResults(response) ? response.results : response;
  const items = legacyItems
    .map(publicSearchResultFromDto)
    .filter((result): result is PublicSearchResult => result !== null);

  return {
    items,
    nextCursor: null,
    hasMore: false,
  };
}

export async function fetchPublicSearch(
  input: string | PublicSearchParams,
  signal?: AbortSignal,
): Promise<readonly PublicSearchResult[]> {
  const params: PublicSearchParams = typeof input === 'string' ? { q: input } : input;
  const page = await fetchPublicSearchPage(params, signal);
  return page.items;
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
    { signal },
  );
}

const TRANSPORT_ROUTE_MAP_PREVIEW_ENTITY_TYPES: ReadonlySet<SearchEntityType> = new Set([
  'transport_route',
  'bus_route',
]);

export function usesTransportRouteMapPreview(entityType: SearchEntityType): boolean {
  return TRANSPORT_ROUTE_MAP_PREVIEW_ENTITY_TYPES.has(entityType);
}

/** Path to the lightweight transport route map-preview endpoint. */
export function searchResultMapPreviewEndpoint(
  entityType: SearchEntityType,
  entityId: string,
): string | null {
  if (!usesTransportRouteMapPreview(entityType)) return null;
  const id = entityId.trim();
  if (id === '') return null;
  return `/public/search/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/map-preview`;
}

export async function fetchTransportRouteMapPreview(
  entityType: SearchEntityType,
  entityId: string,
  zoom?: number,
  signal?: AbortSignal,
): Promise<TransportRouteMapPreview | null> {
  const endpoint = searchResultMapPreviewEndpoint(entityType, entityId);
  if (endpoint === null) return null;

  const search = new URLSearchParams();
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    search.set('zoom', String(Number(zoom.toFixed(2))));
  }
  const query = search.toString();
  return fetchJson<TransportRouteMapPreview>(
    `${endpoint}${query.length > 0 ? `?${query}` : ''}`,
    { signal },
  );
}

function mapPreviewToSearchResultGeometry(
  preview: TransportRouteMapPreview,
): SearchResultGeometry {
  const geometryType =
    preview.path.geometry && typeof preview.path.geometry === 'object' && 'type' in preview.path.geometry
      ? String(preview.path.geometry.type)
      : null;
  return {
    entityType: preview.entityType,
    entityId: preview.entityId,
    geometryType,
    bbox: preview.bbox,
    feature: preview.path,
  };
}

/** Fetch overlay geometry for a selected search result (preview or full geometry). */
export async function fetchSearchResultOverlayGeometry(
  entityType: SearchEntityType,
  entityId: string,
  zoom?: number,
  signal?: AbortSignal,
): Promise<SearchResultGeometry | null> {
  if (usesTransportRouteMapPreview(entityType)) {
    const preview = await fetchTransportRouteMapPreview(entityType, entityId, zoom, signal);
    return preview ? mapPreviewToSearchResultGeometry(preview) : null;
  }
  return fetchSearchResultGeometry(entityType, entityId, zoom, signal);
}

export function searchResultOverlayQueryKey(
  entityType: SearchEntityType,
  entityId: string,
  zoomBucket: number,
) {
  return ['search-result-overlay', entityType, entityId, zoomBucket] as const;
}

export function searchResultOverlayZoomBucket(zoom: number): number {
  return Math.max(0, Math.min(24, Math.round(zoom)));
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

function normalizeSearchEntityType(raw: string | undefined): SearchEntityType | null {
  if (!raw) return null;
  const normalized =
    raw === 'bus_stop'
      ? 'transport_stop'
      : raw === 'bus_route'
        ? 'transport_route'
        : raw === 'bus_route_variant'
          ? 'transport_route_variant'
          : raw;
  return isKnownSearchEntityType(normalized) ? normalized : null;
}

function publicSearchResultFromDto(result: PublicSearchResultDto): PublicSearchResult | null {
  const entityType = normalizeSearchEntityType(result.entityType ?? result.type);
  if (!entityType) {
    return null;
  }

  const publicId = trimOpt(result.publicId ?? result.placePublicId);
  const entityId =
    result.entityId !== undefined && result.entityId !== null
      ? String(result.entityId)
      : (publicId ?? trimOpt(result.id));
  const id = trimOpt(result.id) ?? entityId ?? publicId ?? `${entityType}:unknown`;
  const display = trimOpt(result.displayName ?? result.display_name);
  const transportDto = result.transport;
  const categoryDto = result.category;
  const verificationDto = result.verification;

  const hasGeometry =
    typeof result.hasGeometry === 'boolean' ? result.hasGeometry : undefined;
  const geometryEndpoint =
    result.geometryEndpoint ??
    (entityId && hasGeometry !== false
      ? (searchResultGeometryEndpoint(entityType, entityId) ??
          searchResultMapPreviewEndpoint(entityType, entityId) ??
          undefined)
      : undefined);

  const plusCode =
    entityType === 'plus_code'
      ? {
          code:
            trimOpt(result.plusCode?.code ?? result.plus_code) ??
            trimOpt(result.displayName ?? result.display_name) ??
            id,
          referenceRequired:
            result.plusCode?.referenceRequired === true || result.referenceRequired === true,
          outsideServiceArea:
            result.plusCode?.outsideServiceArea === true || result.outsideServiceArea === true,
          reason: trimOpt(result.plusCode?.reason ?? result.reason),
        }
      : undefined;

  return {
    id,
    publicId,
    entityId,
    entityType,
    type: entityType,
    display_name: display ?? null,
    displayName: display ?? null,
    name_mm: trimOpt(result.primaryNameMy) ?? trimOpt(result.name_mm) ?? trimOpt(result.myanmar_name),
    name_en: trimOpt(result.primaryNameEn) ?? trimOpt(result.name_en) ?? trimOpt(result.english_name),
    myanmar_name: trimOpt(result.primaryNameMy) ?? trimOpt(result.myanmar_name) ?? null,
    english_name: trimOpt(result.primaryNameEn) ?? trimOpt(result.english_name) ?? null,
    subtitle: trimOpt(result.subtitle ?? result.matchedName),
    categoryName:
      trimOpt(categoryDto?.name) ?? trimOpt(result.categoryName) ?? null,
    categoryCode:
      trimOpt(categoryDto?.code) ?? trimOpt(result.categoryCode) ?? null,
    lat: result.lat,
    lng: result.lng,
    center: result.center ?? undefined,
    bbox: result.bbox ?? undefined,
    geometryType: result.geometryType ?? null,
    hasGeometry,
    geometryEndpoint,
    isVerified: verificationDto?.isVerified ?? result.isVerified,
    confidenceScore: verificationDto?.confidenceScore ?? result.confidenceScore ?? null,
    boundaryConfidenceScore:
      verificationDto?.boundaryConfidenceScore ?? result.boundaryConfidenceScore ?? null,
    mode: trimOpt(transportDto?.mode ?? result.mode) ?? null,
    stopType: trimOpt(transportDto?.stopType ?? result.stopType) ?? null,
    reviewStatus: trimOpt(verificationDto?.reviewStatus ?? result.reviewStatus) ?? null,
    verificationStatus:
      trimOpt(verificationDto?.verificationStatus ?? result.verificationStatus) ?? null,
    score: result.score,
    plusCode,
    reverseAddress: reverseAddressFromDto(result.reverse),
    cameraTarget: result.cameraTarget,
  };
}

function publicSearchAnalyticsFromDto(
  dto: PublicSearchAnalyticsDto | undefined,
): PublicSearchAnalytics | undefined {
  const eventId = dto?.eventId?.trim();
  if (!eventId) return undefined;
  return { eventId };
}

function isPublicSearchPageDto(response: PublicSearchResponseDto): response is PublicSearchPageDto {
  return (
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response) &&
    'items' in response &&
    Array.isArray(response.items)
  );
}

function hasLegacySearchResults(
  response: PublicSearchResponseDto,
): response is { readonly results: readonly PublicSearchResultDto[] } {
  return (
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response) &&
    'results' in response &&
    Array.isArray(response.results)
  );
}

function publicMapPlacesLimitForZoom(zoom: number): number {
  // Match the public map density bands used by HomePage and the API importance thresholds.
  if (zoom < 12) return 50;
  if (zoom < 16) return 100;
  return 200;
}
