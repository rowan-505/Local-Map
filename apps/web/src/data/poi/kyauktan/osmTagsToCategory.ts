/**
 * OSM tags → app `PoiCategoryId` for normalized Kyauktan POIs (`normalizeKyauktanOsm.ts`).
 *
 * UI filter labels (`POI_CATEGORY_META`):
 *   food → Food & drink | shop → Shops | services → Services |
 *   outdoor → Parks & outdoors | culture → Culture & faith | other → Other
 *
 * Precedence: food → shop → services → outdoor → culture → other (fallback).
 * To expand: add strings to the `Set` for that category.
 */
import type { PoiCategoryId } from '../../../types';

/** Food & drink */
const AMENITY_FOOD = new Set<string>([
  'restaurant',
  'cafe',
  'bar',
  'pub',
  'fast_food',
  'food_court',
  'biergarten',
  'ice_cream',
]);

/** Shops — any `shop=*` counts; these amenities behave like retail */
const AMENITY_SHOP_LIKE = new Set<string>(['marketplace', 'vending_machine']);

/** Services */
const AMENITY_SERVICES = new Set<string>([
  'fuel',
  'bank',
  'atm',
  'pharmacy',
  'clinic',
  'hospital',
  'post_office',
  'police',
  'townhall',
  'car_rental',
  'bicycle_rental',
]);

/** Parks & outdoors */
const LEISURE_OUTDOOR = new Set<string>(['park', 'playground', 'garden', 'nature_reserve']);
const AMENITY_OUTDOOR = new Set<string>(['drinking_water', 'fountain']);

/** Culture & faith */
const AMENITY_CULTURE = new Set<string>([
  'place_of_worship',
  'theatre',
  'library',
  'arts_centre',
  'community_centre',
]);
const TOURISM_CULTURE = new Set<string>(['museum', 'gallery', 'attraction', 'artwork', 'viewpoint']);
const HISTORIC_CULTURE = new Set<string>(['monument', 'memorial', 'ruins', 'archaeological_site', 'castle']);

export function osmTagsToCategory(tags: Readonly<Record<string, string>>): PoiCategoryId {
  const amenity = tags.amenity;
  const shop = tags.shop;
  const leisure = tags.leisure;
  const tourism = tags.tourism;
  const historic = tags.historic;

  if (amenity !== undefined && AMENITY_FOOD.has(amenity)) {
    return 'food';
  }
  if (shop !== undefined || (amenity !== undefined && AMENITY_SHOP_LIKE.has(amenity))) {
    return 'shop';
  }
  if (amenity !== undefined && AMENITY_SERVICES.has(amenity)) {
    return 'services';
  }
  if (
    (leisure !== undefined && LEISURE_OUTDOOR.has(leisure)) ||
    (amenity !== undefined && AMENITY_OUTDOOR.has(amenity))
  ) {
    return 'outdoor';
  }
  if (
    (amenity !== undefined && AMENITY_CULTURE.has(amenity)) ||
    (tourism !== undefined && TOURISM_CULTURE.has(tourism)) ||
    (historic !== undefined && HISTORIC_CULTURE.has(historic))
  ) {
    return 'culture';
  }

  return 'other';
}
