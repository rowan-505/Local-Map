/**
 * Closed set of POI kinds for filtering and styling.
 * Add new values here as the product grows; UI can derive labels from this list.
 */

export const POI_CATEGORY_IDS = [
  'food',
  'shop',
  'services',
  'outdoor',
  'culture',
  'other',
] as const;

export type PoiCategoryId = (typeof POI_CATEGORY_IDS)[number];
