/**
 * Local filter + search UI state. Apply with `filterPois(MVP_POI_DATA, filterState)` only —
 * `MVP_POI_DATA` is the normalized Kyauktan OSM dataset (`mvpPoiSource`).
 */
import { useCallback, useMemo, useState } from 'react';
import type { PoiCategoryId } from '@/types';
import type { PoiFilterState } from '@/types';

export function useCategoryFilter() {
  const [excludedCategoryIds, setExcludedCategoryIds] = useState<readonly PoiCategoryId[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState('');

  const toggleCategory = useCallback((id: PoiCategoryId) => {
    setExcludedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const filterState = useMemo(
    (): PoiFilterState => ({
      excludedCategoryIds,
      searchQuery,
    }),
    [excludedCategoryIds, searchQuery],
  );

  return { filterState, excludedCategoryIds, toggleCategory, searchQuery, setSearchQuery };
}
