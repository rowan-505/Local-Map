/**
 * Point of interest — API-backed fields for map, list, filters, and detail.
 */
import type { PoiCategoryId } from './poi-category';

export type PoiDataSource = 'api' | 'osm';

export type Poi = {
  readonly id: string;
  readonly apiId?: string;
  readonly publicId?: string;
  readonly name: string;
  readonly category: PoiCategoryId;
  readonly categoryCode?: string | null;
  readonly categoryName?: string | null;
  readonly subcategory: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
  readonly importanceScore?: number | null;
  readonly isVerified?: boolean;
  readonly source: PoiDataSource;
  readonly osm_tags: Readonly<Record<string, string>>;
};
