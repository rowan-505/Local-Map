import type { RouteGeoJsonLineString } from '@/features/routing/types';

export type DirectionsMapOverlay = {
  readonly from: readonly [number, number] | null;
  readonly to: readonly [number, number] | null;
  readonly geometry: RouteGeoJsonLineString | null;
};

export const ROUTE_ACTIVE_SOURCE_ID = 'route-active-source' as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

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
