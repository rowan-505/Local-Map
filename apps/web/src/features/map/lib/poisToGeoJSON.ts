/**
 * Map layer serialization: POI domain → GeoJSON for MapLibre GL sources.
 */
import type { Poi } from '@/types';

const SELECTED_PIN_IMAGE_PREFIX = 'selected-place-pin' as const;

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

      const props: Record<string, string | number | undefined> = {
        id: poi.id,
        category: poi.category,
        poi_category_key: poiVisualCategoryForPoi(poi),
        selected_pin_icon: selectedPinImageIdForPoi(poi),
        importance_score: poi.importanceScore ?? 0,
        is_verified: poi.isVerified === true ? 1 : 0,
        ...(poi.subcategory !== undefined && { subcategory: poi.subcategory }),
        ...(poi.address !== undefined && { address: poi.address }),
      };

      if (poi.categoryCode) props.category_code = poi.categoryCode;
      if (poi.categoryName) props.category_name = poi.categoryName;
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

function selectedPinImageIdForPoi(poi: Poi): string {
  return `${SELECTED_PIN_IMAGE_PREFIX}-${poiVisualCategoryForPoi(poi)}`;
}

function poiVisualCategoryForPoi(poi: Poi): string {
  const categoryText = [
    poi.category,
    poi.categoryCode,
    poi.categoryName,
    poi.subcategory,
    ...Object.values(poi.osm_tags ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (matchesAny(categoryText, ['food', 'restaurant', 'cafe', 'tea', 'coffee'])) return 'food';
  if (matchesAny(categoryText, ['shopping', 'shop', 'market', 'store'])) return 'shopping';
  if (matchesAny(categoryText, ['health', 'clinic', 'hospital', 'pharmacy'])) return 'health';
  if (matchesAny(categoryText, ['education', 'school', 'university', 'college'])) return 'education';
  if (matchesAny(categoryText, ['religion', 'pagoda', 'monastery', 'place_of_worship', 'worship'])) {
    return 'religion';
  }
  if (matchesAny(categoryText, ['transport', 'bus_stop', 'bus', 'train', 'railway'])) {
    return 'transport';
  }
  if (matchesAny(categoryText, ['government', 'office', 'administration'])) return 'government';
  if (matchesAny(categoryText, ['hotel', 'guest_house', 'guest house', 'lodging'])) return 'hotel';
  return 'default';
}

function matchesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
