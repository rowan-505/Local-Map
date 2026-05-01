import { useCallback, useMemo, useState } from 'react';
import type { PoiCategoryCode } from '@/types';
import type { PoiFilterState } from '@/types';

export function useCategoryFilter() {
  const [categoryCode, setCategoryCode] = useState<PoiCategoryCode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const selectCategory = useCallback((code: PoiCategoryCode | null) => {
    setCategoryCode(code);
  }, []);

  const filterState = useMemo(
    (): PoiFilterState => ({
      categoryCode,
      searchQuery,
    }),
    [categoryCode, searchQuery],
  );

  return { filterState, categoryCode, selectCategory, searchQuery, setSearchQuery };
}
