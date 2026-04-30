import type { PoiCategoryId } from '@/types';

export function poiCategoryLabel(
  id: PoiCategoryId,
  categoryName?: string | null,
  categoryCode?: string | null,
): string {
  return categoryName ?? categoryCode ?? id;
}
