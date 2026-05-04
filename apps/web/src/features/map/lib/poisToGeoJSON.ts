/**
 * Map layer serialization: POI domain → GeoJSON for MapLibre GL sources.
 */
import type { Poi } from '@/types';

function opt(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

export function poisToFeatureCollection(pois: readonly Poi[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois.map((poi) => {
      const nameMm = opt(poi.nameMm ?? poi.myanmarName);
      const nameEn = opt(poi.nameEn ?? poi.englishName);
      const displayName = opt(poi.displayName);
      const primaryName = opt(poi.primaryName);
      const legacyName = opt(poi.name);

      const props: Record<string, string | undefined> = {
        id: poi.id,
        category: poi.category,
        ...(poi.subcategory !== undefined && { subcategory: poi.subcategory }),
        ...(poi.address !== undefined && { address: poi.address }),
      };

      if (nameMm) props.name_mm = nameMm;
      if (nameEn) props.name_en = nameEn;
      if (displayName) props.display_name = displayName;
      if (primaryName) props.primary_name = primaryName;
      props.name =
        nameMm ??
        nameEn ??
        displayName ??
        legacyName ??
        'Unnamed';

      return {
        type: 'Feature' as const,
        id: poi.id,
        properties: props as GeoJSON.GeoJsonProperties,
        geometry: {
          type: 'Point' as const,
          coordinates: [poi.longitude, poi.latitude],
        },
      };
    }),
  };
}
