import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';
import type { RouteResponse } from '@/features/routing/types';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';

import type { MapClickedLocation } from '@/features/map/types';

import { parseCoordinateInput, type RoutePoint } from './lib/routePoint';
import type { RouteWaypoint } from './types';

export type RouteEndpointKind = 'empty' | 'place' | 'coordinate' | 'map_click';

export type RouteEndpointSource = 'search' | 'place_detail' | 'map_click' | 'manual';

export type RoutingTravelMode = 'walk' | 'motorcycle' | 'car';

export type RouteEndpoint = {
  readonly kind: RouteEndpointKind;
  readonly label: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly placeId?: string;
  readonly source?: RouteEndpointSource;
};

export type RouteInputField = 'from' | 'to';

export type RouteState = {
  readonly from: RouteEndpoint;
  readonly to: RouteEndpoint;
  readonly activeInput: RouteInputField | null;
  readonly pickMode: RouteInputField | null;
  readonly selectedMode: RoutingTravelMode;
  readonly routeResult: RouteResponse | null;
  readonly isLoading: boolean;
  readonly error: string | null;
};

export const EMPTY_ROUTE_ENDPOINT: RouteEndpoint = {
  kind: 'empty',
  label: '',
  lat: null,
  lng: null,
};

export function createInitialRouteState(
  selectedMode: RoutingTravelMode = 'motorcycle',
): RouteState {
  return {
    from: { ...EMPTY_ROUTE_ENDPOINT },
    to: { ...EMPTY_ROUTE_ENDPOINT },
    activeInput: null,
    pickMode: null,
    selectedMode,
    routeResult: null,
    isLoading: false,
    error: null,
  };
}

export function resolveEndpointCoordinates(
  endpoint: RouteEndpoint,
): readonly [number, number] | null {
  if (endpoint.kind === 'empty') return null;
  if (endpoint.lat != null && endpoint.lng != null) {
    return [endpoint.lng, endpoint.lat];
  }
  return parseCoordinateInput(endpoint.label);
}

export function endpointToWaypoint(endpoint: RouteEndpoint): RouteWaypoint | null {
  const coordinates = resolveEndpointCoordinates(endpoint);
  if (!coordinates) return null;
  const [lng, lat] = coordinates;
  return {
    lat,
    lng,
    label: endpoint.label.trim() || undefined,
  };
}

export function coordinateEndpoint(
  label: string,
  lng: number,
  lat: number,
  source: RouteEndpointSource = 'manual',
): RouteEndpoint {
  return {
    kind: 'coordinate',
    label,
    lat,
    lng,
    source,
  };
}

export function placeEndpoint(
  label: string,
  lng: number,
  lat: number,
  options?: { readonly placeId?: string; readonly source?: RouteEndpointSource },
): RouteEndpoint {
  return {
    kind: 'place',
    label,
    lat,
    lng,
    placeId: options?.placeId,
    source: options?.source ?? 'place_detail',
  };
}

export function mapClickEndpoint(label: string, lng: number, lat: number): RouteEndpoint {
  return {
    kind: 'map_click',
    label,
    lat,
    lng,
    source: 'map_click',
  };
}

/** Partial manual typing — coordinates resolved on blur via {@link endpointFromManualInput}. */
export function manualEndpointFromLabel(label: string): RouteEndpoint {
  const trimmed = label.trim();
  if (!trimmed) return { ...EMPTY_ROUTE_ENDPOINT };
  const coords = parseCoordinateInput(trimmed);
  if (coords) {
    const [lng, lat] = coords;
    return coordinateEndpoint(trimmed, lng, lat, 'manual');
  }
  return {
    kind: 'coordinate',
    label: trimmed,
    lat: null,
    lng: null,
    source: 'manual',
  };
}

export function endpointFromManualInput(label: string): RouteEndpoint {
  return manualEndpointFromLabel(label);
}

export function endpointFromMapClick(location: MapClickedLocation): RouteEndpoint {
  const [lng, lat] = location.coordinates;
  return mapClickEndpoint(location.label, lng, lat);
}

export function endpointFromRoutePoint(
  point: RoutePoint,
  source: RouteEndpointSource = 'map_click',
): RouteEndpoint {
  if (point.coordinates) {
    const [lng, lat] = point.coordinates;
    return {
      kind: source === 'map_click' ? 'map_click' : 'coordinate',
      label: point.label,
      lat,
      lng,
      source,
    };
  }
  return manualEndpointFromLabel(point.label);
}

export function endpointFromPoi(poi: Poi, languageMode: PlaceLanguageMode): RouteEndpoint | null {
  const label = getLocalizedName(
    {
      myanmar_name: poi.nameMm ?? poi.myanmarName,
      english_name: poi.nameEn ?? poi.englishName,
      display_name: poi.displayName,
      primary_name: poi.primaryName,
      name: poi.name,
    },
    languageMode,
  );
  return placeEndpoint(label, poi.longitude, poi.latitude, {
    placeId: poi.id,
    source: 'place_detail',
  });
}

export function resolveSearchResultCoordinates(
  result: PublicSearchResult,
): readonly [number, number] | null {
  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return [result.lng, result.lat];
  }
  if (result.center && result.center.length >= 2) {
    return [result.center[0], result.center[1]];
  }
  if (result.bbox && result.bbox.length >= 4) {
    const [minLng, minLat, maxLng, maxLat] = result.bbox;
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }
  return null;
}

export function endpointFromSearchResult(
  result: PublicSearchResult,
  languageMode: PlaceLanguageMode,
): RouteEndpoint | null {
  const coordinates = resolveSearchResultCoordinates(result);
  if (!coordinates) return null;
  const [lng, lat] = coordinates;

  const label = getLocalizedName(
    {
      myanmar_name: result.name_mm ?? result.myanmar_name,
      english_name: result.name_en ?? result.english_name,
      display_name: result.display_name,
      primary_name: result.primary_name,
      canonical_name: result.canonical_name,
    },
    languageMode,
  );

  const placeId =
    result.type === 'place' ? (result.publicId ?? result.id) : undefined;

  return placeEndpoint(label || result.subtitle || result.type, lng, lat, {
    placeId,
    source: 'search',
  });
}

export function isEndpointEmpty(endpoint: RouteEndpoint): boolean {
  return endpoint.kind === 'empty' && !endpoint.label.trim();
}
