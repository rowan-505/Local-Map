import { create } from 'zustand';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';

type MapUiState = {
  readonly languageMode: PlaceLanguageMode;
  setLanguageMode: (mode: PlaceLanguageMode) => void;
};

/** Global map UI: language drives all `/public/map` reads and GeoJSON overlays. */
export const useMapUiStore = create<MapUiState>((set) => ({
  languageMode: 'my',
  setLanguageMode: (mode) => set({ languageMode: mode }),
}));
