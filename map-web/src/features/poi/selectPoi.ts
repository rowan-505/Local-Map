/**
 * Pure helper: resolve selected POI from visible data — one `find`, no separate membership check.
 */
import type { Poi } from '@/types';

export function selectPoiFromVisible(
  visiblePois: readonly Poi[],
  selectedPoiId: string | null,
): Poi | undefined {
  if (selectedPoiId == null) return undefined;
  return visiblePois.find((p) => p.id === selectedPoiId);
}
