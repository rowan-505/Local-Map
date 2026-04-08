/**
 * Client-side filter snapshot — derived views should read from this + source POIs only.
 */
import type { PoiCategoryId } from './poi-category';

export type PoiFilterState = {
  /**
   * Categories hidden from the map/list. Empty = nothing excluded (show all categories).
   */
  readonly excludedCategoryIds: readonly PoiCategoryId[];
  /** Reserved for text search; empty string = no text filter. */
  readonly searchQuery: string;
};
