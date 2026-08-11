import { useCallback } from 'react';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';

/**
 * The map label selector also controls public UI copy. The bilingual map-label
 * mode keeps the interface in Myanmar so compact controls do not become
 * crowded, while map features continue to show both names.
 */
export function mapUiText(
  languageMode: PlaceLanguageMode,
  myanmar: string,
  english: string,
): string {
  return languageMode === 'en' ? english : myanmar;
}

export function useMapUiText(): (myanmar: string, english: string) => string {
  const languageMode = useMapUiStore((state) => state.languageMode);
  return useCallback(
    (myanmar, english) => mapUiText(languageMode, myanmar, english),
    [languageMode],
  );
}

export function mapDocumentLanguage(languageMode: PlaceLanguageMode): 'my' | 'en' {
  return languageMode === 'en' ? 'en' : 'my';
}
