import type { Poi, PoiFilterState } from '@/types';

export function filterPois(pois: readonly Poi[], state: PoiFilterState): readonly Poi[] {
  let out = pois;

  if (state.categoryCode !== null) {
    out = out.filter((p) => p.categoryCode === state.categoryCode);
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
