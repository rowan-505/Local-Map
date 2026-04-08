/**
 * Map layer serialization: POI domain → GeoJSON for Mapbox/MapLibre sources.
 */
import type { Poi } from '@/types';

export function poisToFeatureCollection(pois: readonly Poi[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois.map((poi) => ({
      type: 'Feature' as const,
      id: poi.id,
      properties: {
        id: poi.id,
        name: poi.name,
        category: poi.category,
        subcategory: poi.subcategory,
        ...(poi.address !== undefined && { address: poi.address }),
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [poi.longitude, poi.latitude],
      },
    })),
  };
}
