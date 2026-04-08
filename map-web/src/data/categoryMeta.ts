/**
 * Display labels for POI categories — keep in sync with `POI_CATEGORY_IDS` in types.
 * Swap this file or fetch meta from an API later without changing domain types.
 */
import type { PoiCategoryId } from '@/types';

export type PoiCategoryMeta = {
  readonly id: PoiCategoryId;
  /** UI label for filters and legends */
  readonly label: string;
};

export const POI_CATEGORY_META: readonly PoiCategoryMeta[] = [
  { id: 'food', label: 'Food & drink' },
  { id: 'shop', label: 'Shops' },
  { id: 'services', label: 'Services' },
  { id: 'outdoor', label: 'Parks & outdoors' },
  { id: 'culture', label: 'Culture & faith' },
  { id: 'other', label: 'Other' },
];
