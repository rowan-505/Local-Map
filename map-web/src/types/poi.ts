/**
 * Point of interest — MVP fields for map, list, filters, and detail.
 */
import type { PoiCategoryId } from './poi-category';

export type PoiDataSource = 'osm';

export type Poi = {
  readonly id: string;
  readonly name: string;
  readonly category: PoiCategoryId;
  /** Primary OSM-typed label, e.g. `amenity=cafe` — edit derivation in normalization. */
  readonly subcategory: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
  readonly source: PoiDataSource;
  /** Full tag set from OSM (Kyauktan import); read-only for display / search. */
  readonly osm_tags: Readonly<Record<string, string>>;
};
