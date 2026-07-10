/** Page size for GET /public/search cursor pagination. */
export const PUBLIC_SEARCH_PAGE_LIMIT = 20;

/** Hard cap on results loaded in one search session (prevents unbounded scroll). */
export const PUBLIC_SEARCH_SESSION_RESULT_CAP = 150;

export const PUBLIC_SEARCH_CATEGORIES = [
  'all',
  'places',
  'areas',
  'roads',
  'transport',
  'addresses',
] as const;

export type PublicSearchCategory = (typeof PUBLIC_SEARCH_CATEGORIES)[number];

export const PUBLIC_SEARCH_TRANSPORT_TYPES = [
  'all',
  'stops',
  'stations',
  'terminals',
  'routes',
] as const;

export type PublicSearchTransportType = (typeof PUBLIC_SEARCH_TRANSPORT_TYPES)[number];

export const PUBLIC_SEARCH_TRANSPORT_MODES = [
  'all',
  'bus',
  'train',
  'express',
  'ferry',
  'flight',
  'other',
] as const;

export type PublicSearchTransportMode = (typeof PUBLIC_SEARCH_TRANSPORT_MODES)[number];

/**
 * Address rows are not in the public search index yet — hide the Addresses chip
 * until `category=addresses` returns useful results.
 */
export const PUBLIC_SEARCH_ADDRESSES_FILTER_ENABLED = false;

/** Top-level category chips shown in the search panel (server-side filters). */
export const PUBLIC_SEARCH_CATEGORY_FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'places', label: 'Places' },
  { id: 'areas', label: 'Areas' },
  { id: 'roads', label: 'Roads' },
  { id: 'transport', label: 'Transport' },
  { id: 'addresses', label: 'Addresses' },
] as const satisfies ReadonlyArray<{ readonly id: PublicSearchCategory; readonly label: string }>;

export function getVisiblePublicSearchCategoryFilterChips() {
  return PUBLIC_SEARCH_CATEGORY_FILTER_CHIPS.filter(
    (chip) => chip.id !== 'addresses' || PUBLIC_SEARCH_ADDRESSES_FILTER_ENABLED,
  );
}

/** Transport subtype chips (only when top-level category is transport). */
export const PUBLIC_SEARCH_TRANSPORT_TYPE_FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'stops', label: 'Stops' },
  { id: 'stations', label: 'Stations' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'routes', label: 'Routes' },
] as const satisfies ReadonlyArray<{
  readonly id: PublicSearchTransportType;
  readonly label: string;
}>;

/** Mode chips exposed in the UI (backend also supports `other`). */
export const PUBLIC_SEARCH_TRANSPORT_MODE_FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'bus', label: 'Bus' },
  { id: 'train', label: 'Train' },
  { id: 'express', label: 'Express' },
  { id: 'ferry', label: 'Ferry' },
  { id: 'flight', label: 'Flight' },
] as const satisfies ReadonlyArray<{
  readonly id: PublicSearchTransportMode;
  readonly label: string;
}>;
