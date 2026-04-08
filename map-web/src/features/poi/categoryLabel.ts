/** Category id → display label for list/detail (uses `data/categoryMeta`). */
import { POI_CATEGORY_META } from '@/data/categoryMeta';
import type { PoiCategoryId } from '@/types';

export function poiCategoryLabel(id: PoiCategoryId): string {
  return POI_CATEGORY_META.find((m) => m.id === id)?.label ?? id;
}
