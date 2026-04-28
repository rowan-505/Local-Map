/**
 * Single pass: category exclusions then case-insensitive substring search.
 * Pass normalized Kyauktan OSM POIs (`MVP_POI_DATA`) as `pois` — search/tags read from that dataset only.
 */
import type { Poi, PoiFilterState } from '@/types';

export function filterPois(pois: readonly Poi[], state: PoiFilterState): readonly Poi[] {
  let out = pois;

  if (state.excludedCategoryIds.length > 0) {
    const excluded = new Set(state.excludedCategoryIds);
    out = out.filter((p) => !excluded.has(p.category));
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    out = out.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.address?.toLowerCase().includes(q)) return true;
      if (p.subcategory.toLowerCase().includes(q)) return true;
      for (const v of Object.values(p.osm_tags)) {
        if (v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  return out;
}
