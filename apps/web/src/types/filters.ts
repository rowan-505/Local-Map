/**
 * Client-side filter snapshot — derived views should read from this + source POIs only.
 */
import type { PoiCategoryCode } from './poi-category';

export type PoiFilterState = {
  readonly categoryCode: PoiCategoryCode | null;
  readonly searchQuery: string;
};
