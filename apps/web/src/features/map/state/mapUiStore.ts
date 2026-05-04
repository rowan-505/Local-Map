import { create } from 'zustand';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';

type MapUiState = {
  readonly languageMode: PlaceLanguageMode;
  setLanguageMode: (mode: PlaceLanguageMode) => void;
};

/** Global map UI: language mode drives MapLibre `text-field` + React labels (API returns bilingual fields). */
export const useMapUiStore = create<MapUiState>((set) => ({
  languageMode: 'my',
  setLanguageMode: (mode) => set({ languageMode: mode }),
}));
