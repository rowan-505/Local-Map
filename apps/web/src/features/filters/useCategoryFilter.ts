import { useCallback, useMemo, useState } from 'react';
import type { PoiCategoryId } from '@/types';
import type { PoiFilterState } from '@/types';

export function useCategoryFilter() {
  const [categoryId, setCategoryId] = useState<PoiCategoryId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const selectCategory = useCallback((id: PoiCategoryId | null) => {
    setCategoryId(id);
  }, []);

  const filterState = useMemo(
    (): PoiFilterState => ({
      categoryId,
      searchQuery,
    }),
    [categoryId, searchQuery],
  );

  return { filterState, categoryId, selectCategory, searchQuery, setSearchQuery };
}
