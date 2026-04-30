/**
 * Client-side filter snapshot — derived views should read from this + source POIs only.
 */
import type { PoiCategoryId } from './poi-category';

export type PoiFilterState = {
  readonly categoryId: PoiCategoryId | null;
  readonly searchQuery: string;
};
