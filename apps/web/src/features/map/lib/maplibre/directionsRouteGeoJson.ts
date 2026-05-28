import type { RouteGeoJsonLineString } from '@/features/routing/types';

export type DirectionsMapOverlay = {
  readonly from: readonly [number, number] | null;
  readonly to: readonly [number, number] | null;
  readonly geometry: RouteGeoJsonLineString | null;
};

export const ROUTE_ACTIVE_SOURCE_ID = 'route-active-source' as const;
export const ROUTE_CONNECTOR_SOURCE_ID = 'route-connector-source' as const;

/** Skip snap connectors when selected point is within this distance of route end. */
export const ROUTE_CONNECTOR_SNAP_THRESHOLD_METERS = 5;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

type LngLat = readonly [number, number];

export function overlayToGeoJSON(overlay: DirectionsMapOverlay | null): GeoJSON.FeatureCollection {
  if (!overlay) return EMPTY_FC;

  const features: GeoJSON.Feature[] = [];

  if (overlay.geometry && overlay.geometry.coordinates.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'route' },
      geometry: {
        type: 'LineString',
        coordinates: overlay.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
      },
    });
  }

  if (overlay.from) {
    features.push({
      type: 'Feature',
      properties: { role: 'from', kind: 'endpoint' },
      geometry: { type: 'Point', coordinates: [overlay.from[0], overlay.from[1]] },
    });
  }

  if (overlay.to) {
    features.push({
      type: 'Feature',
      properties: { role: 'to', kind: 'endpoint' },
      geometry: { type: 'Point', coordinates: [overlay.to[0], overlay.to[1]] },
    });
  }

  return features.length > 0 ? { type: 'FeatureCollection', features } : EMPTY_FC;
}

/** Dotted origin/destination snap lines — never throws; returns empty on failure. */
export function overlayConnectorsToGeoJSON(
  overlay: DirectionsMapOverlay | null,
): GeoJSON.FeatureCollection {
  try {
    return buildOverlayConnectorsGeoJSON(overlay);
  } catch {
    return EMPTY_FC;
  }
}

function buildOverlayConnectorsGeoJSON(
  overlay: DirectionsMapOverlay | null,
): GeoJSON.FeatureCollection {
  if (!overlay?.geometry) return EMPTY_FC;

  const endpoints = routeLineEndpoints(overlay.geometry);
  if (!endpoints) return EMPTY_FC;

  const features: GeoJSON.Feature[] = [];

  if (isValidLngLat(overlay.from)) {
    const gapMeters = haversineMeters(overlay.from, endpoints.first);
    if (gapMeters > ROUTE_CONNECTOR_SNAP_THRESHOLD_METERS) {
      features.push(connectorLineFeature('from-connector', overlay.from, endpoints.first));
    }
  }

  if (isValidLngLat(overlay.to)) {
    const gapMeters = haversineMeters(overlay.to, endpoints.last);
    if (gapMeters > ROUTE_CONNECTOR_SNAP_THRESHOLD_METERS) {
      features.push(connectorLineFeature('to-connector', endpoints.last, overlay.to));
    }
  }

  return features.length > 0 ? { type: 'FeatureCollection', features } : EMPTY_FC;
}

function connectorLineFeature(
  role: 'from-connector' | 'to-connector',
  start: LngLat,
  end: LngLat,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { kind: 'connector', role },
    geometry: {
      type: 'LineString',
      coordinates: [
        [start[0], start[1]],
        [end[0], end[1]],
      ],
    },
  };
}

function routeLineEndpoints(
  geometry: RouteGeoJsonLineString,
): { first: LngLat; last: LngLat } | null {
  const coords = geometry.coordinates;
  if (coords.length < 2) return null;

  const firstRaw = coords[0];
  const lastRaw = coords[coords.length - 1];
  if (!firstRaw || !lastRaw || firstRaw.length < 2 || lastRaw.length < 2) return null;

  const first: LngLat = [firstRaw[0], firstRaw[1]];
  const last: LngLat = [lastRaw[0], lastRaw[1]];
  if (!isValidLngLat(first) || !isValidLngLat(last)) return null;

  return { first, last };
}

function isValidLngLat(coord: LngLat | null | undefined): coord is LngLat {
  return (
    coord != null &&
    coord.length >= 2 &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  );
}

function haversineMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinHalf =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(sinHalf), Math.sqrt(1 - sinHalf));
}

export function bboxFromDirectionsOverlay(
  overlay: DirectionsMapOverlay | null,
): readonly [number, number, number, number] | null {
  if (!overlay?.geometry || overlay.geometry.coordinates.length < 2) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of overlay.geometry.coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}
