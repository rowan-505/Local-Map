import type { RouteWaypoint } from '@/features/routing/types';
import type { RoutingRouteProfileCode } from '@/features/routing/types';

export type DirectionsUiProfile = 'walk' | 'motorbike' | 'car';

export type RoutePoint = {
  readonly label: string;
  readonly coordinates?: readonly [number, number];
};

export type RouteDraft = {
  readonly from: RoutePoint | null;
  readonly to: RoutePoint | null;
  readonly profile: DirectionsUiProfile;
};

/** Parse `lat, lng` (preferred) or `lng, lat` when values match Myanmar-ish ranges. */
export function parseCoordinateInput(text: string): readonly [number, number] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length !== 2) return null;

  const first = Number(parts[0]);
  const second = Number(parts[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const asLatLng = (lat: number, lng: number): readonly [number, number] | null => {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lng, lat];
  };

  const latLng = asLatLng(first, second);
  const lngLat = asLatLng(second, first);
  if (!latLng && !lngLat) return null;
  if (latLng && !lngLat) return latLng;
  if (!latLng && lngLat) return lngLat;

  const firstLooksLat = first >= 9 && first <= 29;
  const secondLooksLng = second >= 90 && second <= 102;
  if (firstLooksLat && secondLooksLng) return latLng;
  if (second >= 9 && second <= 29 && first >= 90 && first <= 102) return lngLat;

  return latLng;
}

export function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function routePointFromCoordinates(
  lng: number,
  lat: number,
  label?: string,
): RoutePoint {
  const coords: readonly [number, number] = [lng, lat];
  return {
    label: label ?? formatCoordinates(lng, lat),
    coordinates: coords,
  };
}

export function resolveRoutePointCoordinates(point: RoutePoint | null): readonly [number, number] | null {
  if (!point) return null;
  if (point.coordinates) return point.coordinates;
  return parseCoordinateInput(point.label);
}

export function toRouteWaypoint(point: RoutePoint): RouteWaypoint | null {
  const coordinates = resolveRoutePointCoordinates(point);
  if (!coordinates) return null;
  const [lng, lat] = coordinates;
  return {
    lat,
    lng,
    label: point.label.trim() || undefined,
  };
}

export function toApiRoutingProfile(profile: DirectionsUiProfile): RoutingRouteProfileCode {
  if (profile === 'motorbike') return 'motorcycle';
  return profile;
}

export function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
}

export function bboxFromRouteGeometry(
  geometry: { readonly coordinates: readonly (readonly [number, number])[] },
): readonly [number, number, number, number] | null {
  if (geometry.coordinates.length < 2) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of geometry.coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function formatRouteDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} hr ${rem} min` : `${hours} hr`;
}
