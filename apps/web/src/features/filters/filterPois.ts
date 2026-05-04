import type { Poi, PoiFilterState } from '@/types';

function lowerHaystack(p: Poi): string {
  const parts = [
    p.nameMm,
    p.nameEn,
    p.displayName,
    p.primaryName,
    p.myanmarName,
    p.englishName,
    p.name,
    p.categoryName,
    p.categoryCode,
    p.subcategory,
    p.address,
  ];

  return parts
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join('\n')
    .toLowerCase();
}

export function filterPois(pois: readonly Poi[], state: PoiFilterState): readonly Poi[] {
  let out = pois;

  if (state.categoryCode !== null) {
    out = out.filter((p) => p.categoryCode === state.categoryCode);
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    out = out.filter((p) => {
      if (lowerHaystack(p).includes(q)) return true;
      for (const v of Object.values(p.osm_tags)) {
        if (v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  return out;
}
